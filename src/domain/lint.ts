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
  // „5× 1 km“ je délka úseku, ne celé jednotky.
  const named = /(?<![×x*]\s?)\b(\d+(?:[.,]\d+)?)\s*km\b/i.exec(w.title);
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

// ---------- Automatické opravy přepisu ----------

const RACE_DISTANCES: Array<[RegExp, number]> = [
  [/p[ůu]l\s*-?\s*maraton|half\s*-?\s*marathon|\bHM\b|21[,.]1/i, 21097.5],
  [/maraton|marathon|42[,.]2/i, 42195],
  [/\b10\s*(?:k|km)\b/i, 10000],
  [/\b5\s*(?:k|km)\b/i, 5000],
];

/** Opraví chyby přepisu, které jsou skoro jisté a mají jednoznačnou nápravu. Vrátí opravený předpis
 *  a popis každé opravy; nejasné věci nechá na varováních. Původní znění zůstává v rawInstruction. */
export function autofixWorkout(input: WorkoutSpec): { workout: WorkoutSpec; fixes: string[] } {
  const w: WorkoutSpec = structuredClone(input);
  const fixes: string[] = [];
  const text = `${w.title}\n${w.rawInstruction ?? ''}`;
  // Závod bez délky: délka je v názvu („Half Marathon!“) a bez ní nesedí týdenní součet.
  if (w.type === 'race' && w.distanceM == null && !w.blocks.some((b) => b.kind !== 'note')) {
    const hit = RACE_DISTANCES.find(([re]) => re.test(text));
    if (hit) { w.distanceM = hit[1]; fixes.push(`závod bez vzdálenosti, doplněno ${km(hit[1])} km podle názvu`); }
  }
  // „10k + 5x 20s Strides“ přepsané jako 10 km rovinek: běh je volný a rovinky jsou zvláštní blok.
  const long = w.blocks.filter((b): b is Extract<Block, { kind: 'segment' }> => b.kind === 'segment' && b.intensity === 'strides' && ((b.distanceM ?? 0) > 300 || (b.durationSec ?? 0) > 60));
  if (long.length) {
    for (const b of long) { b.intensity = 'easy'; if (b.role === 'work') b.role = 'steady'; }
    const m = /(\d+)\s*[x×]\s*(\d+)\s*(?:s\b|sec|"|vteř|sekund)/i.exec(text);
    const hasStrides = w.blocks.some((b) => b.kind === 'strides');
    if (m && !hasStrides) w.blocks.push({ kind: 'strides', count: +m[1], durationSec: +m[2] });
    fixes.push(`běh vedený jako rovinky změněn na volný${m && !hasStrides ? `, rovinky ${m[1]}× ${m[2]} s zvlášť` : ''}`);
  }
  return { workout: w, fixes };
}

// ---------- Kontrola týdenního součtu ----------

/** Široká pásma pro kontrolu součtů, když dokument tempa neuvádí: úsek na čas se tak dá aspoň odhadnout
 *  a velký rozdíl proti autorovi (vypadlý den, závod bez délky) se ukáže. Jen pro kontrolu, ne pro appku. */
const CHECK_PACES: PaceChart = {
  easy: { fromSec: 270, toSec: 450 }, steady: { fromSec: 240, toSec: 400 }, mp: { fromSec: 220, toSec: 380 },
  hm_pace: { fromSec: 210, toSec: 360 }, '10k_pace': { fromSec: 200, toSec: 340 }, '5k_pace': { fromSec: 190, toSec: 330 },
};
const CHECK_FREE = { fromSec: 240, toSec: 450 };

export type TotalCheck = { minM: number; maxM: number; unknown: boolean; declaredM: number | null; status: 'none' | 'ok' | 'off' | 'unknown' };

/** Součet týdne proti součtu, který uvádí autor plánu. Tolerance 1 km nebo 4 %. */
export function checkWeekTotal(week: Pick<TemplateWeek, 'days' | 'declaredTotalM'>, chart?: PaceChart): TotalCheck {
  // 'free' v PaceChart není, segment() ho ale hledá podle klíče stejně jako ostatní pásma.
  const wide = { ...CHECK_PACES, ...chart, free: CHECK_FREE } as unknown as PaceChart;
  const r = plannedDistance(week.days.map((d) => d.workout), wide);
  const declared = week.declaredTotalM ?? null;
  if (declared == null) return { minM: r.minM, maxM: r.maxM, unknown: r.unknown > 0, declaredM: null, status: 'none' };
  const slack = Math.max(1000, declared * 0.04);
  // Míň než součet známých délek je chyba vždy; víc jde posoudit jen bez úplně nevyčíslených úseků.
  const off = declared < r.minM - slack || (!r.unknown && declared > r.maxM + slack);
  return { minM: r.minM, maxM: r.maxM, unknown: r.unknown > 0, declaredM: declared, status: off ? 'off' : r.unknown ? 'unknown' : 'ok' };
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
