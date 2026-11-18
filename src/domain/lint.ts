// Kontroly přepsaného plánu. Jsou to jen varování: upozorní na pravděpodobnou chybu přepisu,
// ale import ani aktivaci neblokují. Uživatel je může nechat být.
import { plannedDistance, workoutDistance } from './distance';
import type { Block, PaceChart, Segment, TemplateWeek, WorkoutSpec } from './types';

export interface WeekIssue { dow: number; title: string; text: string }

const FAST = new Set(['steady', 'mp', 'hm_pace', '10k_pace', '5k_pace', 'strides']);
const segmentsOf = (blocks: Block[]): Segment[] => blocks.flatMap((b) => (b.kind === 'segment' ? [b] : b.kind === 'repeat' ? [b.work, ...(b.more ?? []), ...(b.recovery ? [b.recovery] : [])] : []));
const hasStrides = (w: WorkoutSpec) => w.blocks.some((b) => b.kind === 'strides' || (b.kind === 'segment' && b.intensity === 'strides') || (b.kind === 'repeat' && [b.work, ...(b.more ?? [])].some((s) => s.intensity === 'strides')));
const km = (m: number) => String(Math.round(m / 100) / 10).replace('.', ',');

/** Varování k jedné jednotce: věci, které v přepisu skoro jistě nesedí. */
export function lintWorkout(w: WorkoutSpec, chart?: PaceChart): string[] {
  if (w.type === 'rest') return [];
  const out: string[] = [];
  for (const s of segmentsOf(w.blocks)) {
    if (s.intensity === 'strides' && ((s.distanceM ?? 0) > 300 || (s.durationSec ?? 0) > 60)) {
      out.push(`Rovinky jsou krátké úseky do 30 s, tady jsou ${s.distanceM ? km(s.distanceM) + ' km' : Math.round((s.durationSec ?? 0) / 60) + ' min'}. Nejspíš má být běh volně a rovinky zvlášť.`);
    }
  }
  for (const b of w.blocks) {
    if (b.kind === 'repeat' && b.count > 1 && !b.recovery && [b.work, ...(b.more ?? [])].some((s) => FAST.has(s.intensity))) out.push(`${b.count}× úsek bez pauzy mezi opakováními. Plán pauzu obvykle uvádí.`);
  }
  if (/rovink|stride/i.test(w.title) && !hasStrides(w)) out.push('Název zmiňuje rovinky, v rozpisu nejsou.');
  if ((w.type === 'speed' || w.type === 'tempo') && w.blocks.length && !segmentsOf(w.blocks).some((s) => FAST.has(s.intensity))) out.push('Rychlá jednotka nemá žádný úsek v rychlejším tempu.');
  const named = /(\d+(?:[.,]\d+)?)\s*km\b/i.exec(w.title);
  const range = workoutDistance(w, chart);
  if (named && !range.unknown && range.maxM > 0) {
    const titled = parseFloat(named[1].replace(',', '.')) * 1000;
    if (titled < range.minM - 1000 || titled > range.maxM + 1000) out.push(`Název uvádí ${km(titled)} km, rozpis dává ${km(range.minM)}${range.maxM !== range.minM ? '–' + km(range.maxM) : ''} km.`);
  }
  return out;
}

/** Varování k týdnu: jednotky a vztahy mezi nimi (dlouhý běh kratší než jiný běh). */
export function lintWeek(week: Pick<TemplateWeek, 'days'>, chart?: PaceChart): WeekIssue[] {
  const issues: WeekIssue[] = week.days.flatMap((d) => lintWorkout(d.workout, chart).map((text) => ({ dow: d.dow, title: d.workout.title, text })));
  const long = week.days.find((d) => d.workout.type === 'long');
  if (long) {
    const longMax = plannedDistance([long.workout], chart).maxM;
    const longer = week.days.find((d) => d !== long && d.workout.type !== 'race' && plannedDistance([d.workout], chart).minM > longMax + 500);
    if (longMax > 0 && longer) issues.push({ dow: long.dow, title: long.workout.title, text: `Dlouhý běh je kratší než ${longer.workout.title}.` });
  }
  return issues;
}

/** Tempa z dokumentu: pořadí od nejpomalejšího a rozumné meze (2:30–9:00 /km). */
export function lintPaceChart(chart: PaceChart | undefined): string[] {
  if (!chart) return [];
  const out: string[] = [];
  const order = ['easy', 'steady', 'mp', 'hm_pace', '10k_pace', '5k_pace'] as const;
  for (const k of order) {
    const r = chart[k];
    if (r && (Math.min(r.fromSec, r.toSec) < 150 || Math.max(r.fromSec, r.toSec) > 540)) out.push(`Tempo „${k}“ je mimo rozumné meze (2:30–9:00 /km); zkontroluj převod na sekundy na kilometr.`);
  }
  const present = order.filter((k) => chart[k]);
  for (let i = 1; i < present.length; i++) {
    const slower = chart[present[i - 1]]!, faster = chart[present[i]]!;
    if (Math.min(faster.fromSec, faster.toSec) > Math.max(slower.fromSec, slower.toSec)) out.push(`Tempo „${present[i]}“ vychází pomalejší než „${present[i - 1]}“; nejspíš jsou prohozená.`);
  }
  return out;
}
