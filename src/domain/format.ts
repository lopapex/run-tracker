import type { Block, IntensityRef, PaceChart, Segment, WorkoutSpec, WorkoutType } from './types';
import type { DistanceRange } from './distance';

export function resolvePaceChart(profile: {paceChart?: PaceChart; paceSource?: 'plan'|'profile'}, plan?: PaceChart): PaceChart {
  return profile.paceSource === 'profile' ? {...plan,...profile.paceChart} : {...profile.paceChart,...plan};
}

export function formatDistanceRange(r: DistanceRange): string {
  const min = Math.round(r.minM / 100) / 10;
  const max = Math.round(r.maxM / 100) / 10;
  return `${r.estimated ? '≈ ' : ''}${String(min).replace('.', ',')}${min !== max ? `–${String(max).replace('.', ',')}` : ''} km${r.unknown ? ' + nevyčíslené úseky' : ''}`;
}

export const INTENSITY_LABEL: Record<IntensityRef, string> = {
  easy: 'volně',
  steady: 'svižně',
  mp: 'maratonské tempo',
  hm_pace: 'tempo půlmaratonu',
  '10k_pace': 'tempo na 10 km',
  '5k_pace': 'tempo na 5 km',
  strides: 'rovinky',
  walk: 'chůze',
  free: 'podle pocitu',
};

export const TYPE_LABEL: Record<WorkoutType, string> = {
  easy: 'Volný běh',
  long: 'Dlouhý běh',
  speed: 'Rychlostní trénink',
  tempo: 'Tempový běh',
  race: 'Závod',
  rest: 'Volno',
  strength: 'Posilování',
  cross: 'Jiný sport',
  other: 'Trénink',
};

export function formatKm(m: number | undefined, digits = 1): string {
  if (m == null) return '–';
  const km = m / 1000;
  const s = km >= 100 || Number.isInteger(Math.round(km * 10) / 10) ? String(Math.round(km * 10) / 10) : km.toFixed(digits);
  return `${s.replace('.', ',')} km`;
}

export function formatDuration(sec: number | undefined): string {
  if (sec == null) return '–';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function formatShortDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return formatDuration(sec);
}

/** Tempo v s/km → `m:ss`. */
export function formatPace(secPerKm: number | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function paceOf(distanceM: number, durationSec: number): number | undefined {
  return distanceM > 0 && durationSec > 0 ? durationSec / (distanceM / 1000) : undefined;
}

function segmentText(s: Segment, chart?: PaceChart): string {
  const amount = s.distanceM != null ? (s.distanceM < 1000 ? `${s.distanceM} m` : formatKm(s.distanceM)) : s.durationSec != null ? formatShortDuration(s.durationSec) : '';
  const range = chart && s.intensity in chart ? chart[s.intensity as keyof PaceChart] : undefined;
  const pace = range ? ` (${formatPace(range.fromSec)}–${formatPace(range.toSec)}/km)` : '';
  return `${amount} ${INTENSITY_LABEL[s.intensity]}${pace}`.trim();
}

export function blockLines(blocks: Block[], chart?: PaceChart): string[] {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'segment': {
        const prefix = b.role === 'warmup' ? 'Rozklus: ' : b.role === 'cooldown' ? 'Výklus: ' : '';
        return prefix + segmentText(b, chart);
      }
      case 'repeat': {
        const rec = b.recovery ? `, mezi úseky ${segmentText(b.recovery)}` : '';
        return `${b.count}× ${[b.work, ...(b.more ?? [])].map((x) => segmentText(x, chart)).join(' + ')}${rec}`;
      }
      case 'strides':
        return `${b.count}× rovinka ${formatShortDuration(b.durationSec)}`;
      case 'note':
        return b.text;
    }
  });
}

export function workoutSummary(w: WorkoutSpec): string {
  if (w.type === 'rest') return 'Volno';
  const parts: string[] = [];
  if (w.distanceM != null) parts.push(formatKm(w.distanceM));
  else if (w.durationSec != null) parts.push(formatShortDuration(w.durationSec));
  const rep = w.blocks.find((b) => b.kind === 'repeat');
  if (rep && rep.kind === 'repeat') parts.push(`${rep.count}× ${segmentText(rep.work)}`);
  const strides = w.blocks.find((b) => b.kind === 'strides');
  if (strides && strides.kind === 'strides') parts.push(`${strides.count}× rovinka`);
  if (w.strengthMin) parts.push(`posilování ${w.strengthMin} min`);
  return parts.join(' · ') || TYPE_LABEL[w.type];
}

/** Odhad délky pro součty; jednotky zadané jen časem vrací undefined. */
export function workoutDistanceM(w: WorkoutSpec): number | undefined {
  if (w.type === 'rest' || w.type === 'strength') return 0;
  return w.distanceM;
}

export function isHard(w: WorkoutSpec): boolean {
  return w.load === 'high' || w.type === 'speed' || w.type === 'tempo' || w.type === 'race' || w.type === 'long';
}
