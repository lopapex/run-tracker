// Data pro vizualizace v konverzaci. Každá funkce jen čte prostor a vrací text pro model
// a strukturovaná data pro widget. Nic se tu neukládá; data běhu ze Stravy se jen přepočítají a vrátí.
import { z } from 'zod';
import { addDays, diffDays, dowOf, isIsoDate, todayIso, weekStartOf } from '../domain/dates';
import { workoutDistance } from '../domain/distance';
import { blockLines, formatKm, formatPace, INTENSITY_LABEL, resolvePaceChart, workoutSummary } from '../domain/format';
import { dayWorkouts, planRange } from '../domain/schedule';
import type { Block, IntensityRef, PaceChart, PlanActivation, ScheduledWorkout, Segment, WorkoutSpec } from '../domain/types';
import { resolveId } from './tools';
import { describeStep, encodeWorkoutFit, workoutSteps } from './fit';
import { CONDITIONS, type Condition, type Workspace } from './workspace';

export type View = { ok: true; text: string; data: Record<string, unknown> } | { ok: false; text: string };
const fail = (text: string): View => ({ ok: false, text });

const isoDate = z.string().refine(isIsoDate, 'Datum musí být RRRR-MM-DD.');
export const weekViewInput = z.object({ date: isoDate.optional().describe('Libovolný den týdne; bez něj probíhající týden.') });
export const paceViewInput = z.object({ workoutId: z.string().optional().describe('Id jednotky z get_plan; přidá rozpis jejích úseků s cílovými tempy.') });
export const garminInput = z.object({ workoutId: z.string().min(1).describe('Id běžecké jednotky z get_plan.') });
export const resultViewInput = z.object({
  workoutId: z.string().min(1).describe('Id naplánované jednotky z get_plan, se kterou se běh porovná.'),
  run: z.object({
    name: z.string().max(80).optional(),
    date: isoDate.optional(),
    distanceM: z.number().positive().max(300_000),
    movingSec: z.number().positive().max(48 * 3600),
    avgHr: z.number().min(30).max(250).optional(),
    elevGainM: z.number().min(0).max(20_000).optional(),
    laps: z.array(z.object({ distanceM: z.number().positive().max(100_000), durationSec: z.number().positive().max(12 * 3600), avgHr: z.number().min(30).max(250).optional() })).max(80).optional(),
  }).optional().describe('Čísla skutečného běhu ze Stravy nebo od uživatele. Bez nich widget nabídne jen zápis splnění.'),
  conditions: z.array(z.enum(Object.keys(CONDITIONS) as [Condition, ...Condition[]])).max(8).optional().describe('Okolnosti, které uživatel zmínil (cold, heat, wind, rain, hills, poor_sleep, alcohol, dehydrated, tired, sick, stress, sore); zohlední se v hodnocení.'),
});

const NOT_RUN = new Set(['rest', 'strength', 'cross']);
const km = (m: number) => Math.round(m / 100) / 10;

interface Ctx { activation: PlanActivation; chart: PaceChart; all: ScheduledWorkout[]; today: string; planName: string }
function context(ws: Workspace, now: Date): Ctx | null {
  const activation = ws.activations.find((a) => a.status === 'active');
  if (!activation) return null;
  const template = ws.templates.find((t) => t.id === activation.templateId);
  return {
    activation,
    chart: resolvePaceChart(ws.profile, template?.paceChart),
    all: ws.workouts.filter((w) => w.activationId === activation.id),
    today: todayIso(ws.profile.timezone, now),
    planName: template?.name ?? 'Plán',
  };
}
const NO_PLAN = 'Uživatel nemá aktivní plán. Plán vznikne přes import_plan_weeks a activate_plan.';

/** Bez plánu widget ukáže, jak začít, místo chybové hlášky. */
function emptyView(ws: Workspace): View {
  return {
    ok: true,
    text: `${NO_PLAN} Widget uživateli ukazuje, jak začít; nabídni mu nahrání plánu.`,
    data: { view: 'empty', staged: ws.staged ? { name: ws.staged.name, weeks: ws.staged.weeks.map((w) => w.index) } : null },
  };
}

