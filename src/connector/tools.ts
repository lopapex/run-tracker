// Operace konektoru nad prostorem uživatele. Čisté funkce: dostanou prostor, upraví ho na místě
// a vrátí text pro model. Změny rozpisu jdou vždy přes registr příkazů z domény (vratná revize).
import { z } from 'zod';
import { applyScheduleCommand, OPERATION_LABEL, projectRevision, revertRevision, workoutSpecSchema, type ScheduleOperation, type ScheduleSnapshot } from '../domain/commands';
import { addDays, DOW_LONG, dowOf, formatDay, isIsoDate, todayIso, weekStartOf } from '../domain/dates';
import { plannedDistance } from '../domain/distance';
import { blockLines, formatDistanceRange, formatKm, formatPace, resolvePaceChart, workoutSummary } from '../domain/format';
import { createActivation, newId, planRange } from '../domain/schedule';
import type { Dow, PaceChart, PlanActivation, PlanTemplate, ScheduleRevision, ScheduledWorkout, TemplateWeek } from '../domain/types';
import { MAX_REVISIONS, type Workspace } from './workspace';

export type Outcome = { ok: true; text: string; changed: boolean } | { ok: false; text: string };
const fail = (text: string): Outcome => ({ ok: false, text });
const done = (text: string, changed = true): Outcome => ({ ok: true, text, changed });

// ---------- Vstupní schémata ----------

const isoDate = z.string().refine(isIsoDate, 'Datum musí být RRRR-MM-DD.');
const dow = z.number().int().min(0).max(6);
const paceRange = z.object({ fromSec: z.number().int().min(120).max(900), toSec: z.number().int().min(120).max(900) });
export const paceChartSchema = z.object({ easy: paceRange, steady: paceRange, mp: paceRange, hm_pace: paceRange, '10k_pace': paceRange, '5k_pace': paceRange }).partial();

export const planRangeInput = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const profileInput = z.object({
  timezone: z.string().max(60).optional(),
  intent: z.enum(['maintain', 'improve', 'race']).optional(),
  weeklyKm: z.number().min(0).max(300).optional(),
  runsPerWeek: z.number().int().min(1).max(7).optional(),
  restDows: z.array(dow).max(6).optional(),
  longRunDow: dow.optional(),
  raceDate: isoDate.optional(),
  raceDistanceM: z.number().positive().max(200_000).optional(),
  raceTargetSec: z.number().int().positive().max(48 * 3600).optional(),
  paceChart: paceChartSchema.optional(),
});

export const stageInput = z.object({
  name: z.string().min(1).max(80),
  units: z.enum(['km', 'mi']).default('km'),
  paceChart: paceChartSchema.optional(),
  restart: z.boolean().default(false),
  weeks: z.array(z.object({
    index: z.number().int().min(1).max(52),
    phase: z.string().max(40).optional(),
    note: z.string().max(1500).optional(),
    declaredTotalM: z.number().positive().max(400_000).optional(),
    days: z.array(z.object({ dow, workout: workoutSpecSchema })).length(7),
  })).min(1).max(8),
});

export const activateInput = z.object({
  mode: z.enum(['start', 'race']),
  date: isoDate,
  startFromWeek: z.number().int().min(1).max(52).optional(),
  skipWeeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
});

export const statusInput = z.object({
  workoutId: z.string().min(1),
  status: z.enum(['scheduled', 'completed', 'partial']),
  feel: z.number().int().min(1).max(5).optional(),
  pain: z.enum(['none', 'mild', 'significant']).optional(),
  note: z.string().max(300).optional(),
});

// ---------- Pomocné ----------

function activeOf(ws: Workspace): PlanActivation | undefined {
  return ws.activations.find((a) => a.status === 'active');
}

function snapshotOf(ws: Workspace, activation: PlanActivation): ScheduleSnapshot {
  return { activation, workouts: ws.workouts.filter((w) => w.activationId === activation.id) };
}

