// Deterministická kostra plánu (§5.4). Sestaví přípustné rozložení a obsah z uvedených vstupů;
// AI ji může komentovat a upravovat příkazy, ale součty a rozestupy hlídá tenhle modul.
// Nejde o medicínsky přesný model zátěže a nepředstírá „pravidlo 10 %“ jako záruku.
import { addDays, diffDays, dowOf, weekStartOf } from './dates';
import { REST } from './schedule';
import type { Dow, DraftParams, TemplateDay, TemplateWeek, WorkoutSpec } from './types';

const km = (n: number) => Math.round(n) * 1000;

const easy = (m: number, strides = false): WorkoutSpec => ({
  type: 'easy',
  title: strides ? 'Volný běh s rovinkami' : 'Volný běh',
  distanceM: m,
  load: 'low',
  blocks: strides ? [{ kind: 'strides', count: 5, durationSec: 20 }] : [],
});

const long = (m: number, fastM = 0): WorkoutSpec => ({
  type: 'long',
  title: 'Dlouhý běh',
  distanceM: m,
  load: fastM > 0 ? 'high' : 'medium',
  blocks:
    fastM > 0
      ? [
          { kind: 'segment', role: 'steady', distanceM: m - fastM - 2000, intensity: 'easy' },
          { kind: 'segment', role: 'work', distanceM: fastM, intensity: 'hm_pace' },
          { kind: 'segment', role: 'cooldown', distanceM: 2000, intensity: 'easy' },
        ]
      : [],
});