function paceRows(chart: PaceChart) {
  return Object.entries(chart).map(([key, range]) => ({ key, label: INTENSITY_LABEL[key as IntensityRef], fromSec: Math.min(range.fromSec, range.toSec), toSec: Math.max(range.fromSec, range.toSec) }));
}

function workoutCard(ws: Workspace, w: ScheduledWorkout, chart: PaceChart) {
  const d = workoutDistance(w.workout, chart);
  const note = ws.notes.find((n) => n.workoutId === w.id);
  return {
    id: w.id, date: w.date, title: w.workout.title, type: w.workout.type, load: w.workout.load ?? null, status: w.status,
    summary: workoutSummary(w.workout), lines: blockLines(w.workout.blocks, chart), planNote: w.workout.note ?? null,
    kmMin: km(d.minM), kmMax: km(d.maxM), kmUnknown: d.unknown > 0, moved: w.date !== w.originDate, skipReason: w.skipReason ?? null,
    feel: note?.feel ?? null, pain: note?.pain ?? null, userNote: note?.note ?? null, conditions: (note?.conditions ?? []).map((x) => CONDITIONS[x]),
  };
}

function weekStats(workouts: ScheduledWorkout[], chart: PaceChart) {
  const runs = workouts.filter((w) => !NOT_RUN.has(w.workout.type));
  const sum = (list: ScheduledWorkout[]) => list.reduce((acc, w) => { const d = workoutDistance(w.workout, chart); return { min: acc.min + d.minM, max: acc.max + d.maxM }; }, { min: 0, max: 0 });
  const planned = sum(runs.filter((w) => w.status !== 'skipped'));
  const done = sum(runs.filter((w) => w.status === 'completed' || w.status === 'partial'));
  const long = runs.filter((w) => w.workout.type === 'long' && w.status !== 'skipped').map((w) => workoutDistance(w.workout, chart).maxM);
  return {
    plannedKmMin: km(planned.min), plannedKmMax: km(planned.max), doneKm: km(done.min),
    units: runs.length, unitsDone: runs.filter((w) => w.status === 'completed').length, unitsPartial: runs.filter((w) => w.status === 'partial').length, unitsSkipped: runs.filter((w) => w.status === 'skipped').length,
    longRunKm: long.length ? km(Math.max(...long)) : null,
  };
}

// ---------- Týden ----------

export function weekView(ws: Workspace, input: z.infer<typeof weekViewInput>, now: Date = new Date()): View {
  const c = context(ws, now);
  if (!c) return emptyView(ws);
  const start = weekStartOf(input.date ?? c.today);
  const mapping = c.activation.mapping.find((m) => m.weekStart === start);
  const template = ws.templates.find((t) => t.id === c.activation.templateId);
  const source = mapping?.sourceWeek != null ? template?.weeks.find((w) => w.index === mapping.sourceWeek) : undefined;
  const inWeek = c.all.filter((w) => w.date >= start && w.date <= addDays(start, 6));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, dow: i, isToday: date === c.today, isPast: date < c.today, workouts: dayWorkouts(inWeek, date).map((w) => workoutCard(ws, w, c.chart)) };
  });
  const stats = weekStats(inWeek, c.chart);
  const label = !mapping ? 'mimo plán' : mapping.sourceWeek == null ? 'pauza' : `týden ${mapping.sourceWeek} z ${template?.weeks.length ?? '?'}`;
  const next = days.flatMap((d) => d.workouts).find((w) => w.date >= c.today && w.status === 'scheduled' && w.type !== 'rest');
  return {
    ok: true,
    text: `Zobrazen týden od ${start} (${label}): splněno ${stats.unitsDone} z ${stats.units} běhů, ${String(stats.doneKm).replace('.', ',')} km z ${String(stats.plannedKmMin).replace('.', ',')}${stats.plannedKmMax !== stats.plannedKmMin ? `–${String(stats.plannedKmMax).replace('.', ',')}` : ''} km.${next ? ` Nejbližší jednotka: ${next.title} ${next.date}.` : ''} Uživatel widget vidí; neopakuj celý rozpis, jen krátce okomentuj.`,
    data: { view: 'week', planName: c.planName, today: c.today, weekStart: start, label, hasPrev: c.activation.mapping.some((m) => m.weekStart < start), hasNext: c.activation.mapping.some((m) => m.weekStart > start), phase: source?.phase ?? null, authorNote: source?.note ?? null, isCurrent: start === weekStartOf(c.today), days, stats, nextId: next?.id ?? null },
  };
}

