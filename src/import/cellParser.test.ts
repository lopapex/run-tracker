import { describe, expect, it } from 'vitest';
import { parseCell } from './cellParser';

const lines = (values: string[]) => values.map((text, i) => ({ text, y: i * 35, h: 10 }));

describe('složené jednotky z PDF', () => {
  it('udrží opakování a více pracovních částí přes grafické mezery', () => {
    const parsed = parseCell(lines(['Speed Session', '15 Mins Easy', '4x', '5 Mins at HM Pace', '2 Mins at 10k Pace', '1 Min at 5k Pace', '2 Mins Walk', '10 Mins Easy']));
    expect(parsed.issues).toEqual([]);
    expect(parsed.workout.blocks).toMatchObject([
      { kind: 'segment', role: 'warmup', durationSec: 900 },
      { kind: 'repeat', count: 4, work: { durationSec: 300, intensity: 'hm_pace' }, more: [{ durationSec: 120, intensity: '10k_pace' }, { durationSec: 60, intensity: '5k_pace' }], recovery: { durationSec: 120, intensity: 'walk' }, recoveryAfterLast: null },
      { kind: 'segment', role: 'cooldown', durationSec: 600 },
    ]);
  });
  it('přečte inline opakování a zachová originál i u úspěšného importu', () => {
    const parsed = parseCell(lines(['Speed Session', '15 Mins Easy', '6×400m at 5k Pace', '2 Mins Walk', '10 Mins Easy']));
    expect(parsed.issues).toEqual([]);
    expect(parsed.workout.blocks[1]).toMatchObject({ kind: 'repeat', count: 6, work: { distanceM: 400, intensity: '5k_pace' } });
    expect(parsed.workout.rawInstruction).toContain('6×400m');
  });
  it('při neznámé instrukci nic neztratí', () => {
    const parsed = parseCell(lines(['Speed Session', '15 Mins Easy', 'Vlastní složitá instrukce']));
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.workout.rawInstruction).toContain('Vlastní složitá instrukce');
  });
  it('spojí zalomené tempo také uvnitř opakování', () => {
    const parsed = parseCell(lines(['Speed Session', '10 Mins Easy', '6x', '3 Mins at', '5k Pace', '2 Mins Walk', '10 Mins Easy']));
    expect(parsed.issues).toEqual([]);
    expect(parsed.workout.blocks[1]).toMatchObject({ kind: 'repeat', count: 6, work: { durationSec: 180, intensity: '5k_pace' }, recovery: { durationSec: 120 } });
  });
});