function chartOf(ws: Workspace, activation?: PlanActivation): PaceChart {
  const template = activation ? ws.templates.find((t) => t.id === activation.templateId) : undefined;
  return resolvePaceChart(ws.profile, template?.paceChart);
}

function persist(ws: Workspace, snap: ScheduleSnapshot, rev: ScheduleRevision): void {
  const next = projectRevision(snap, rev);
  ws.workouts = [...ws.workouts.filter((w) => w.activationId !== snap.activation.id), ...next.workouts];
  ws.activations = ws.activations.map((a) => (a.id === next.activation.id ? next.activation : a));
  if (rev.revertsId) ws.revisions = ws.revisions.map((r) => (r.id === rev.revertsId ? { ...r, revertedById: rev.id } : r));
  ws.revisions = [...ws.revisions, rev].slice(-MAX_REVISIONS);
  const alive = new Set(ws.workouts.map((w) => w.id));
  ws.notes = ws.notes.filter((n) => alive.has(n.workoutId));
}

const STATUS_LABEL: Record<ScheduledWorkout['status'], string> = { scheduled: 'v plánu', completed: 'splněno', partial: 'splněno částečně', skipped: 'vynecháno' };

function workoutLine(ws: Workspace, w: ScheduledWorkout, chart: PaceChart): string[] {
  const week = w.sourceWeek != null ? `T${w.sourceWeek}` : 'mimo plán';
  const flags = [STATUS_LABEL[w.status], w.locked ? 'zamčeno' : '', w.date !== w.originDate ? `přesunuto z ${w.originDate}` : '', w.skipReason ? `důvod: ${w.skipReason}` : ''].filter(Boolean).join(', ');
  const lines = [`${w.id} | ${w.date} ${DOW_LONG[dowOf(w.date)]} | ${week} | ${w.workout.title} | ${workoutSummary(w.workout)} | ${flags}`];
  const blocks = blockLines(w.workout.blocks, chart);
  if (blocks.length) lines.push(`  Struktura: ${blocks.join('; ')}.`);
  if (w.workout.note) lines.push(`  Poznámka plánu: ${w.workout.note}`);
  const note = ws.notes.find((n) => n.workoutId === w.id);
  if (note) lines.push(`  Zápis uživatele: ${[note.feel ? `pocit ${note.feel}/5` : '', note.pain && note.pain !== 'none' ? `bolest ${note.pain === 'mild' ? 'mírná' : 'výrazná'}` : '', note.note ?? ''].filter(Boolean).join(', ')}`);
  return lines;
}

function weekCheck(week: Pick<TemplateWeek, 'index' | 'declaredTotalM' | 'days'>, chart?: PaceChart): string {
  const range = plannedDistance(week.days.map((d) => d.workout), chart);
  const sum = formatDistanceRange(range);
  if (week.declaredTotalM == null) return `T${week.index}: součet ${sum}`;
  // Míň než součet známých délek je chyba vždy; víc jde posoudit jen bez nevyčíslených úseků.
  const off = week.declaredTotalM < range.minM - 500 || (!range.unknown && week.declaredTotalM > range.maxM + 500);
  return `T${week.index}: součet ${sum}, autor uvádí ${formatKm(week.declaredTotalM)}${off ? ' – NESEDÍ, zkontroluj přepis proti dokumentu' : range.unknown ? ' (část jednotek je jen časem, nejde ověřit)' : ' – sedí'}`;
}

// ---------- Čtení ----------