// ---------- Celý plán ----------

export function planView(ws: Workspace, now: Date = new Date()): View {
  const c = context(ws, now);
  if (!c) return emptyView(ws);
  const template = ws.templates.find((t) => t.id === c.activation.templateId);
  const currentStart = weekStartOf(c.today);
  const weeks = [...c.activation.mapping].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map((m) => {
    const inWeek = c.all.filter((w) => w.date >= m.weekStart && w.date <= addDays(m.weekStart, 6));
    const source = m.sourceWeek != null ? template?.weeks.find((w) => w.index === m.sourceWeek) : undefined;
    return { weekStart: m.weekStart, sourceWeek: m.sourceWeek, phase: source?.phase ?? null, isCurrent: m.weekStart === currentStart, isPast: m.weekStart < currentStart, ...weekStats(inWeek, c.chart) };
  });
  const range = planRange(c.activation);
  const race = ws.profile.raceDate ?? null;
  const total = weeks.reduce((s, w) => s + w.plannedKmMin, 0);
  const done = weeks.reduce((s, w) => s + w.doneKm, 0);
  const units = weeks.reduce((s, w) => s + w.units, 0);
  const unitsDone = weeks.reduce((s, w) => s + w.unitsDone, 0);
  const current = weeks.find((w) => w.isCurrent);
  return {
    ok: true,
    text: `Zobrazen přehled plánu „${c.planName}“: ${weeks.length} týdnů${range ? `, ${range.first} až ${range.last}` : ''}. Splněno ${unitsDone} z ${units} běhů a ${Math.round(done)} z ${Math.round(total)} km.${current?.sourceWeek != null ? ` Probíhá týden ${current.sourceWeek}.` : ''} Uživatel widget vidí; jen krátce okomentuj.`,
    data: { view: 'plan', planName: c.planName, today: c.today, first: range?.first ?? null, last: range?.last ?? null, raceDate: race, daysToRace: race ? diffDays(race, c.today) : null, weeks, totals: { plannedKm: Math.round(total), doneKm: Math.round(done), units, unitsDone } },
  };
}

// ---------- Tempa ----------

function segmentRow(s: Segment, reps: number, label: string, chart: PaceChart) {
  const range = chart[s.intensity as keyof PaceChart];
  const fast = range ? Math.min(range.fromSec, range.toSec) : null;
  const slow = range ? Math.max(range.fromSec, range.toSec) : null;
  return {
    label, reps, intensity: s.intensity, intensityLabel: INTENSITY_LABEL[s.intensity],
    durationSec: s.durationSec ?? null, distanceM: s.distanceM ?? null, paceFastSec: fast, paceSlowSec: slow,
    // Úsek daný časem → kolik to bude metrů; úsek daný vzdáleností → za jak dlouho.
    distMinM: s.durationSec != null && slow ? Math.round(s.durationSec / slow * 1000) : null,
    distMaxM: s.durationSec != null && fast ? Math.round(s.durationSec / fast * 1000) : null,
    timeMinSec: s.distanceM != null && fast ? Math.round(s.distanceM / 1000 * fast) : null,
    timeMaxSec: s.distanceM != null && slow ? Math.round(s.distanceM / 1000 * slow) : null,
  };
}

