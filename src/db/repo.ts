// Aplikační příkazy nad úložištěm. Každá mutace je jedna transakce s auditem (INV-06).
import {
  applyScheduleCommand,
  projectRevision,
  revertRevision,
  type CommandResult,
  type ScheduleSnapshot,
} from '@/domain/commands';
import { addDays, todayIso } from '@/domain/dates';
import { applyDraftChanges, createDraftRevision, templateFromDraft, validateDraftRevision, importedWeeksSchema, type DraftResult } from '@/domain/drafts';
import { createActivation, newId, type MappingOptions } from '@/domain/schedule';
import { autoMatch, matchCandidates } from '@/domain/activities';
import type {
  Activity,
  AthleteProfile,
  Author,
  AuditEvent,
  CheckIn,
  Id,
  IsoDate,
  PlanActivation,
  PlanDraft,
  PlanDraftRevision,
  PlanTemplate,
  ScheduleRevision,
  WorkoutMatch,
} from '@/domain/types';
import { ALL_TABLES, db } from './db';

const now = () => new Date().toISOString();

export const DEFAULT_PROFILE: AthleteProfile = {
  id: 'me',
  locale: 'cs',
  units: 'km',
  timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Prague',
  restDows: [],
  longRunDow: 6,
};

export async function getProfile(): Promise<AthleteProfile> {
  return (await db().profile.get('me')) ?? DEFAULT_PROFILE;
}

export async function saveProfile(patch: Partial<AthleteProfile>): Promise<void> {
  const current = await getProfile();
  await db().profile.put({ ...current, ...patch, id: 'me' });
}

function audit(e: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
  return { id: newId(), at: now(), ...e };
}

// ---------- Plán ----------

export async function activeActivation(): Promise<PlanActivation | undefined> {
  return db().activations.where('status').equals('active').first();
}

export async function loadSnapshot(activationId: Id): Promise<ScheduleSnapshot | undefined> {
  const activation = await db().activations.get(activationId);
  if (!activation) return undefined;
  return { activation, workouts: await db().workouts.where('activationId').equals(activationId).toArray() };
}

async function persistRevision(snap: ScheduleSnapshot, rev: ScheduleRevision): Promise<void> {
  const next = projectRevision(snap, rev);
  const afterIds = new Set(rev.after.map((w) => w.id));
  const removed = rev.before.filter((w) => !afterIds.has(w.id)).map((w) => w.id);
  await db().workouts.bulkDelete(removed);
  await db().workouts.bulkPut(rev.after);
  await db().activations.put(next.activation);
  await db().revisions.put(rev);
  if (rev.revertsId) await db().revisions.update(rev.revertsId, { revertedById: rev.id });
}

/** Jediný vstup pro změny rozpisu z kalendáře, karet i chatu (INV-07). */
export async function runScheduleCommand(
  command: { operation: string; payload: unknown; reason?: string; expectedRevisionSeq?: number },
  author: Author = 'user',
): Promise<CommandResult> {
  const d = db();
  return d.transaction('rw', d.activations, d.workouts, d.revisions, d.audit, async () => {
    const activation = await activeActivation();
    if (!activation) return { ok: false, code: 'not_found', message: 'Nemáš aktivní plán.' } as CommandResult;
    const snap = (await loadSnapshot(activation.id))!;
    const result = applyScheduleCommand(snap, { id: newId(), reason: '', ...command }, { author, now: now() });
    if (result.ok) await persistRevision(snap, result.revision);
    await d.audit.add(audit({ author, operation: command.operation, ok: result.ok, detail: result.ok ? result.summary.join('; ') : result.message }));
    return result;
  });
}

export async function undoRevision(revisionId: Id, author: Author = 'user'): Promise<CommandResult> {
  const d = db();
  return d.transaction('rw', d.activations, d.workouts, d.revisions, d.audit, async () => {
    const rev = await d.revisions.get(revisionId);
    if (!rev) return { ok: false, code: 'not_found', message: 'Změna nebyla nalezena.' } as CommandResult;
    const snap = await loadSnapshot(rev.activationId);
    if (!snap) return { ok: false, code: 'not_found', message: 'Plán už neexistuje.' } as CommandResult;
    const result = revertRevision(snap, rev, { author, now: now() });
    if (result.ok) await persistRevision(snap, result.revision);
    await d.audit.add(audit({ author, operation: 'REVERT', targetId: revisionId, ok: result.ok, detail: result.ok ? undefined : result.message }));
    return result;
  });
}

/** Ověřená verze je neměnná (INV-01): úložiště ji umí jen založit, ne přepsat. */
export async function publishTemplate(template: PlanTemplate): Promise<void> {
  const d = db();
  await d.transaction('rw', d.templates, d.audit, async () => {
    if (await d.templates.get(template.id)) throw new Error('Ověřená verze plánu se nepřepisuje.');
    await d.templates.add(template);
    await d.audit.add(audit({ author: 'user', operation: 'PUBLISH_TEMPLATE', targetId: template.id, ok: true }));
  });
}