export function describePlan(ws: Workspace, input: z.infer<typeof planRangeInput>, now: Date = new Date()): Outcome {
  const p = ws.profile;
  const today = todayIso(p.timezone, now);
  const lines = [`Dnes je ${formatDay(today, { weekday: true, year: true })} (${today}), časová zóna ${p.timezone}.`];
  const about = [
    p.intent ? `záměr ${p.intent === 'race' ? 'příprava na závod' : p.intent === 'improve' ? 'postupné zlepšení' : 'udržování'}` : '',
    p.raceDate ? `závod ${p.raceDate}${p.raceDistanceM ? ` na ${formatKm(p.raceDistanceM)}` : ''}` : '',
    p.weeklyKm ? `obvykle ${p.weeklyKm} km týdně` : '',
    p.runsPerWeek ? `${p.runsPerWeek} běhů týdně` : '',
    p.restDows.length ? `bez běhu: ${p.restDows.map((d) => DOW_LONG[d]).join(', ')}` : '',
  ].filter(Boolean);
  lines.push(about.length ? `Profil: ${about.join('; ')}.` : 'Profil je prázdný (záměr, objem a dny bez běhu nejsou zadané).');

  if (ws.staged) lines.push(`Rozpracovaný import „${ws.staged.name}“: nahrané týdny ${ws.staged.weeks.map((w) => w.index).join(', ')}. Ještě není zařazený do kalendáře.`);

  const activation = activeOf(ws);
  if (!activation) {
    lines.push('Uživatel nemá aktivní plán. Plán vznikne přes import_plan_weeks a activate_plan.');
    return done(lines.join('\n'), false);
  }
  const template = ws.templates.find((t) => t.id === activation.templateId);
  const chart = chartOf(ws, activation);
  const range = planRange(activation);
  const paces = Object.entries(chart).map(([k, v]) => `${k} ${formatPace(v.fromSec)}–${formatPace(v.toSec)}`).join('; ');
  lines.push(`Tempa min/km: ${paces || 'nezadaná'}.`);
  lines.push(`Aktivní plán „${template?.name ?? 'bez názvu'}“${range ? `, ${range.first} až ${range.last}` : ''}. Verze rozpisu ${activation.revisionSeq}.`);

  const from = input.from ?? weekStartOf(today);
  const to = input.to ?? addDays(from, 13);
  if (to < from) return fail('Konec rozsahu je před začátkem.');
  if (addDays(from, 180) < to) return fail('Rozsah je delší než 180 dní. Zeptej se na kratší období.');

  const all = snapshotOf(ws, activation).workouts;
  for (let start = weekStartOf(from); start <= to; start = addDays(start, 7)) {
    const mapping = activation.mapping.find((m) => m.weekStart === start);
    const source = mapping?.sourceWeek != null ? template?.weeks.find((w) => w.index === mapping.sourceWeek) : undefined;
    const label = !mapping ? 'mimo plán' : mapping.sourceWeek == null ? 'pauza' : `týden ${mapping.sourceWeek} plánu${source?.phase ? ` (${source.phase})` : ''}`;
    const days = all.filter((w) => w.date >= start && w.date <= addDays(start, 6) && w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    lines.push('', `Týden od ${start}: ${label}${start === weekStartOf(today) ? ' – probíhá' : ''}`);
    if (source?.note) lines.push(`Poznámka autora plánu: ${source.note}`);
    if (!days.length) { lines.push('Žádné jednotky.'); continue; }
    lines.push('id | datum | týden plánu | jednotka | obsah | stav');
    for (const w of days) lines.push(...workoutLine(ws, w, chart));
    const planned = days.filter((w) => w.status !== 'skipped').map((w) => w.workout);
    lines.push(`Součet naplánovaného: ${formatDistanceRange(plannedDistance(planned, chart))}.`);
  }

  const recent = ws.revisions.filter((r) => r.activationId === activation.id).slice(-5).reverse();
  if (recent.length) {
    lines.push('', 'Poslední změny (id pro undo_change):');
    for (const r of recent) lines.push(`${r.id} | ${r.at.slice(0, 16)} | ${OPERATION_LABEL[r.operation] ?? r.operation}${r.reason ? ` – ${r.reason}` : ''}${r.revertedById ? ' (vráceno)' : ''}`);
  }
  return done(lines.join('\n'), false);
}

// ---------- Profil ----------

export function setProfile(ws: Workspace, input: z.infer<typeof profileInput>): Outcome {
  if (input.timezone) {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }); } catch { return fail(`Neznámá časová zóna „${input.timezone}“. Použij název jako Europe/Prague.`); }
  }
  const { paceChart, restDows, longRunDow, ...rest } = input;
  ws.profile = {
    ...ws.profile,
    ...rest,
    ...(restDows ? { restDows: restDows as Dow[] } : {}),
    ...(longRunDow != null ? { longRunDow: longRunDow as Dow } : {}),
    ...(paceChart ? { paceChart: { ...ws.profile.paceChart, ...paceChart }, paceSource: 'profile' as const } : {}),
  };
  return done(`Profil uložen: ${Object.keys(input).join(', ') || 'beze změny'}.`, Object.keys(input).length > 0);
}