function segmentRows(blocks: Block[], chart: PaceChart) {
  const rows: ReturnType<typeof segmentRow>[] = [];
  for (const b of blocks) {
    if (b.kind === 'segment') rows.push(segmentRow(b, 1, b.role === 'warmup' ? 'Rozklus' : b.role === 'cooldown' ? 'Výklus' : b.role === 'recovery' ? 'Pauza' : 'Úsek', chart));
    else if (b.kind === 'repeat') {
      for (const part of [b.work, ...(b.more ?? [])]) rows.push(segmentRow(part, b.count, 'Rychlý úsek', chart));
      if (b.recovery) rows.push(segmentRow(b.recovery, b.recoveryAfterLast === true ? b.count : Math.max(0, b.count - 1), 'Pauza', chart));
    } else if (b.kind === 'strides') rows.push(segmentRow({ role: 'work', durationSec: b.durationSec, intensity: 'strides' }, b.count, 'Rovinka', chart));
  }
  return rows;
}

export function paceView(ws: Workspace, input: z.infer<typeof paceViewInput>, now: Date = new Date()): View {
  const c = context(ws, now);
  const chart = c?.chart ?? resolvePaceChart(ws.profile);
  const paces = paceRows(chart);
  let workout: Record<string, unknown> | null = null;
  if (input.workoutId) {
    const wanted = resolveId(c?.all ?? [], input.workoutId);
    const w = c?.all.find((x) => x.id === wanted);
    if (!w) return fail('Jednotka v rozpisu není. Načti aktuální id přes get_plan.');
    workout = { id: w.id, date: w.date, title: w.workout.title, summary: workoutSummary(w.workout), rows: segmentRows(w.workout.blocks, chart), raw: w.workout.rawInstruction ?? null };
  }
  if (!paces.length && !workout) return fail('Tempa nejsou zadaná. Ulož je přes set_profile (paceChart) nebo je pošli s importem plánu.');
  return {
    ok: true,
    text: `Zobrazen pomocník temp: ${paces.map((p) => `${p.label} ${formatPace(p.fromSec)}–${formatPace(p.toSec)}/km`).join('; ') || 'tempa nejsou zadaná'}.${workout ? ` Rozepsaná jednotka: ${workout.title} ${workout.date}.` : ''} Uživatel widget vidí včetně převodníku; neopakuj tabulku.`,
    data: { view: 'paces', paces, workout },
  };
}

// ---------- Doběhnuto: hodnocení splnění a zápis ----------

function targetOf(w: WorkoutSpec, chart: PaceChart): IntensityRef | null {
  const parts: Segment[] = w.blocks.flatMap((b) => (b.kind === 'segment' ? [b] : b.kind === 'repeat' ? [b.work, ...(b.more ?? [])] : []));
  const work = parts.find((p) => p.role === 'work' && chart[p.intensity as keyof PaceChart]);
  if (work && (w.type === 'speed' || w.type === 'tempo' || w.type === 'race')) return work.intensity;
  return chart.easy && (w.type === 'easy' || w.type === 'long' || w.type === 'other') ? 'easy' : work?.intensity ?? null;
}

/** Okolnosti, které samy o sobě zpomalují: pomalejší tempo se pak nehodnotí jako chyba. */
const SLOWING: Condition[] = ['cold', 'heat', 'wind', 'rain', 'hills', 'poor_sleep', 'alcohol', 'dehydrated', 'tired', 'sick', 'sore'];