const SESSIONS: Array<(m: number) => WorkoutSpec> = [
  (m) => ({
    type: 'speed', title: 'Intervaly 6× 3 min', distanceM: m, load: 'high',
    blocks: [
      { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
      { kind: 'repeat', count: 6, work: { role: 'work', durationSec: 180, intensity: '5k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'easy' }, recoveryAfterLast: false },
      { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
    ],
  }),
  (m) => ({
    type: 'tempo', title: 'Tempo 3× 8 min', distanceM: m, load: 'high',
    blocks: [
      { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
      { kind: 'repeat', count: 3, work: { role: 'work', durationSec: 480, intensity: 'hm_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'easy' }, recoveryAfterLast: false },
      { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
    ],
  }),
  (m) => ({
    type: 'speed', title: 'Intervaly 5× 1 km', distanceM: m, load: 'high',
    blocks: [
      { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
      { kind: 'repeat', count: 5, work: { role: 'work', distanceM: 1000, intensity: '10k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'easy' }, recoveryAfterLast: false },
      { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
    ],
  }),
  (m) => ({
    type: 'tempo', title: 'Souvislé tempo 20 min', distanceM: m, load: 'high',
    blocks: [
      { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
      { kind: 'segment', role: 'work', durationSec: 1200, intensity: 'hm_pace' },
      { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
    ],
  }),
];

const steady = (m: number): WorkoutSpec => ({
  type: 'easy', title: 'Běh se svižnějším koncem', distanceM: m, load: 'medium',
  blocks: [
    { kind: 'segment', role: 'steady', distanceM: Math.max(1000, m - 3000), intensity: 'easy' },
    { kind: 'segment', role: 'work', distanceM: Math.min(3000, m - 1000), intensity: 'steady' },
  ],
});

/** Vybere běžecké dny: dlouhý běh pevně, kvalitu co nejdál od něj, zbytek rovnoměrně. */
export function pickRunDays(p: Pick<DraftParams, 'runsPerWeek' | 'restDows' | 'longRunDow'>): { runDays: Dow[]; qualityDow: Dow | null } {
  const all: Dow[] = [0, 1, 2, 3, 4, 5, 6];
  const allowed = all.filter((d) => !p.restDows.includes(d));
  const longDow = allowed.includes(p.longRunDow) ? p.longRunDow : (allowed[allowed.length - 1] ?? 6);
  const n = Math.max(1, Math.min(p.runsPerWeek, allowed.length));
  const dist = (a: Dow, b: Dow) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
  const picked: Dow[] = [longDow];
  const rest = allowed.filter((d) => d !== longDow);
  let qualityDow: Dow | null = null;
  if (n >= 3 && rest.length > 0) {
    qualityDow = [...rest].sort((a, b) => dist(b, longDow) - dist(a, longDow) || a - b)[0];
    picked.push(qualityDow);
  }
  while (picked.length < n) {
    const candidates = rest.filter((d) => !picked.includes(d));
    if (candidates.length === 0) break;
    // Nejdřív dny, které nesousedí s už vybranými; mezi nimi ten nejdál od těžkých dnů.
    const score = (d: Dow) => Math.min(...picked.map((x) => dist(d, x))) * 10 - dist(d, longDow);
    picked.push([...candidates].sort((a, b) => score(b) - score(a) || a - b)[0]);
  }
  return { runDays: picked.sort((a, b) => a - b), qualityDow };
}

function weekVolumeKm(p: DraftParams, i: number, raceWeekIndex: number | null): number {
  const base = p.weeklyKm;
  if (p.intent === 'maintain') return base;
  const recovery = (i + 1) % 4 === 0;
  if (p.intent === 'improve') {
    const built = base * (1 + 0.05 * (i - Math.floor(i / 4)));
    return recovery ? built * 0.8 : built;
  }
  // Závod: růst k vrcholu, poslední dva týdny před závodem ubírají.
  const last = raceWeekIndex ?? p.weeks - 1;
  if (i === last) return base * 0.55;
  if (i === last - 1) return base * 0.8;
  if (i > last) return base * 0.6;
  const built = base * (1 + 0.05 * (i - Math.floor(i / 4)));
  return recovery ? built * 0.8 : built;
}

export function generateWeeks(p: DraftParams): TemplateWeek[] {
  const { runDays, qualityDow } = pickRunDays(p);
  const start = weekStartOf(p.startDate);
  const raceWeekIndex = p.intent === 'race' && p.raceDate ? Math.floor(diffDays(p.raceDate, start) / 7) : null;
  const longDow = runDays.includes(p.longRunDow) ? p.longRunDow : runDays[runDays.length - 1];
  const weeks: TemplateWeek[] = [];

  for (let i = 0; i < p.weeks; i++) {
    const volume = weekVolumeKm(p, i, raceWeekIndex);
    const isRaceWeek = raceWeekIndex === i && p.raceDate != null;
    const raceDow = isRaceWeek ? dowOf(p.raceDate!) : null;
    const recovery = p.intent !== 'maintain' && (i + 1) % 4 === 0;
    const n = runDays.length;
    const share = Math.max(5, Math.min(32, volume * (n <= 3 ? 0.4 : 0.3)));
    // Dlouhý běh navazuje na to, co běžec opravdu běhá: nejvýš o 1,5 km za týden nad jeho nejdelší běh.
    // Zbytek objemu připadne volným běhům, týdenní objem se nemění.
    const longKm = p.longestRunKm ? Math.max(5, Math.min(share, p.longestRunKm + 1.5 * (i + 1))) : share;
    const qualityKm = qualityDow != null ? Math.max(6, volume * 0.2) : 0;
    const easyCount = n - 1 - (qualityDow != null ? 1 : 0);
    const easyKm = easyCount > 0 ? Math.max(4, (volume - longKm - qualityKm) / easyCount) : 0;

    const days: TemplateDay[] = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).map((dow) => {
      let workout: WorkoutSpec = structuredClone(REST);
      if (raceDow === dow) {
        workout = { type: 'race', title: 'Závod', distanceM: p.raceDistanceM, load: 'high', blocks: [] };
      } else if (isRaceWeek && raceDow != null && dow > raceDow) {
        workout = structuredClone(REST);
      } else if (isRaceWeek && raceDow != null && dow === raceDow - 1) {
        workout = structuredClone(REST);
      } else if (runDays.includes(dow)) {
        if (dow === longDow && !isRaceWeek) {
          const fast = p.intent !== 'maintain' && !recovery && i % 2 === 1 ? km(Math.min(6, longKm * 0.2)) : 0;
          workout = long(km(longKm), fast);
        } else if (dow === qualityDow && !isRaceWeek) {
          if (p.intent === 'maintain') workout = i % 2 === 0 ? easy(km(qualityKm), true) : steady(km(qualityKm));
          else if (recovery) workout = easy(km(qualityKm), true);
          else workout = SESSIONS[(i - Math.floor(i / 4)) % SESSIONS.length](km(qualityKm));
        } else {
          workout = easy(km(isRaceWeek ? Math.min(easyKm, 8) : easyKm), isRaceWeek && raceDow != null && dow === raceDow - 2);
        }
      }
      return { dow, workout, source: { method: 'generated', review: 'unreviewed', issues: [] } };
    });

    weeks.push({
      index: i + 1,
      phase: isRaceWeek ? 'závod' : recovery ? 'odpočinkový' : p.intent === 'maintain' ? 'udržování' : 'rozvoj',
      days,
    });
  }
  return weeks;
}

export function weeksUntil(start: string, end: string): number {
  return Math.max(1, Math.floor(diffDays(end, weekStartOf(start)) / 7) + 1);
}

export function defaultStart(today: string): string {
  return addDays(weekStartOf(today), 7);
}