// ---------- Import a aktivace ----------

export function stageWeeks(ws: Workspace, input: z.infer<typeof stageInput>, now: string): Outcome {
  for (const w of input.weeks) if (new Set(w.days.map((d) => d.dow)).size !== 7) return fail(`Týden ${w.index} musí obsahovat každý den právě jednou (0 = pondělí … 6 = neděle); volný den zapiš jako typ rest.`);
  const base = input.restart || !ws.staged ? [] : ws.staged.weeks;
  const byIndex = new Map(base.map((w) => [w.index, w]));
  for (const w of input.weeks) {
    byIndex.set(w.index, {
      index: w.index,
      phase: w.phase,
      note: w.note,
      declaredTotalM: w.declaredTotalM,
      days: [...w.days].sort((a, b) => a.dow - b.dow).map((d) => ({ dow: d.dow as Dow, workout: d.workout, source: { method: 'generated' as const, review: 'unreviewed' as const, issues: [] } })),
    });
  }
  const weeks = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const paceChart = input.paceChart ?? (input.restart ? undefined : ws.staged?.paceChart);
  ws.staged = { name: input.name, units: input.units, paceChart, weeks, updatedAt: now };
  const chart = { ...ws.profile.paceChart, ...paceChart };
  const missing: number[] = [];
  for (let i = 1; i <= weeks[weeks.length - 1].index; i++) if (!byIndex.has(i)) missing.push(i);
  return done([
    `Nahráno do rozpracovaného importu „${input.name}“: týdny ${weeks.map((w) => w.index).join(', ')}.`,
    missing.length ? `Chybí týdny ${missing.join(', ')}; doplň je dalším voláním.` : 'Týdny na sebe navazují od 1.',
    'Kontrola součtů:',
    ...input.weeks.map((w) => weekCheck({ ...w, days: byIndex.get(w.index)!.days }, chart)),
    'Až budou všechny týdny nahrané a součty zkontrolované, zeptej se uživatele na začátek nebo datum závodu a zavolej activate_plan.',
  ].join('\n'));
}

