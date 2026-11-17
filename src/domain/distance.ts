import type { PaceChart, Segment, WorkoutSpec } from './types';

export interface DistanceRange { minM: number; maxM: number; estimated: boolean; unknown: number }
const zero = (): DistanceRange => ({ minM: 0, maxM: 0, estimated: false, unknown: 0 });
function add(a: DistanceRange, b: DistanceRange, count = 1): DistanceRange {
  return { minM: a.minM + b.minM * count, maxM: a.maxM + b.maxM * count, estimated: a.estimated || b.estimated, unknown: a.unknown + b.unknown * count };
}
function segment(s: Segment, chart?: PaceChart): DistanceRange {
  if (s.distanceM != null) return { ...zero(), minM: s.distanceM, maxM: s.distanceM };
  const pace = chart?.[s.intensity as keyof PaceChart];
  if (s.durationSec != null && pace && pace.fromSec > 0 && pace.toSec > 0) {
    return { minM: s.durationSec / Math.max(pace.fromSec, pace.toSec) * 1000, maxM: s.durationSec / Math.min(pace.fromSec, pace.toSec) * 1000, estimated: true, unknown: 0 };
  }
  return { ...zero(), unknown: 1 };
}

/** Celková délka v předpisu má přednost před bloky, které ji rozepisují. */
export function workoutDistance(w: WorkoutSpec, chart?: PaceChart): DistanceRange {
  if (['rest', 'strength', 'cross'].includes(w.type)) return zero();
  if (w.distanceM != null) return { ...zero(), minM: w.distanceM, maxM: w.distanceM };
  if (!w.blocks.length) return w.durationSec != null ? segment({ role: 'steady', durationSec: w.durationSec, intensity: w.type === 'easy' || w.type === 'long' ? 'easy' : 'free' }, chart) : { ...zero(), unknown: 1 };
  return w.blocks.reduce((sum, b) => {
    if (b.kind === 'note') return sum;
    if (b.kind === 'segment') return add(sum, segment(b, chart));
    if (b.kind === 'strides') return add(sum, segment({ role: 'work', durationSec: b.durationSec, intensity: 'strides' }, chart), b.count);
    let part = [b.work, ...(b.more ?? [])].reduce((s, x) => add(s, segment(x, chart)), zero());
    part = { ...part, minM: part.minM * b.count, maxM: part.maxM * b.count, unknown: part.unknown * b.count };
    if (b.recovery) {
      const r = segment(b.recovery, chart);
      part = add(part, r, Math.max(0, b.count - 1));
      if (b.recoveryAfterLast === true) part = add(part, r);
      if (b.recoveryAfterLast === null) part = { ...part, maxM: part.maxM + r.maxM, estimated: true };
    }
    return add(sum, part);
  }, zero());
}

export function plannedDistance(workouts: WorkoutSpec[], chart?: PaceChart): DistanceRange {
  return workouts.reduce((sum, w) => add(sum, workoutDistance(w, chart)), zero());
}