/** Atomická aktivace: předchozí plán se archivuje, jeho historie zůstává. */
export async function activateTemplate(templateId: Id, opts: MappingOptions, author: Author = 'user'): Promise<PlanActivation> {
  const d = db();
  return d.transaction('rw', d.templates, d.activations, d.workouts, d.audit, async () => {
    const template = await d.templates.get(templateId);
    if (!template) throw new Error('Plán nebyl nalezen.');
    const { activation, workouts } = createActivation(template, opts, now());
    if (activation.mapping.length === 0) throw new Error('Mapování neobsahuje žádný týden.');
    const first = activation.mapping[0].weekStart;
    const previous = await d.activations.where('status').equals('active').toArray();
    for (const p of previous) await d.activations.update(p.id, { status: 'archived', endedOn: addDays(first, -1) });
    await d.activations.add(activation);
    await d.workouts.bulkAdd(workouts);
    await d.audit.add(audit({ author, operation: 'ACTIVATE_PLAN', targetId: activation.id, ok: true }));
    return activation;
  });
}

export async function archiveActivePlan(): Promise<void> {
  const a = await activeActivation();
  if (!a) return;
  const profile = await getProfile();
  await db().activations.update(a.id, { status: 'archived', endedOn: todayIso(profile.timezone) });
  await db().audit.add(audit({ author: 'user', operation: 'ARCHIVE_PLAN', targetId: a.id, ok: true }));
}

// ---------- Drafty ----------

export async function createDraft(params: unknown, title: string, author: Author, reason: string, weekEntries?: unknown): Promise<DraftResult & { draft?: PlanDraft }> {
  const d = db();
  const draftId = newId();
  const result = createDraftRevision(draftId, params, { author, now: now(), reason });
  if (!result.ok) return result;
  if (weekEntries !== undefined) {
    const parsed = importedWeeksSchema.safeParse(weekEntries);
    if (!parsed.success) return { ok: false, code: 'invalid', message: `Návrh týdnů není úplný: ${parsed.error.issues[0]?.message}` };
    result.revision.weeks = parsed.data.map(w => ({ ...w, days: w.days.map(day => ({ ...day, dow: day.dow as import('@/domain/types').Dow, source: { method: 'generated' as const, review: 'unreviewed' as const, issues: [] } })) }));
    const problems = validateDraftRevision(result.revision);
    if (problems.length) return { ok: false, code: 'invalid', message: problems.join(' ') };
  }
  const draft: PlanDraft = { id: draftId, title, status: 'draft', createdAt: now(), currentRevisionId: result.revision.id };
  await d.transaction('rw', d.drafts, d.draftRevisions, d.audit, async () => {
    await d.drafts.add(draft);
    await d.draftRevisions.add(result.revision);
    await d.audit.add(audit({ author, operation: 'CREATE_PLAN_DRAFT', targetId: draftId, ok: true }));
  });
  return { ...result, draft };
}

export async function updateDraft(draftId: Id, changes: unknown, author: Author, reason: string, expectedRevisionId?: Id): Promise<DraftResult> {
  const d = db();
  return d.transaction('rw', d.drafts, d.draftRevisions, d.audit, async () => {
    const draft = await d.drafts.get(draftId);
    if (!draft || draft.status === 'archived') return { ok: false, code: 'not_found', message: 'Návrh nebyl nalezen.' } as DraftResult;
    if (draft.status === 'accepted') return { ok: false, code: 'stale', message: 'Tenhle návrh už je použitý jako plán. Úpravy dělej v plánu, nebo založ nový návrh.' } as DraftResult;
    const history = await d.draftRevisions.where('draftId').equals(draftId).toArray();
    const current = history.find((r) => r.id === draft.currentRevisionId)!;
    const result = applyDraftChanges(current, changes, history, { author, now: now(), reason, expectedRevisionId });
    if (result.ok) {
      await d.draftRevisions.add(result.revision);
      await d.drafts.update(draftId, { currentRevisionId: result.revision.id });
    }
    await d.audit.add(audit({ author, operation: 'UPDATE_PLAN_DRAFT', targetId: draftId, ok: result.ok, detail: result.ok ? result.summary.join('; ') : result.message }));
    return result;
  });
}

/** Aktivuje jen konkrétní aktuální a validní revizi (INV-04, INV-11). */
export async function activateDraft(draftId: Id, expectedRevisionId: Id, startDate?: IsoDate): Promise<{ ok: true; activation: PlanActivation } | { ok: false; message: string }> {
  const d = db();
  return d.transaction('rw', [d.drafts, d.draftRevisions, d.templates, d.activations, d.workouts, d.audit], async () => {
    const draft = await d.drafts.get(draftId);
    if (!draft) return { ok: false as const, message: 'Návrh nebyl nalezen.' };
    if (draft.currentRevisionId !== expectedRevisionId) return { ok: false as const, message: 'Tahle verze návrhu už není aktuální. Otevři poslední verzi a použij ji.' };
    const rev = await d.draftRevisions.get(expectedRevisionId);
    if (!rev) return { ok: false as const, message: 'Verze návrhu nebyla nalezena.' };
    const problems = validateDraftRevision(rev);
    if (problems.length) return { ok: false as const, message: `Návrh nejde použít: ${problems[0]}` };
    const template = templateFromDraft(rev, draft.title, now());
    await d.templates.add(template);
    const activation = await activateTemplate(template.id, { mode: 'start', date: startDate ?? rev.params.startDate }, 'user');
    await d.drafts.update(draftId, { status: 'accepted', acceptedActivationId: activation.id });
    return { ok: true as const, activation };
  });
}

