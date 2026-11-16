// Registr příkazů nad platným rozpisem (§8.3). Stejné příkazy používá kalendář, karty i chat (INV-07).
// Funkce jsou čisté: dostanou snímek, vrátí vratnou revizi nebo vysvětlitelnou chybu.
import { z } from 'zod';
import { addDays, diffDays, formatDay, isIsoDate, weekStartOf } from './dates';
import { isHard, TYPE_LABEL } from './format';
import { newId } from './schedule';
import type { Author, PlanActivation, ScheduledWorkout, ScheduleRevision, WeekMapping, WorkoutSpec } from './types';

const isoDate = z.string().refine(isIsoDate, 'Neplatné datum');

const intensity = z.enum(['easy', 'steady', 'mp', 'hm_pace', '10k_pace', '5k_pace', 'strides', 'walk', 'free']);
const segment = z.object({
  role: z.enum(['warmup', 'work', 'recovery', 'cooldown', 'steady']),
  durationSec: z.number().int().positive().max(6 * 3600).optional(),
  distanceM: z.number().positive().max(100_000).optional(),
  intensity,
  note: z.string().max(300).optional(),
});
const block = z.discriminatedUnion('kind', [
  segment.extend({ kind: z.literal('segment') }),
  z.object({
    kind: z.literal('repeat'),
    count: z.number().int().min(1).max(60),
    work: segment,
    more: z.array(segment).max(6).optional(),
    recovery: segment.optional(),
    recoveryAfterLast: z.boolean().nullable(),
  }),
  z.object({ kind: z.literal('strides'), count: z.number().int().min(1).max(30), durationSec: z.number().int().min(5).max(120) }),
  z.object({ kind: z.literal('note'), text: z.string().max(500) }),
]);

export const workoutSpecSchema = z.object({
  type: z.enum(['easy', 'long', 'speed', 'tempo', 'race', 'rest', 'strength', 'cross', 'other']),
  title: z.string().min(1).max(80),
  distanceM: z.number().min(0).max(200_000).optional(),
  durationSec: z.number().int().positive().max(24 * 3600).optional(),
  load: z.enum(['rest', 'low', 'medium', 'high']).optional(),
  blocks: z.array(block).max(20),
  strengthMin: z.number().int().positive().max(240).optional(),
  rawInstruction: z.string().max(2000).optional(),
  note: z.string().max(1000).optional(),
});

const payloads = {
  MOVE_WORKOUT: z.object({ workoutId: z.string(), toDate: isoDate, onConflict: z.enum(['swap']).optional() }),
  EDIT_WORKOUT: z.object({ workoutId: z.string(), workout: workoutSpecSchema }),
  SKIP_WORKOUT: z.object({ workoutId: z.string(), reason: z.string().max(300).optional() }),
  ADD_WORKOUT: z.object({ date: isoDate, workout: workoutSpecSchema }),
  RESTORE_ORIGINAL: z.object({ workoutId: z.string() }),
  SET_LOCK: z.object({ workoutId: z.string(), locked: z.boolean() }),
  SET_STATUS: z.object({ workoutId: z.string(), status: z.enum(['scheduled', 'completed', 'partial']) }),
  REMAP_PLAN: z.object({ mode: z.enum(['pause_week', 'skip_week']), weekStart: isoDate }),
} as const;

export type ScheduleOperation = keyof typeof payloads;
export const SCHEDULE_OPERATIONS = Object.keys(payloads) as ScheduleOperation[];

export const scheduleCommandSchema = z.object({
  id: z.string().min(1),
  operation: z.enum(SCHEDULE_OPERATIONS as [ScheduleOperation, ...ScheduleOperation[]]),
  payload: z.unknown(),
  reason: z.string().max(500).default(''),
  /** Očekávané pořadí revize; chrání před použitím zastaralého návrhu (INV-11). */
  expectedRevisionSeq: z.number().int().optional(),
});
export type ScheduleCommand = z.infer<typeof scheduleCommandSchema>;

export interface ScheduleSnapshot {
  activation: PlanActivation;
  workouts: ScheduledWorkout[];
}

export type CommandResult =
  | { ok: true; revision: ScheduleRevision; warnings: string[]; summary: string[] }
  | { ok: false; code: 'invalid' | 'not_found' | 'locked' | 'conflict' | 'stale' | 'noop'; message: string };

const fail = (code: Exclude<CommandResult, { ok: true }>['code'], message: string): CommandResult => ({ ok: false, code, message });