/** Odhad splnění 0–100. Je to hrubé vodítko z vzdálenosti a průměrného tempa, ne měření kvality tréninku. */
function scoreOf(distanceM: number, plannedMinM: number, plannedMaxM: number, avgPaceSec: number, target: { fastSec: number; slowSec: number } | null, steady: boolean, conditions: Condition[]) {
  const parts: Array<{ label: string; value: number; text: string }> = [];
  if (plannedMaxM > 0) {
    const ratio = distanceM / plannedMinM;
    const value = ratio >= 0.97 ? (distanceM > plannedMaxM * 1.15 ? 90 : 100) : Math.max(0, Math.round(ratio * 100));
    parts.push({ label: 'Vzdálenost', value, text: ratio >= 0.97 ? (value === 90 ? 'výrazně delší než plán' : 'odpovídá plánu') : `${Math.round(ratio * 100)} % plánované vzdálenosti` });
  }
  let paceWeight = 0.4;
  if (target && steady) {
    const fasterBy = target.fastSec - avgPaceSec, slowerBy = avgPaceSec - target.slowSec;
    const excused = slowerBy > 2 && conditions.some((c) => SLOWING.includes(c));
    const value = fasterBy > 2 ? Math.round(100 - Math.min(40, fasterBy * 2)) : slowerBy > 2 ? Math.round(100 - Math.min(40, slowerBy * 1.5)) : 100;
    if (excused) paceWeight = 0.15;
    parts.push({ label: 'Tempo', value, text: fasterBy > 2 ? `o ${Math.round(fasterBy)} s/km rychleji než cílové pásmo` : slowerBy > 2 ? `o ${Math.round(slowerBy)} s/km pomaleji než cílové pásmo${excused ? '; okolnosti to vysvětlují, váha tempa je snížená' : ''}` : 'v cílovém pásmu' });
  }
  if (!parts.length) return null;
  const dist = parts.find((p) => p.label === 'Vzdálenost'), pace = parts.find((p) => p.label === 'Tempo');
  const total = Math.round(dist && pace ? dist.value * (1 - paceWeight) + pace.value * paceWeight : (dist ?? pace)!.value);
  return { total, label: total >= 90 ? 'Splněno' : total >= 70 ? 'Splněno s odchylkou' : 'Splněno částečně', suggestedStatus: total >= 70 ? 'completed' : 'partial', parts };
}