export function activatePlan(ws: Workspace, input: z.infer<typeof activateInput>, now: string): Outcome {
  const staged = ws.staged;
  if (!staged || !staged.weeks.length) return fail('Není co aktivovat. Nejdřív nahraj týdny přes import_plan_weeks.');
  const gap = staged.weeks.findIndex((w, i) => w.index !== i + 1);
  if (gap >= 0) return fail(`Týdny musí jít od 1 po sobě; chybí týden ${gap + 1}.`);
  const template: PlanTemplate = { id: newId(), name: staged.name, origin: 'import', createdAt: now, verifiedAt: now, units: staged.units, paceChart: staged.paceChart, weeks: staged.weeks };
  const { activation, workouts } = createActivation(template, { mode: input.mode, date: input.date, startFromWeek: input.startFromWeek, skipWeeks: input.skipWeeks }, now);
  if (!activation.mapping.length) return fail('Po přeskočení nezbyl žádný týden k zařazení.');
  const first = activation.mapping[0].weekStart;
  const endedOn = addDays(first, -1);
  const archived = new Set(ws.activations.filter((a) => a.status === 'active').map((a) => a.id));
  ws.activations = [...ws.activations.map((a) => (archived.has(a.id) ? { ...a, status: 'archived' as const, endedOn } : a)), activation];
  // Z nahrazeného plánu zůstává jen to, co už proběhlo.
  ws.workouts = [...ws.workouts.filter((w) => !archived.has(w.activationId) || w.date <= endedOn), ...workouts];
  ws.templates = [...ws.templates.filter((t) => ws.activations.some((a) => a.templateId === t.id)), template];
  ws.staged = undefined;
  if (staged.paceChart) ws.profile = { ...ws.profile, paceSource: 'plan' };
  const range = planRange(activation)!;
  return done([
    `Plán „${template.name}“ je zařazený do kalendáře: ${range.first} až ${range.last}, ${activation.mapping.length} týdnů.`,
    activation.skippedSourceWeeks.length ? `Přeskočené týdny plánu: ${activation.skippedSourceWeeks.join(', ')}.` : '',
    archived.size ? 'Předchozí plán je archivovaný; jeho proběhlé jednotky zůstaly v historii.' : '',
  ].filter(Boolean).join('\n'));
}

// ---------- Změny rozpisu ----------

export function scheduleCommand(ws: Workspace, operation: ScheduleOperation, payload: unknown, reason: string, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const snap = snapshotOf(ws, activation);
  const result = applyScheduleCommand(snap, { id: newId(), operation, payload, reason }, { author: 'coach', now });
  if (!result.ok) return fail(result.message);
  persist(ws, snap, result.revision);
  return done([...result.summary, ...result.warnings.map((w) => `Pozor: ${w}`), `Změna ${result.revision.id} je uložená a jde vrátit přes undo_change.`].join('\n'));
}

export function setStatus(ws: Workspace, input: z.infer<typeof statusInput>, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const workout = ws.workouts.find((w) => w.id === input.workoutId && w.activationId === activation.id);
  if (!workout) return fail('Jednotka v rozpisu není. Načti aktuální id přes get_plan.');
  const lines: string[] = [];
  if (workout.status !== input.status) {
    const result = scheduleCommand(ws, 'SET_STATUS', { workoutId: input.workoutId, status: input.status }, '', now);
    if (!result.ok) return result;
    lines.push(result.text);
  }
  if (input.feel != null || input.pain != null || input.note != null) {
    const previous = ws.notes.find((n) => n.workoutId === workout.id);
    const next = { ...previous, workoutId: workout.id, date: workout.date, at: now, ...(input.feel != null ? { feel: input.feel as 1 | 2 | 3 | 4 | 5 } : {}), ...(input.pain != null ? { pain: input.pain } : {}), ...(input.note != null ? { note: input.note } : {}) };
    ws.notes = [...ws.notes.filter((n) => n.workoutId !== workout.id), next];
    lines.push('Zápis k jednotce uložen.');
  }
  return lines.length ? done(lines.join('\n')) : done('Beze změny, jednotka už tenhle stav má.', false);
}

export function undoChange(ws: Workspace, revisionId: string | undefined, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const own = ws.revisions.filter((r) => r.activationId === activation.id);
  const rev = revisionId ? own.find((r) => r.id === revisionId) : [...own].reverse().find((r) => !r.revertedById && r.operation !== 'REVERT');
  if (!rev) return fail(revisionId ? 'Změna s tímhle id není v historii aktivního plánu.' : 'Není žádná změna k vrácení.');
  const snap = snapshotOf(ws, activation);
  const result = revertRevision(snap, rev, { author: 'coach', now });
  if (!result.ok) return fail(result.message);
  persist(ws, snap, result.revision);
  return done(`${result.summary.join('\n')}${rev.reason ? ` (${rev.reason})` : ''}`);
}
