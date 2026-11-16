import { describe, expect, it } from 'vitest';
import { plannedDistance, projectedDistance, workoutDistance, sameRun } from './distance';
import type { ScheduledWorkout, WorkoutSpec } from './types';

const easy: WorkoutSpec = { type: 'easy', title: '10 min easy', durationSec: 600, blocks: [] };
const chart = { easy: { fromSec: 300, toSec: 360 } };
describe('kilometry z časových úseků', () => {
  it('spojí dvojí import stejného běhu, ale zachová dva stejně dlouhé běhy v den', () => {
    const a = {startUtc:'2026-11-16T06:00:00Z',distanceM:10000};
    expect(sameRun(a,{startUtc:'2026-11-16T06:00:30Z',distanceM:10100})).toBe(true);
    expect(sameRun(a,{startUtc:'2026-11-16T17:00:00Z',distanceM:10000})).toBe(false);
    expect(sameRun(a,{startUtc:'',distanceM:10000})).toBe(false);
  });
  it('10 min při 5–6 min/km je 1,67–2 km a bez tempa nic nehádá', () => {
    expect(workoutDistance(easy, chart)).toMatchObject({ minM: 600 / 360 * 1000, maxM: 2000, estimated: true, unknown: 0 });
    expect(workoutDistance(easy).unknown).toBe(1);
  });
  it('celková délka není znovu přičtena k rozpisu úseků', () => {
    expect(workoutDistance({ ...easy, distanceM: 5000, blocks: [{ kind: 'segment', role: 'warmup', durationSec: 600, intensity: 'easy' }] }, chart).maxM).toBe(5000);
  });
  it('více pracovních úseků a neznámá poslední pauza vytvoří rozsah', () => {
    const w: WorkoutSpec = { type: 'speed', title: 'Intervaly', blocks: [{ kind: 'repeat', count: 3, work: { role: 'work', distanceM: 400, intensity: '5k_pace' }, more: [{ role: 'work', distanceM: 200, intensity: '10k_pace' }], recovery: { role: 'recovery', durationSec: 60, intensity: 'easy' }, recoveryAfterLast: null }] };
    const r = workoutDistance(w, chart);
    expect(r.minM).toBeCloseTo(1800 + 2 * 60 / 360 * 1000);
    expect(r.maxM).toBeCloseTo(2400);
  });
  it('skutečnost nahradí den a nezdvojí plán; další den zůstává odhad', () => {
    const ws = ['2026-11-16', '2026-11-17'].map(date => ({ date, workout: easy, status: 'scheduled' } as ScheduledWorkout));
    const r = projectedDistance(ws, [{ localDate: '2026-11-16', distanceM: 1900 }], chart);
    expect(r.minM).toBeCloseTo(1900 + 600 / 360 * 1000);
    expect(r.maxM).toBe(3900);
    expect(plannedDistance([easy, easy], chart).maxM).toBe(4000);
  });
  it('při více jednotkách v den přizná nejasné párování', () => {
    const ws = [1, 2].map(() => ({ date: '2026-11-16', workout: easy, status: 'scheduled' } as ScheduledWorkout));
    expect(projectedDistance(ws, [{ localDate: '2026-11-16', distanceM: 1900 }], chart).unknown).toBe(1);
  });
});
