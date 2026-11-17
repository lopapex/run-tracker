// Tréninková tempa ze závodního výkonu podle vzorců Jacka Danielse a Jimmyho Gilberta (VDOT).
// Deterministický výpočet, aby model tempa neodhadoval.
import type { PaceChart } from './types';

/** Spotřeba kyslíku při rychlosti v (m/min), ml/kg/min. */
const vo2At = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
/** Podíl VO2max, který jde udržet t minut. */
const fractionFor = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
/** Rychlost (m/min), při které je spotřeba daná hodnota (kladný kořen kvadratické rovnice). */
const speedFor = (vo2: number) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (vo2 + 4.6))) / (2 * 0.000104);

export function vdotFromRace(distanceM: number, timeSec: number): number {
  const t = timeSec / 60;
  return vo2At(distanceM / t) / fractionFor(t);
}

/** Předpověď času na vzdálenost pro dané VDOT (bisekce). */
export function predictTime(vdot: number, distanceM: number): number {
  let lo = distanceM / 1000 * 120, hi = distanceM / 1000 * 900;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(distanceM, mid) > vdot) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

const paceAtFraction = (vdot: number, fraction: number) => Math.round(60_000 / speedFor(vdot * fraction));

export interface PaceResult {
  vdot: number;
  predictions: Array<{ label: string; distanceM: number; timeSec: number }>;
  chart: Required<Pick<PaceChart, 'easy' | 'steady' | 'mp' | 'hm_pace' | '10k_pace' | '5k_pace'>>;
}

export const RACES = [
  { label: '5 km', distanceM: 5000 },
  { label: '10 km', distanceM: 10000 },
  { label: 'půlmaraton', distanceM: 21097.5 },
  { label: 'maraton', distanceM: 42195 },
];

/** Rozsahy: volné tempo 62–74 % VDOT, svižné 75–80 %, závodní tempa z předpovědi ± 2 s/km. */
export function trainingPaces(distanceM: number, timeSec: number): PaceResult {
  const vdot = vdotFromRace(distanceM, timeSec);
  const predictions = RACES.map((r) => ({ ...r, timeSec: predictTime(vdot, r.distanceM) }));
  const racePace = (i: number) => {
    const p = Math.round(predictions[i].timeSec / (predictions[i].distanceM / 1000));
    return { fromSec: p - 2, toSec: p + 2 };
  };
  return {
    vdot: Math.round(vdot * 10) / 10,
    predictions,
    chart: {
      easy: { fromSec: paceAtFraction(vdot, 0.74), toSec: paceAtFraction(vdot, 0.62) },
      steady: { fromSec: paceAtFraction(vdot, 0.8), toSec: paceAtFraction(vdot, 0.75) },
      mp: racePace(3),
      hm_pace: racePace(2),
      '10k_pace': racePace(1),
      '5k_pace': racePace(0),
    },
  };
}