function hardNeighbourWarning(all: ScheduledWorkout[], moved: ScheduledWorkout): string[] {
  if (!isHard(moved.workout)) return [];
  const near = all.filter(
    (w) => w.id !== moved.id && w.status !== 'skipped' && isHard(w.workout) && Math.abs(diffDays(w.date, moved.date)) === 1,
  );
  return near.map(
    (w) => `${moved.workout.title} teď sousedí s jednotkou ${w.workout.title} (${formatDay(w.date, { weekday: true })}). Dva těžší dny po sobě zvaž.`,
  );
}

export function applyScheduleCommand(
  snap: ScheduleSnapshot,
  input: unknown,
  meta: { author: Author; now: string },
): CommandResult {
  const parsedCmd = scheduleCommandSchema.safeParse(input);
  if (!parsedCmd.success) return fail('invalid', 'Příkaz nemá platný tvar.');
  const cmd = parsedCmd.data;
  const parsed = payloads[cmd.operation].safeParse(cmd.payload);
  if (!parsed.success) return fail('invalid', `Neplatné údaje příkazu: ${parsed.error.issues[0]?.message ?? ''}`.trim());
  if (cmd.expectedRevisionSeq != null && cmd.expectedRevisionSeq !== snap.activation.revisionSeq) {
    return fail('stale', 'Rozpis se od vytvoření návrhu změnil. Návrh je potřeba připravit znovu.');
  }

  const byId = new Map(snap.workouts.map((w) => [w.id, w]));
  const before: ScheduledWorkout[] = [];
  const after: ScheduledWorkout[] = [];
  const warnings: string[] = [];
  const summary: string[] = [];
  let mappingBefore: WeekMapping[] | undefined;
  let mappingAfter: WeekMapping[] | undefined;
  let skippedAfter: number[] | undefined;

  const touch = (w: ScheduledWorkout, patch: Partial<ScheduledWorkout>) => {
    before.push(w);
    const next = { ...structuredClone(w), ...patch };
    after.push(next);
    return next;
  };
  const get = (id: string) => byId.get(id);

  switch (cmd.operation) {
    case 'MOVE_WORKOUT': {
      const p = parsed.data as z.infer<typeof payloads.MOVE_WORKOUT>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (w.locked) return fail('locked', 'Jednotka je zamčená. Nejdřív ji odemkni.');
      if (w.status === 'completed' || w.status === 'partial') return fail('conflict', 'Odběhnutou jednotku nejde přesunout.');
      if (w.date === p.toDate) return fail('noop', 'Jednotka už v ten den je.');
      const others = snap.workouts.filter((o) => o.date === p.toDate && o.id !== w.id && o.status !== 'skipped');
      const blocking = others.filter((o) => o.workout.type !== 'rest');
      if (blocking.length > 0 && p.onConflict !== 'swap') {
        return fail('conflict', `${formatDay(p.toDate, { weekday: true })} už má jednotku ${blocking[0].workout.title}. Můžeš je prohodit.`);
      }
      const swap = blocking.length > 0 ? blocking : others;
      for (const o of swap) {
        if (o.locked) return fail('locked', `${o.workout.title} je zamčená, prohodit nejde.`);
        if (o.status !== 'scheduled') return fail('conflict', 'Cílový den už má odběhnutou jednotku.');
      }
      const moved = touch(w, { date: p.toDate });
      for (const o of swap) touch(o, { date: w.date });
      summary.push(`${w.workout.title}: ${formatDay(w.date, { weekday: true })} → ${formatDay(p.toDate, { weekday: true })}`);
      for (const o of blocking) summary.push(`${o.workout.title}: ${formatDay(o.date, { weekday: true })} → ${formatDay(w.date, { weekday: true })}`);
      const projected = snap.workouts.map((x) => after.find((a) => a.id === x.id) ?? x);
      warnings.push(...hardNeighbourWarning(projected, moved));
      break;
    }
    case 'EDIT_WORKOUT': {
      const p = parsed.data as z.infer<typeof payloads.EDIT_WORKOUT>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (w.locked) return fail('locked', 'Jednotka je zamčená. Nejdřív ji odemkni.');
      touch(w, { workout: p.workout as WorkoutSpec });
      summary.push(`${formatDay(w.date, { weekday: true })}: ${w.workout.title} → ${p.workout.title}`);
      break;
    }
    case 'SKIP_WORKOUT': {
      const p = parsed.data as z.infer<typeof payloads.SKIP_WORKOUT>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (w.status === 'skipped') return fail('noop', 'Jednotka už je vynechaná.');
      if (w.status !== 'scheduled') return fail('conflict', 'Odběhnutou jednotku nejde vynechat.');
      touch(w, { status: 'skipped', skipReason: p.reason });
      summary.push(`Vynecháno: ${w.workout.title} (${formatDay(w.date, { weekday: true })})`);
      break;
    }
    case 'ADD_WORKOUT': {
      const p = parsed.data as z.infer<typeof payloads.ADD_WORKOUT>;
      const created: ScheduledWorkout = {
        id: newId(),
        activationId: snap.activation.id,
        date: p.date,
        originDate: p.date,
        sourceWeek: snap.activation.mapping.find((m) => m.weekStart === weekStartOf(p.date))?.sourceWeek ?? null,
        sourceDow: null,
        original: null,
        workout: p.workout as WorkoutSpec,
        status: 'scheduled',
        locked: false,
      };
      after.push(created);
      summary.push(`Přidáno: ${p.workout.title} (${formatDay(p.date, { weekday: true })})`);
      warnings.push(...hardNeighbourWarning([...snap.workouts, created], created));
      break;
    }
    case 'RESTORE_ORIGINAL': {
      const p = parsed.data as z.infer<typeof payloads.RESTORE_ORIGINAL>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (!w.original) return fail('conflict', 'Jednotka nemá původní předpis, byla přidaná ručně.');
      const occupied = snap.workouts.some(
        (o) => o.id !== w.id && o.date === w.originDate && o.workout.type !== 'rest' && o.status !== 'skipped',
      );
      const backToDate = w.date !== w.originDate && !occupied;
      if (w.date !== w.originDate && occupied) {
        warnings.push(`Původní den (${formatDay(w.originDate, { weekday: true })}) je obsazený, vrátil se jen obsah jednotky.`);
      }
      touch(w, {
        workout: structuredClone(w.original),
        status: w.status === 'skipped' ? 'scheduled' : w.status,
        skipReason: undefined,
        date: backToDate ? w.originDate : w.date,
      });
      summary.push(`Obnoven původní předpis: ${w.original.title}`);
      break;
    }
    case 'SET_LOCK': {
      const p = parsed.data as z.infer<typeof payloads.SET_LOCK>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (w.locked === p.locked) return fail('noop', 'Beze změny.');
      touch(w, { locked: p.locked });
      summary.push(`${w.workout.title}: ${p.locked ? 'zamčeno' : 'odemčeno'}`);
      break;
    }
    case 'SET_STATUS': {
      const p = parsed.data as z.infer<typeof payloads.SET_STATUS>;
      const w = get(p.workoutId);
      if (!w) return fail('not_found', 'Jednotka v rozpisu není.');
      if (w.status === p.status) return fail('noop', 'Beze změny.');
      touch(w, { status: p.status });
      summary.push(`${w.workout.title}: ${p.status === 'completed' ? 'splněno' : p.status === 'partial' ? 'splněno částečně' : 'naplánováno'}`);
      break;
    }
    case 'REMAP_PLAN': {
      const p = parsed.data as z.infer<typeof payloads.REMAP_PLAN>;
      const ws = weekStartOf(p.weekStart);
      const idx = snap.activation.mapping.findIndex((m) => m.weekStart === ws);
      if (idx < 0) return fail('not_found', 'Tenhle týden do plánu nepatří.');
      mappingBefore = snap.activation.mapping;
      const entry = snap.activation.mapping[idx];
      const done = (w: ScheduledWorkout) => w.status === 'completed' || w.status === 'partial';
      if (p.mode === 'pause_week') {
        // Proběhlé jednotky zůstávají na místě (§5.2); posouvá se jen budoucnost.
        for (const w of snap.workouts) if (w.date >= ws && !done(w)) touch(w, { date: addDays(w.date, 7), originDate: addDays(w.originDate, 7) });
        mappingAfter = [
          ...snap.activation.mapping.slice(0, idx),
          { weekStart: ws, sourceWeek: null },
          ...snap.activation.mapping.slice(idx).map((m) => ({ ...m, weekStart: addDays(m.weekStart, 7) })),
        ];
        summary.push(`Pauza v týdnu od ${formatDay(ws)}; zbytek plánu se posunul o týden.`);
      } else {
        if (entry.sourceWeek == null) return fail('conflict', 'Tenhle týden je pauza, není co přeskočit.');
        const weekEnd = addDays(ws, 6);
        for (const w of snap.workouts) {
          if (done(w)) continue;
          if (w.date >= ws && w.date <= weekEnd && w.sourceWeek === entry.sourceWeek) before.push(w);
          else if (w.date > weekEnd) touch(w, { date: addDays(w.date, -7), originDate: addDays(w.originDate, -7) });
        }
        mappingAfter = [
          ...snap.activation.mapping.slice(0, idx),
          ...snap.activation.mapping.slice(idx + 1).map((m) => ({ ...m, weekStart: addDays(m.weekStart, -7) })),
        ];
        skippedAfter = [...snap.activation.skippedSourceWeeks, entry.sourceWeek];
        summary.push(`Týden ${entry.sourceWeek} přeskočen; další týdny se posunuly o týden dřív. Číslování plánu zůstává.`);
      }
      break;
    }
  }

  const revision: ScheduleRevision = {
    id: newId(),
    activationId: snap.activation.id,
    seq: snap.activation.revisionSeq + 1,
    at: meta.now,
    author: meta.author,
    operation: cmd.operation,
    reason: cmd.reason,
    commandId: cmd.id,
    before,
    after,
    mappingBefore,
    mappingAfter,
    skippedBefore: skippedAfter ? snap.activation.skippedSourceWeeks : undefined,
    skippedAfter,
  };
  return { ok: true, revision, warnings, summary };
}

