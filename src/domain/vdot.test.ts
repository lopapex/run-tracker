import { describe, expect, it } from 'vitest';
import { predictTime, trainingPaces, vdotFromRace } from './vdot';

// Kontrolní hodnoty z tabulek Danielse: 5 km za 19:57 ≈ VDOT 50; VDOT 50 → 10 km 41:21, půlmaraton 1:31:35, maraton 3:10:49.
describe('tempa podle VDOT', () => {
  it('spočítá VDOT a předpovědi jako tabulky Danielse', () => {
    expect(vdotFromRace(5000, 19 * 60 + 57)).toBeCloseTo(50, 0);
    const near = (sec: number, expected: number) => expect(Math.abs(sec - expected)).toBeLessThanOrEqual(30);
    near(predictTime(50, 10000), 41 * 60 + 21);
    near(predictTime(50, 21097.5), 91 * 60 + 35);
    near(predictTime(50, 42195), 3 * 3600 + 10 * 60 + 49);
  });

  it('z půlmaratonu za 1:30 dá tempa blízká tabulce referenčního plánu', () => {
    const r = trainingPaces(21097.5, 90 * 60);
    expect(r.vdot).toBeGreaterThan(50);
    expect(r.vdot).toBeLessThan(52);
    // referenční plán L4 uvádí pro 1:30 volné tempo 5:04–5:36 /km
    expect(Math.abs(r.chart.easy.fromSec - 304)).toBeLessThanOrEqual(15);
    expect(Math.abs(r.chart.easy.toSec - 336)).toBeLessThanOrEqual(25);
    expect(r.chart.hm_pace.fromSec).toBe(254); // 1:30:00 / 21,0975 km = 4:16
    expect(r.chart['5k_pace'].fromSec).toBeLessThan(r.chart['10k_pace'].fromSec);
    expect(r.chart.mp.fromSec).toBeGreaterThan(r.chart.hm_pace.fromSec);
  });
});
