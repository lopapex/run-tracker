import { describe, expect, it } from 'vitest';
import { plannedDistance, workoutDistance } from './distance';
import type { WorkoutSpec } from './types';

const easy: WorkoutSpec = { type: 'easy', title: '10 min easy', durationSec: 600, blocks: [] };
const chart = { easy: { fromSec: 300, toSec: 360 } };
describe('kilometry z časových úseků', () => {
  it('plán sečte odhady jednotek', () => {
    expect(plannedDistance([easy, easy], chart).maxM).toBe(4000);
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
});