/** Undo je další revize (INV-06). Projde jen tehdy, když dotčené jednotky nikdo mezitím nezměnil. */
export function revertRevision(snap: ScheduleSnapshot, rev: ScheduleRevision, meta: { author: Author; now: string }): CommandResult {
  if (rev.revertedById) return fail('noop', 'Tahle změna už je vrácená.');
  const byId = new Map(snap.workouts.map((w) => [w.id, w]));
  for (const a of rev.after) {
    const cur = byId.get(a.id);
    if (!cur || JSON.stringify(cur) !== JSON.stringify(a)) {
      return fail('conflict', 'Jednotka se od té doby znovu změnila. Vrať nejdřív novější změnu.');
    }
  }
  if (rev.mappingAfter && JSON.stringify(rev.mappingAfter) !== JSON.stringify(snap.activation.mapping)) {
    return fail('conflict', 'Mapování týdnů se od té doby změnilo. Vrať nejdřív novější změnu.');
  }
  const revision: ScheduleRevision = {
    id: newId(),
    activationId: rev.activationId,
    seq: snap.activation.revisionSeq + 1,
    at: meta.now,
    author: meta.author,
    operation: 'REVERT',
    reason: `Vráceno: ${OPERATION_LABEL[rev.operation] ?? rev.operation}`,
    commandId: newId(),
    before: rev.after,
    after: rev.before,
    mappingBefore: rev.mappingAfter,
    mappingAfter: rev.mappingBefore,
    skippedBefore: rev.skippedAfter,
    skippedAfter: rev.skippedBefore,
    revertsId: rev.id,
  };
  return { ok: true, revision, warnings: [], summary: [revision.reason] };
}

