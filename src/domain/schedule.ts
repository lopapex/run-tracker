import { addDays, weekStartOf } from './dates';
import type {
  Id,
  IsoDate,
  PlanActivation,
  PlanTemplate,
  ScheduledWorkout,
  TemplateWeek,
  WeekMapping,
  WorkoutSpec,
} from './types';

export const newId = (): Id =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const REST: WorkoutSpec = { type: 'rest', title: 'Volno', load: 'rest', blocks: [] };

export interface MappingOptions {
  /** `start`: první zařazený týden začíná v týdnu `date`. `race`: poslední týden obsahuje `date`. */
  mode: 'start' | 'race';
  date: IsoDate;
  /** „Jsem v týdnu N“: dřívější zdrojové týdny se přeskočí. */
  startFromWeek?: number;
  skipWeeks?: number[];
}

/** §5.2: zdrojový týden si drží identitu, přeskočené se nepřečíslovávají. */
export function buildMapping(
  weeks: Pick<TemplateWeek, 'index'>[],
  opts: MappingOptions,
): { mapping: WeekMapping[]; skippedSourceWeeks: number[] } {
  const from = opts.startFromWeek ?? 1;
  const skip = new Set(opts.skipWeeks ?? []);
  const skipped: number[] = [];
  const included: number[] = [];
  for (const w of [...weeks].sort((a, b) => a.index - b.index)) {
    if (w.index < from || skip.has(w.index)) skipped.push(w.index);
    else included.push(w.index);
  }
  if (included.length === 0) return { mapping: [], skippedSourceWeeks: skipped };
  const anchor = weekStartOf(opts.date);
  const first = opts.mode === 'start' ? anchor : addDays(anchor, -7 * (included.length - 1));
  return {
    mapping: included.map((sourceWeek, i) => ({ sourceWeek, weekStart: addDays(first, 7 * i) })),
    skippedSourceWeeks: skipped,
  };
}

export function instantiate(template: PlanTemplate, activationId: Id, mapping: WeekMapping[]): ScheduledWorkout[] {
  const out: ScheduledWorkout[] = [];
  for (const m of mapping) {
    if (m.sourceWeek == null) continue;
    const week = template.weeks.find((w) => w.index === m.sourceWeek);
    if (!week) continue;
    for (const day of week.days) {
      const date = addDays(m.weekStart, day.dow);
      out.push({
        id: newId(),
        activationId,
        date,
        originDate: date,
        sourceWeek: week.index,
        sourceDow: day.dow,
        original: structuredClone(day.workout),
        workout: structuredClone(day.workout),
        status: 'scheduled',
        locked: Boolean(day.locked),
      });
    }
  }
  return out;
}

export function createActivation(template: PlanTemplate, opts: MappingOptions, now: string): {
  activation: PlanActivation;
  workouts: ScheduledWorkout[];
} {
  const { mapping, skippedSourceWeeks } = buildMapping(template.weeks, opts);
  const activation: PlanActivation = {
    id: newId(),
    templateId: template.id,
    createdAt: now,
    status: 'active',
    mapping,
    skippedSourceWeeks,
    revisionSeq: 0,
  };
  return { activation, workouts: instantiate(template, activation.id, mapping) };
}

export function planRange(activation: PlanActivation): { first: IsoDate; last: IsoDate } | undefined {
  if (activation.mapping.length === 0) return undefined;
  const starts = activation.mapping.map((m) => m.weekStart).sort();
  return { first: starts[0], last: addDays(starts[starts.length - 1], 6) };
}

/** Jednotky dne: volno se skryje, pokud je ten den i skutečná jednotka. */
export function dayWorkouts(all: ScheduledWorkout[], date: IsoDate): ScheduledWorkout[] {
  const day = all.filter((w) => w.date === date);
  const real = day.filter((w) => w.workout.type !== 'rest');
  return real.length > 0 ? real : day.slice(0, 1);
}