export function resultView(ws: Workspace, input: z.infer<typeof resultViewInput>, now: Date = new Date()): View {
  const c = context(ws, now);
  if (!c) return fail(NO_PLAN);
  const wanted = resolveId(c.all, input.workoutId);
  const w = c.all.find((x) => x.id === wanted);
  if (!w) return fail('Jednotka v rozpisu není. Načti aktuální id přes get_plan.');
  const saved = ws.notes.find((n) => n.workoutId === w.id);
  const conditions = [...new Set([...(saved?.conditions ?? []), ...(input.conditions ?? [])])];
  const planned = workoutDistance(w.workout, c.chart);
  const intensity = targetOf(w.workout, c.chart);
  const range = intensity ? c.chart[intensity as keyof PaceChart] : undefined;
  const target = intensity && range ? { key: intensity, label: INTENSITY_LABEL[intensity], fastSec: Math.min(range.fromSec, range.toSec), slowSec: Math.max(range.fromSec, range.toSec) } : null;
  const steady = w.workout.type === 'easy' || w.workout.type === 'long';
  const base = {
    view: 'result',
    workout: { id: w.id, date: w.date, title: w.workout.title, type: w.workout.type, summary: workoutSummary(w.workout), lines: blockLines(w.workout.blocks, c.chart), kmMin: km(planned.minM), kmMax: km(planned.maxM), kmUnknown: planned.unknown > 0, status: w.status, dow: dowOf(w.date) },
    checkin: { status: w.status, feel: saved?.feel ?? null, pain: saved?.pain ?? null, note: saved?.note ?? null, conditions },
    conditionLabels: CONDITIONS,
    target,
  };
  const { run } = input;
  if (!run) {
    return {
      ok: true,
      text: `Zobrazen zápis doběhnuté jednotky ${w.workout.title} (${w.date}). Uživatel ve widgetu vybere stav, pocit a okolnosti a uloží je sám; když je řekne slovy, zapiš je přes set_status.`,
      data: { ...base, run: null, score: null, verdict: null },
    };
  }
  const avgPaceSec = run.movingSec / (run.distanceM / 1000);
  const laps = (run.laps ?? []).map((l, i) => ({ n: i + 1, distanceM: Math.round(l.distanceM), durationSec: Math.round(l.durationSec), paceSec: Math.round(l.durationSec / (l.distanceM / 1000)), avgHr: l.avgHr ?? null }));
  const inTarget = target ? laps.filter((l) => l.paceSec >= target.fastSec - 2 && l.paceSec <= target.slowSec + 2).length : null;
  const distance = planned.maxM === 0 ? null : run.distanceM < planned.minM - 300 ? 'short' : run.distanceM > planned.maxM + 300 ? 'long' : 'ok';
  const pace = !target || !steady ? null : avgPaceSec < target.fastSec - 2 ? 'faster' : avgPaceSec > target.slowSec + 2 ? 'slower' : 'in';
  const score = scoreOf(run.distanceM, planned.minM, planned.maxM, avgPaceSec, target, steady, conditions);
  const text = [
    `Zobrazeno hodnocení běhu proti jednotce ${w.workout.title} (${w.date}).`,
    `Běh ${formatKm(run.distanceM)}, průměrné tempo ${formatPace(avgPaceSec)}/km; plán ${planned.maxM ? `${String(km(planned.minM)).replace('.', ',')}${planned.maxM !== planned.minM ? `–${String(km(planned.maxM)).replace('.', ',')}` : ''} km` : 'bez dané vzdálenosti'}${planned.unknown ? ' + nevyčíslené úseky' : ''}.`,
    score ? `Odhad splnění ${score.total} % (${score.label}): ${score.parts.map((p) => `${p.label.toLowerCase()} ${p.text}`).join('; ')}.` : '',
    target && laps.length && !steady ? `V pásmu ${target.label} bylo ${inTarget} z ${laps.length} kol.` : '',
    conditions.length ? `Okolnosti: ${conditions.map((x) => CONDITIONS[x]).join(', ')}.` : '',
    'Čísla běhu se jen vykreslila, Run Tracker je neuložil. Uživatel může stav, pocit a okolnosti uložit ve widgetu; krátce zhodnoť a případně navrhni úpravu dalších dnů.',
  ].filter(Boolean).join(' ');
  return {
    ok: true,
    text,
    data: {
      ...base,
      run: { name: run.name ?? null, date: run.date ?? null, distanceM: Math.round(run.distanceM), movingSec: Math.round(run.movingSec), avgPaceSec: Math.round(avgPaceSec), avgHr: run.avgHr ?? null, elevGainM: run.elevGainM ?? null, laps },
      score, verdict: { distance, pace, lapsInTarget: inTarget, steady },
    },
  };
}

// ---------- Export do hodinek Garmin ----------

export function garminExport(ws: Workspace, input: z.infer<typeof garminInput>, now: Date = new Date()): { view: View; file?: { name: string; bytes: Uint8Array } } {
  const c = context(ws, now);
  if (!c) return { view: fail(NO_PLAN) };
  const wanted = resolveId(c.all, input.workoutId);
  const w = c.all.find((x) => x.id === wanted);
  if (!w) return { view: fail('Jednotka v rozpisu není. Načti aktuální id přes get_plan.') };
  if (NOT_RUN.has(w.workout.type)) return { view: fail('Do hodinek jde poslat jen běžecká jednotka.') };
  const steps = workoutSteps(w.workout, c.chart);
  const name = `${w.workout.title} ${w.date.slice(8)}.${w.date.slice(5, 7)}.`;
  const fileName = `run-tracker-${w.date}-${w.workout.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trenink'}.fit`;
  return {
    file: { name: fileName, bytes: encodeWorkoutFit(name, steps, now) },
    view: {
      ok: true,
      text: `Připraven trénink pro Garmin: ${w.workout.title} (${w.date}), ${steps.length} kroků.`,
      data: { view: 'garmin', workout: { id: w.id, date: w.date, title: w.workout.title, summary: workoutSummary(w.workout), dow: dowOf(w.date) }, steps: steps.map(describeStep), fileName, hasPaces: steps.some((s) => s.targetType === 0) },
    },
  };
}
