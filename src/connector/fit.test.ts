// Export pro Garmin: soubor musí přečíst nezávislý dekodér FIT a vrátit stejné kroky.
import FitParser from 'fit-file-parser';
import { describe, expect, it } from 'vitest';
import { describeStep, encodeWorkoutFit, workoutSteps } from './fit';
import type { WorkoutSpec } from '../domain/types';

const chart = { easy: { fromSec: 304, toSec: 336 }, '5k_pace': { fromSec: 240, toSec: 250 } };
const speed: WorkoutSpec = {
  type: 'speed', title: 'Speed Session', blocks: [
    { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
    { kind: 'repeat', count: 6, work: { role: 'work', distanceM: 400, intensity: '5k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'walk' }, recoveryAfterLast: null },
    { kind: 'strides', count: 4, durationSec: 20 },
    { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
  ],
};

function decode(bytes: Uint8Array): Promise<any> {
  return new Promise((resolve, reject) => new FitParser({ force: false, mode: 'list' }).parse(bytes.buffer as ArrayBuffer, (err: unknown, data: unknown) => (err ? reject(err) : resolve(data))));
}

describe('export pro Garmin', () => {
  it('rozloží jednotku na kroky včetně opakování a cílových temp', () => {
    const steps = workoutSteps(speed, chart);
    expect(steps.map(describeStep)).toEqual([
      'Rozklus volně · 15 min · 5:04–5:36 /km',
      'Úsek tempo na 5 km · 400 m · 4:00–4:10 /km',
      'Pauza chůze · 2 min',
      'Opakuj 6× od kroku 2',
      'Rovinka · 20 s',
      'Volně · 1 min',
      'Opakuj 4× od kroku 5',
      'Výklus volně · 10 min · 5:04–5:36 /km',
    ]);
    // názvy v hodinkách jsou ASCII a krátké
    expect(steps.map((s) => s.name)).toEqual(['Rozklus volne', 'Usek tempo 5k', 'Pauza chuze', '', 'Rovinka', 'Volne', '', 'Vyklus volne']);
    expect(steps[1]).toMatchObject({ durationType: 1, durationValue: 40000, targetType: 0, speedLow: 4000, speedHigh: 4167 });
    expect(workoutSteps({ type: 'easy', title: 'Easy Run', distanceM: 10000, blocks: [] }, chart)).toMatchObject([{ durationType: 1, durationValue: 1_000_000, speedLow: 2976 }]);
  });

  it('vyrobí platný FIT soubor, který nezávislý dekodér přečte', async () => {
    const steps = workoutSteps(speed, chart);
    const bytes = encodeWorkoutFit('Speed Session', steps, new Date('2026-11-17T08:00:00Z'));
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
    const data = await decode(bytes);
    expect(data.file_ids[0]).toMatchObject({ type: 'workout' });
    expect(data.workout).toMatchObject({ sport: 'running', num_valid_steps: 8, wkt_name: 'Speed Session' });
    // delší název tréninku se nezkracuje na 15 znaků
    expect((await decode(encodeWorkoutFit('Speed Session 14.12.', steps))).workout.wkt_name).toBe('Speed Session 14.12.');
    // dekodér vrací poslední krok souboru; postupným zkracováním se ověří každý druh kroku
    const last = async (count: number) => (await decode(encodeWorkoutFit('x', steps.slice(0, count)))).workout_step;
    expect(await last(8)).toMatchObject({ message_index: { value: 7 }, wkt_step_name: 'Vyklus volne', duration_type: 'time', duration_value: 600000, target_type: 'speed', custom_target_value_low: 2976, custom_target_value_high: 3289, intensity: 'cooldown' });
    expect(await last(2)).toMatchObject({ duration_type: 'distance', duration_value: 40000, target_type: 'speed', custom_target_value_low: 4000, custom_target_value_high: 4167, intensity: 'active' });
    expect(await last(3)).toMatchObject({ duration_type: 'time', duration_value: 120000, target_type: 'open', intensity: 'rest' });
    const rep = await last(4);
    console.log(JSON.stringify(rep));
    expect(rep).toMatchObject({ duration_type: 'repeat_until_steps_cmplt', duration_value: 1, target_value: 6 });
  });
});