// ---------- Aktivity ----------

export async function addActivity(activity: Activity): Promise<{ activity: Activity; duplicate: boolean; match?: WorkoutMatch }> {
  const d = db();
  return d.transaction('rw', [d.activities, d.matches, d.workouts, d.activations, d.revisions, d.audit], async () => {
    if (activity.checksum) {
      const existing = await d.activities.where('checksum').equals(activity.checksum).first();
      // Reimport stejného souboru nevytvoří aktivitu navíc (ACT-01).
      if (existing) return { activity: existing, duplicate: true };
    }
    await d.activities.add(activity);
    await d.audit.add(audit({ author: 'user', operation: 'ADD_ACTIVITY', targetId: activity.id, ok: true }));
    const activation = await activeActivation();
    if (!activation) return { activity, duplicate: false };
    const workouts = await d.workouts.where('activationId').equals(activation.id).toArray();
    const matched = new Set((await d.matches.toArray()).map((m) => m.workoutId));
    const target = autoMatch(matchCandidates(activity, workouts, matched));
    if (!target) return { activity, duplicate: false };
    const match = await setMatchInTx(activity.id, target.id, 'auto');
    return { activity, duplicate: false, match };
  });
}

async function setMatchInTx(activityId: Id, workoutId: Id | null, state: WorkoutMatch['state']): Promise<WorkoutMatch | undefined> {
  const d = db();
  const previous = await d.matches.where('activityId').equals(activityId).toArray();
  // Aktivita má nejvýše jednu hlavní jednotku; oprava párování nezdvojí objem.
  for (const p of previous) {
    await d.matches.delete(p.id);
    const others = await d.matches.where('workoutId').equals(p.workoutId).count();
    if (others === 0) await setStatus(p.workoutId, 'scheduled');
  }
  if (!workoutId) return undefined;
  const match: WorkoutMatch = { id: newId(), activityId, workoutId, state, at: now() };
  await d.matches.add(match);
  await setStatus(workoutId, 'completed');
  return match;
}

async function setStatus(workoutId: Id, status: 'scheduled' | 'completed'): Promise<void> {
  const d = db();
  const w = await d.workouts.get(workoutId);
  if (!w || w.status === status || w.status === 'skipped') return;
  const snap = await loadSnapshot(w.activationId);
  if (!snap) return;
  const result = applyScheduleCommand(snap, { id: newId(), operation: 'SET_STATUS', payload: { workoutId, status }, reason: 'Párování aktivity' }, { author: 'system', now: now() });
  if (result.ok) await persistRevision(snap, result.revision);
}

export async function setMatch(activityId: Id, workoutId: Id | null): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.matches, d.workouts, d.activations, d.revisions, d.audit], async () => {
    await setMatchInTx(activityId, workoutId, 'confirmed');
    await d.audit.add(audit({ author: 'user', operation: 'SET_MATCH', targetId: activityId, ok: true }));
  });
}

export async function deleteActivity(activityId: Id): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.activities, d.matches, d.checkIns, d.workouts, d.activations, d.revisions, d.audit], async () => {
    await setMatchInTx(activityId, null, 'confirmed');
    await d.checkIns.where('activityId').equals(activityId).delete();
    await d.activities.delete(activityId);
    await d.audit.add(audit({ author: 'user', operation: 'DELETE_ACTIVITY', targetId: activityId, ok: true }));
  });
}

export async function saveCheckIn(input: Omit<CheckIn, 'id' | 'at'> & { id?: Id }): Promise<CheckIn> {
  const checkIn: CheckIn = { ...input, id: input.id ?? newId(), at: now() };
  await db().checkIns.put(checkIn);
  return checkIn;
}

// ---------- Export a smazání (R-15) ----------

export async function exportAll(): Promise<Blob> {
  const d = db();
  const out: Record<string, unknown> = { format: 'run-tracker-export', version: 1, exportedAt: now() };
  for (const t of ALL_TABLES) {
    // Přístupové tokeny a cache ze Stravy do osobního exportu nepatří (§6.4, §10.1).
    if (t === 'connections' || t === 'stravaActivities' || t === 'syncMeta') continue;
    const rows = await d.table(t).toArray();
    // Originály dokumentů jsou binární; v exportu zůstává jen jejich popis.
    out[t] = t === 'documents' ? rows.map(({ blob: _blob, ...rest }) => rest) : rows;
  }
  return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
}

export async function wipeAll(): Promise<void> {
  const d = db();
  await d.transaction('rw', ALL_TABLES.map((t) => d.table(t)), async () => {
    for (const t of ALL_TABLES) await d.table(t).clear();
  });
}

export type { PlanDraftRevision };