/** Promítne revizi do snímku. Stejnou logiku používá úložiště i náhled návrhu. */
export function projectRevision(snap: ScheduleSnapshot, rev: ScheduleRevision): ScheduleSnapshot {
  const afterIds = new Set(rev.after.map((w) => w.id));
  const removed = new Set(rev.before.filter((w) => !afterIds.has(w.id)).map((w) => w.id));
  const map = new Map(snap.workouts.filter((w) => !removed.has(w.id)).map((w) => [w.id, w]));
  for (const w of rev.after) map.set(w.id, w);
  return {
    activation: {
      ...snap.activation,
      revisionSeq: rev.seq,
      mapping: rev.mappingAfter ?? snap.activation.mapping,
      skippedSourceWeeks: rev.skippedAfter ?? snap.activation.skippedSourceWeeks,
    },
    workouts: [...map.values()],
  };
}

export const OPERATION_LABEL: Record<string, string> = {
  MOVE_WORKOUT: 'přesun jednotky',
  EDIT_WORKOUT: 'úprava jednotky',
  SKIP_WORKOUT: 'vynechání jednotky',
  ADD_WORKOUT: 'přidání jednotky',
  RESTORE_ORIGINAL: 'obnovení originálu',
  SET_LOCK: 'zámek',
  SET_STATUS: 'stav splnění',
  REMAP_PLAN: 'změna mapování týdnů',
  REVERT: 'vrácení změny',
};

export function describeWorkout(w: WorkoutSpec): string {
  return w.title || TYPE_LABEL[w.type];
}
