import { z } from 'zod';
import { workoutSpecSchema } from '@/domain/commands';
import { draftParamsSchema } from '@/domain/drafts';
import { isIsoDate } from '@/domain/dates';
import { db, type RunDb } from './db';

const id = z.string().min(1).max(200);
const date = z.string().refine(isIsoDate);
const text = z.string();
const row = z.object({ id }).passthrough();
const day = z.object({ dow: z.number().int().min(0).max(6), workout: workoutSpecSchema, source: z.object({ method: z.enum(['ocr','pdf_text','manual','generated']), review: z.enum(['unreviewed','confirmed','edited']), issues: z.array(text) }).passthrough(), locked: z.boolean().optional() });
const week = z.object({ index: z.number().int().positive(), days: z.array(day).length(7) }).passthrough().refine(w => new Set(w.days.map(d => d.dow)).size === 7);
const workout = row.extend({ activationId: id, date, originDate: date, sourceWeek: z.number().nullable(), sourceDow: z.number().nullable(), original: workoutSpecSchema.nullable(), workout: workoutSpecSchema, status: z.enum(['scheduled','completed','partial','skipped']), locked: z.boolean() });
const mapping = z.array(z.object({ weekStart: date, sourceWeek: z.number().int().positive().nullable() }));
export const snapshotSchema = z.object({
  format: z.literal('run-tracker-workspace'), version: z.literal(1),
  profile: z.array(row.extend({ id: z.literal('me'), locale: z.literal('cs'), units: z.literal('km'), timezone: text, restDows: z.array(z.number().int().min(0).max(6)), longRunDow: z.number().int().min(0).max(6) })).max(1),
  documents: z.array(row.extend({ name: text, mime: text, size: z.number().nonnegative(), checksum: z.string().regex(/^[a-f0-9]{64}$/), createdAt: text, provenance: z.literal('PLAN_DOCUMENT') })),
  templates: z.array(row.extend({ name: text, origin: z.enum(['import','manual','draft']), weeks: z.array(week), units: z.enum(['km','mi']), createdAt: text, verifiedAt: text })),
  activations: z.array(row.extend({ templateId: id, status: z.enum(['active','archived']), mapping, skippedSourceWeeks: z.array(z.number()), revisionSeq: z.number().int().nonnegative(), createdAt: text })),
  workouts: z.array(workout),
  revisions: z.array(row.extend({ activationId: id, seq: z.number().int().positive(), at: text, operation: text, reason: text, author: z.enum(['user','coach','system']), commandId: id, before: z.array(workout), after: z.array(workout) })),
  drafts: z.array(row.extend({ title: text, status: z.enum(['generating','draft','ready','accepted','archived','failed']), currentRevisionId: id, createdAt: text })),
  draftRevisions: z.array(row.extend({ draftId: id, seq: z.number().int().positive(), parentId: id.nullable(), at: text, author: z.enum(['user','coach','system']), reason: text, params: draftParamsSchema, weeks: z.array(week) })),
  activities: z.array(row.extend({ name: text, source: z.enum(['file_gpx','file_tcx','file_fit','manual']), provenance: z.enum(['USER_ENTERED','USER_FILE_UPLOAD']), sport: z.enum(['run','other']), startUtc: text, localDate: date, distanceM: z.number().nonnegative(), movingSec: z.number().nonnegative(), elapsedSec: z.number().nonnegative(), laps: z.array(z.object({index: z.number(), distanceM: z.number(), durationSec: z.number(), kind: z.enum(['device','auto_km'])}).passthrough()), missing: z.array(z.enum(['hr','laps','elevation','gps'])), createdAt: text })),
  matches: z.array(row.extend({activityId: id, workoutId: id, state: z.enum(['auto','confirmed']), at: text})),
  checkIns: z.array(row.extend({date, feel: z.number().int().min(1).max(5), pain: z.enum(['none','mild','significant']), at: text})),
  messages: z.array(row.extend({ threadId: id, seq: z.number().int().positive(), role: z.enum(['user','assistant','system']), text, at: text })),
  usage: z.array(z.object({requestId: id, provider: text, model: text, mode: z.enum(['local','cloud']), startedAt: text}).passthrough()),
  audit: z.array(row.extend({at: text, author: z.enum(['user','coach','system']), operation: text, ok: z.boolean()})),
}).strict();
export type WorkspaceSnapshot = z.infer<typeof snapshotSchema>;
export const SYNC_TABLES = Object.keys(snapshotSchema.shape).filter(k => k !== 'format' && k !== 'version') as Array<Exclude<keyof WorkspaceSnapshot, 'format' | 'version'>>;

export function validateSnapshot(input: unknown): WorkspaceSnapshot {
  const snapshot = snapshotSchema.parse(input);
  for (const table of SYNC_TABLES) {
    const rows = snapshot[table] as Array<{id?: string; requestId?: string}>;
    if (new Set(rows.map(r => r.id ?? r.requestId)).size !== rows.length) throw new Error('Záloha obsahuje duplicitní záznamy.');
  }
  const has = (table: keyof WorkspaceSnapshot, key: string) => (snapshot[table] as Array<{id: string}>).some(r => r.id === key);
  if (snapshot.activations.filter(a => a.status === 'active').length > 1) throw new Error('Záloha obsahuje více aktivních plánů.');
  if (snapshot.activations.some(a => !has('templates', a.templateId)) || snapshot.workouts.some(w => !has('activations', w.activationId)) || snapshot.drafts.some(d => !has('draftRevisions', d.currentRevisionId)) || snapshot.draftRevisions.some(r => !has('drafts', r.draftId)) || snapshot.matches.some(m => !has('activities', m.activityId) || !has('workouts', m.workoutId))) throw new Error('Záloha obsahuje neúplné vazby.');
  return snapshot;
}

export async function collectSnapshot(database: RunDb = db()): Promise<WorkspaceSnapshot> {
  return database.transaction('r', SYNC_TABLES.map(t => database.table(t)), async () => {
    const out: Record<string, unknown> = { format: 'run-tracker-workspace', version: 1 };
    for (const t of SYNC_TABLES) {
      const rows = await database.table(t).toArray();
      out[t] = t === 'documents' ? rows.map(({blob: _blob, ...r}) => r) : rows;
    }
    return validateSnapshot(out);
  });
}

export async function restoreSnapshot(input: unknown, documents: Map<string, Blob>, database: RunDb = db(), expected?: string): Promise<void> {
  const data = validateSnapshot(input);
  if (data.documents.some(d => !documents.has(d.id))) throw new Error('Nejsou stažené všechny originály dokumentů.');
  await database.transaction('rw', SYNC_TABLES.map(t => database.table(t)), async () => {
    if (expected != null && JSON.stringify(await collectSnapshot(database)) !== expected) throw new Error('Data se během načítání změnila. Nic se nepřepsalo, synchronizuj znovu.');
    for (const t of SYNC_TABLES) {
      await database.table(t).clear();
      const rows = t === 'documents' ? data.documents.map(d => ({...d, blob: documents.get(d.id)!})) : data[t];
      await database.table(t).bulkPut(rows);
    }
  });
}

export async function snapshotHash(snapshot: WorkspaceSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function hasWorkspaceData(s: WorkspaceSnapshot): boolean { return s.templates.length + s.drafts.length + s.activities.length + s.messages.length > 0 || s.profile.some(p => !!p.onboardedAt); }
