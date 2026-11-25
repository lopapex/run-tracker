// Data pro vizualizace v konverzaci. Každá funkce jen čte prostor a vrací text pro model
// a strukturovaná data pro widget. Nic se tu neukládá; data běhu ze Stravy se jen přepočítají a vrátí.
import { z } from 'zod';
import { addDays, diffDays, dowOf, isIsoDate, todayIso, weekStartOf } from '../domain/dates';
import { plannedDistance, workoutDistance } from '../domain/distance';
import { lintPaceChart, lintWeek } from '../domain/lint';
import { blockLines, formatKm, formatPace, INTENSITY_LABEL, resolvePaceChart, workoutSummary } from '../domain/format';
import { dayWorkouts, planRange } from '../domain/schedule';
import type { Block, IntensityRef, PaceChart, PlanActivation, ScheduledWorkout, Segment, WorkoutSpec } from '../domain/types';
import { planSummaries, resolveId } from './tools';
import { describeStep, encodeWorkoutFit, workoutSteps } from './fit';
import { predictTime, trainingPaces, vdotFromRace } from '../domain/vdot';
import { checkinVersion, CONDITIONS, fatigueOf, type Condition, type Workspace } from './workspace';

export type View = { ok: true; text: string; data: Record<string, unknown> } | { ok: false; text: string };
const fail = (text: string): View => ({ ok: false, text });

const isoDate = z.string().refine(isIsoDate, 'Datum musí být RRRR-MM-DD.');
export const weekViewInput = z.object({ date: isoDate.optional().describe('Libovolný den týdne; bez něj probíhající týden.') });
export const paceViewInput = z.object({ workoutId: z.string().optional().describe('Id jednotky z get_plan; přidá rozpis jejích úseků s cílovými tempy.') });
export const calcInput = z.object({
  distanceM: z.number().min(1000).max(50_000).describe('Vzdálenost výkonu v metrech (5000, 10000, 21097.5, 42195 nebo jiná).'),
  timeSec: z.number().int().min(180).max(8 * 3600).describe('Čas výkonu v sekundách.'),
  save: z.boolean().default(false).describe('Uložit vypočtená tempa do profilu. Jen když s tím uživatel souhlasí.'),
});
export const garminInput = z.object({ workoutId: z.string().min(1).describe('Id běžecké jednotky z get_plan.') });
export const resultViewInput = z.object({
  workoutId: z.string().min(1).describe('Id naplánované jednotky z get_plan, se kterou se běh porovná.'),
  fromCard: z.boolean().optional().describe('Jen pro kartu samotnou; nevyplňuj.'),
  run: z.object({
    date: isoDate.optional(),
    distanceM: z.number().positive().max(300_000),
    movingSec: z.number().positive().max(48 * 3600),
    avgHr: z.number().min(30).max(250).optional(),
    elevGainM: z.number().min(0).max(20_000).optional(),
    laps: z.array(z.object({ distanceM: z.number().positive().max(100_000), durationSec: z.number().positive().max(12 * 3600) })).max(80).optional().describe('Bez tepu, nejvýš 30.'),
    reps: z.array(z.object({ distanceM: z.number().positive().max(50_000), durationSec: z.number().positive().max(4 * 3600), avgHr: z.number().min(30).max(250).optional() })).max(40).optional().describe('Jen rychlé pracovní úseky intervalů, spočítané z kol (bez rozklusu a pauz).'),
  }).optional().describe('Čísla skutečného běhu ze Stravy nebo od uživatele. Bez nich karta nabídne jen zápis.'),
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
    version: checkinVersion(w.status, note),
  };
}

/** `unrecorded`: proběhlé dny, kde jednotka pořád čeká na zápis splnění. */
function weekStats(workouts: ScheduledWorkout[], chart: PaceChart, today: string) {
  const runs = workouts.filter((w) => !NOT_RUN.has(w.workout.type));
  const sum = (list: ScheduledWorkout[]) => list.reduce((acc, w) => { const d = workoutDistance(w.workout, chart); return { min: acc.min + d.minM, max: acc.max + d.maxM }; }, { min: 0, max: 0 });
  const planned = sum(runs.filter((w) => w.status !== 'skipped'));
  const done = sum(runs.filter((w) => w.status === 'completed' || w.status === 'partial'));
  const long = runs.filter((w) => w.workout.type === 'long' && w.status !== 'skipped').map((w) => workoutDistance(w.workout, chart).maxM);
  return {
    plannedKmMin: km(planned.min), plannedKmMax: km(planned.max), doneKm: km(done.min),
    units: runs.length, unitsDone: runs.filter((w) => w.status === 'completed').length, unitsPartial: runs.filter((w) => w.status === 'partial').length, unitsSkipped: runs.filter((w) => w.status === 'skipped').length,
    longRunKm: long.length ? km(Math.max(...long)) : null,
    unrecorded: runs.filter((w) => w.status === 'scheduled' && w.date < today).length,
  };
}

// ---------- Týden ----------

/** Po posledním týdnu plánu: shrnutí a nabídka dalšího, místo prázdného týdne „mimo plán“. */
function finishedView(ws: Workspace, today: string): View {
  const all = planSummaries(ws);
  const plan = all.find((s) => s.active)!;
  const earlier = all.filter((s) => !s.active).slice(-3).reverse();
  return {
    ok: true,
    text: `Plán „${plan.name}“ skončil ${plan.last}: splněno ${plan.done} z ${plan.runs} běhů, ${plan.doneKm} z ${plan.plannedKm} km podle plánu. Uživatel vidí shrnutí; nabídni další plán (draft_plan podle Stravy a poznámek, nebo import dokumentu).`,
    data: { view: 'finished', today, plan, earlier, hasNotes: Boolean(ws.profile.coachNotes) },
  };
}

export function weekView(ws: Workspace, input: z.infer<typeof weekViewInput>, now: Date = new Date()): View {
  const c = context(ws, now);
  if (!c) return emptyView(ws);
  const range = planRange(c.activation);
  if (!input.date && range && weekStartOf(c.today) > range.last) return finishedView(ws, c.today);
  const start = weekStartOf(input.date ?? c.today);
  const mapping = c.activation.mapping.find((m) => m.weekStart === start);
  const template = ws.templates.find((t) => t.id === c.activation.templateId);
  const source = mapping?.sourceWeek != null ? template?.weeks.find((w) => w.index === mapping.sourceWeek) : undefined;
  const inWeek = c.all.filter((w) => w.date >= start && w.date <= addDays(start, 6));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, dow: i, isToday: date === c.today, isPast: date < c.today, workouts: dayWorkouts(inWeek, date).map((w) => workoutCard(ws, w, c.chart)) };
  });
  const stats = weekStats(inWeek, c.chart, c.today);
  // Únava se ukazuje jen v probíhajícím týdnu: u minulých a budoucích by rušila.
  const fatigue = start === weekStartOf(c.today) ? fatigueOf(ws.notes, c.today) : null;
  const label = !mapping ? 'mimo plán' : mapping.sourceWeek == null ? 'pauza' : `týden ${mapping.sourceWeek} z ${template?.weeks.length ?? '?'}`;
  const next = days.flatMap((d) => d.workouts).find((w) => w.date >= c.today && w.status === 'scheduled' && w.type !== 'rest');
  return {
    ok: true,
    text: `Zobrazen týden od ${start} (${label}): splněno ${stats.unitsDone} z ${stats.units} běhů, tj. ${String(stats.doneKm).replace('.', ',')} z ${String(stats.plannedKmMin).replace('.', ',')}${stats.plannedKmMax !== stats.plannedKmMin ? `–${String(stats.plannedKmMax).replace('.', ',')}` : ''} km podle plánu (ne naměřeno).${next ? ` Nejbližší jednotka: ${next.title} ${next.date}.` : ''}${stats.unrecorded ? ` Nezapsáno: ${stats.unrecorded} proběhlých běhů; nabídni doplnění (podle Stravy, pokud je připojená) jedním voláním set_statuses.` : ''}${fatigue ? ` Únava: ${fatigue.text} Zeptej se, jak se cítí, a nabídni lehčí zbytek týdne; rozpis měň jen se souhlasem${fatigue.kind === 'pain' ? ', při bolesti doporuč ubrat a nechat se vyšetřit' : ''}.` : ''}`,
    data: { view: 'week', planName: c.planName, today: c.today, weekStart: start, label, daysToRace: ws.profile.raceDate && ws.profile.raceDate >= c.today ? diffDays(ws.profile.raceDate, c.today) : null, fatigue, hasPrev: c.activation.mapping.some((m) => m.weekStart < start), hasNext: c.activation.mapping.some((m) => m.weekStart > start), phase: source?.phase ?? null, isCurrent: start === weekStartOf(c.today), days, stats, nextId: next?.id ?? null, rev: ws.revisions[ws.revisions.length - 1]?.id ?? null },
  };
}

// ---------- Kontrola importu ----------

/** Rozpracovaný import po týdnech: součty proti autorovi a varování. Nic neblokuje, jen ukazuje. */
export function importView(ws: Workspace): View {
  const st = ws.staged;
  if (!st || !st.weeks.length) return fail('Rozpracovaný import je prázdný.');
  const chart = resolvePaceChart(ws.profile, st.paceChart);
  const DAY = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
  const weeks = st.weeks.map((w) => {
    const r = plannedDistance(w.days.map((d) => d.workout), chart);
    const declared = w.declaredTotalM ?? null;
    const totals = declared == null ? 'none' : declared < r.minM - 500 || (!r.unknown && declared > r.maxM + 500) ? 'off' : r.unknown ? 'unknown' : 'ok';
    return { index: w.index, phase: w.phase ?? null, kmMin: km(r.minM), kmMax: km(r.maxM), declaredKm: declared == null ? null : km(declared), totals, issues: lintWeek(w, chart).map((x) => ({ day: DAY[x.dow], title: x.title, text: x.text })) };
  });
  const missing: number[] = [];
  for (let i = 1; i <= st.weeks[st.weeks.length - 1].index; i++) if (!st.weeks.some((w) => w.index === i)) missing.push(i);
  const paceIssues = lintPaceChart(st.paceChart);
  const count = weeks.reduce((s, w) => s + w.issues.length + (w.totals === 'off' ? 1 : 0), 0) + paceIssues.length;
  return {
    ok: true,
    text: `Zobrazena kontrola importu „${st.name}“: ${st.weeks.length} týdnů, ${count} varování.`,
    data: { view: 'import', name: st.name, weeks, missing, hasPaces: Boolean(st.paceChart && Object.keys(st.paceChart).length), paceIssues, warnings: count },
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
    return { weekStart: m.weekStart, sourceWeek: m.sourceWeek, phase: source?.phase ?? null, isCurrent: m.weekStart === currentStart, isPast: m.weekStart < currentStart, ...weekStats(inWeek, c.chart, c.today) };
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
    text: `Zobrazen přehled plánu „${c.planName}“: ${weeks.length} týdnů${range ? `, ${range.first} až ${range.last}` : ''}. Splněno ${unitsDone} z ${units} běhů, tj. ${Math.round(done)} z ${Math.round(total)} km podle plánu (ne naměřeno).${current?.sourceWeek != null ? ` Probíhá týden ${current.sourceWeek}.` : ''} Uživatel widget vidí; jen krátce okomentuj.`,
    data: { view: 'plan', planName: c.planName, today: c.today, finished: Boolean(range && range.last < c.today), first: range?.first ?? null, last: range?.last ?? null, raceDate: race, daysToRace: race ? diffDays(race, c.today) : null, weeks, totals: { plannedKm: Math.round(total), doneKm: Math.round(done), units, unitsDone, unrecorded: weeks.reduce((s, w) => s + w.unrecorded, 0) }, fitness: fitnessOf(ws) },
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
    text: `Zobrazen pomocník temp: ${paces.map((p) => `${p.label} ${formatPace(p.fromSec)}–${formatPace(p.toSec)}/km`).join('; ') || 'tempa nejsou zadaná'}.${workout ? ` Rozepsaná jednotka: ${workout.title} ${workout.date}.` : ''} Uživatel widget vidí; neopakuj tabulku.`,
    data: { view: 'paces', paces, workout },
  };
}

// ---------- Doběhnuto: hodnocení splnění a zápis ----------

/** Intenzity rychlejší než volný běh: jednotka s nimi nejde hodnotit průměrným tempem celého běhu. */
const FAST: IntensityRef[] = ['steady', 'mp', 'hm_pace', '10k_pace', '5k_pace'];
const segmentsOf = (w: WorkoutSpec): Segment[] => w.blocks.flatMap((b) => (b.kind === 'segment' ? [b] : b.kind === 'repeat' ? [b.work, ...(b.more ?? [])] : []));

/** Cílové pásmo: tempo rychlých úseků, když je jednotka má, jinak volné tempo. */
function targetOf(w: WorkoutSpec, chart: PaceChart): IntensityRef | null {
  const fast = segmentsOf(w).find((p) => FAST.includes(p.intensity) && chart[p.intensity as keyof PaceChart]);
  if (fast) return fast.intensity;
  return chart.easy && (w.type === 'easy' || w.type === 'long' || w.type === 'other') ? 'easy' : null;
}

/** Běh celý v jednom tempu: jen ten jde porovnat průměrným tempem. Dlouhý běh s úseky v tempu půlmaratonu ne. */
function isSteady(w: WorkoutSpec): boolean {
  return (w.type === 'easy' || w.type === 'long') && !w.blocks.some((b) => b.kind === 'repeat') && !segmentsOf(w).some((p) => FAST.includes(p.intensity));
}

/** Okolnosti, které samy o sobě zpomalují: pomalejší tempo se pak nehodnotí jako chyba. */
const SLOWING: Condition[] = ['cold', 'heat', 'wind', 'rain', 'hills', 'poor_sleep', 'alcohol', 'dehydrated', 'tired', 'sick', 'sore'];

/** Odhad splnění 0–100. Je to hrubé vodítko z vzdálenosti a průměrného tempa, ne měření kvality tréninku. */
interface RepRow { n: number; distanceM: number; durationSec: number; paceSec: number; avgHr: number | null; offSec: number }

/** Odchylka tempa úseku od pásma v s/km: kladná = pomaleji, záporná = rychleji, 0 = v pásmu (tolerance 2 s). */
function offBand(paceSec: number, t: { fastSec: number; slowSec: number }): number {
  if (paceSec < t.fastSec - 2) return paceSec - t.fastSec;
  if (paceSec > t.slowSec + 2) return paceSec - t.slowSec;
  return 0;
}

function scoreOf(distanceM: number, plannedMinM: number, plannedMaxM: number, unknown: boolean, avgPaceSec: number, target: { fastSec: number; slowSec: number } | null, steady: boolean, conditions: Condition[], reps: RepRow[] = []) {
  const parts: Array<{ label: string; value: number; text: string }> = [];
  if (plannedMaxM > 0) {
    // Část jednotky zadaná jen časem bez tempa nemá vzdálenost: delší běh pak není chyba.
    const ratio = distanceM / (plannedMinM > 0 ? plannedMinM : plannedMaxM);
    const tooLong = !unknown && distanceM > plannedMaxM * 1.15;
    const value = ratio >= 0.97 ? (tooLong ? 90 : 100) : Math.max(0, Math.round(ratio * 100));
    parts.push({ label: 'Vzdálenost', value, text: ratio >= 0.97 ? (tooLong ? 'výrazně delší než plán' : unknown ? 'odpovídá plánu (část jen na čas)' : 'odpovídá plánu') : `${Math.round(ratio * 100)} % plánované vzdálenosti` });
  }
  let paceWeight = 0.4;
  if (target && steady) {
    const fasterBy = target.fastSec - avgPaceSec, slowerBy = avgPaceSec - target.slowSec;
    const excused = slowerBy > 2 && conditions.some((c) => SLOWING.includes(c));
    const value = fasterBy > 2 ? Math.round(100 - Math.min(40, fasterBy * 2)) : slowerBy > 2 ? Math.round(100 - Math.min(40, slowerBy * 1.5)) : 100;
    if (excused) paceWeight = 0.15;
    parts.push({ label: 'Tempo', value, text: fasterBy > 2 ? `o ${Math.round(fasterBy)} s/km rychleji než cílové pásmo` : slowerBy > 2 ? `o ${Math.round(slowerBy)} s/km pomaleji než cílové pásmo${excused ? ' (okolnosti to vysvětlují)' : ''}` : 'v cílovém pásmu' });
  }
  if (target && !steady && reps.length) {
    // U intervalů rozhoduje tempo rychlých úseků; vzdálenost celého běhu má menší váhu.
    const inBand = reps.filter((r) => r.offSec === 0).length;
    const avgOff = reps.reduce((s, r) => s + Math.abs(r.offSec), 0) / reps.length;
    const slower = reps.filter((r) => r.offSec > 0).length, faster = reps.filter((r) => r.offSec < 0).length;
    const excused = slower > 0 && conditions.some((c) => SLOWING.includes(c));
    paceWeight = excused ? 0.25 : 0.5;
    const trend = slower > faster ? 'pomaleji' : 'rychleji';
    parts.push({ label: 'Úseky', value: Math.round(100 - Math.min(40, avgOff * 3)), text: `${inBand} z ${reps.length} v cílovém pásmu${avgOff >= 1 ? `, průměrně o ${Math.round(avgOff)} s/km ${trend}` : ''}${excused ? ' (okolnosti to vysvětlují)' : ''}` });
  }
  if (!parts.length) return null;
  const dist = parts.find((p) => p.label === 'Vzdálenost'), pace = parts.find((p) => p.label === 'Tempo' || p.label === 'Úseky');
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
  const steady = isSteady(w.workout);
  const base = {
    view: 'result',
    workout: { id: w.id, date: w.date, title: w.workout.title, type: w.workout.type, summary: workoutSummary(w.workout), lines: blockLines(w.workout.blocks, c.chart), kmMin: km(planned.minM), kmMax: km(planned.maxM), kmUnknown: planned.unknown > 0, status: w.status, dow: dowOf(w.date) },
    checkin: { status: w.status, feel: saved?.feel ?? null, pain: saved?.pain ?? null, note: saved?.note ?? null, conditions, saved: saved?.conditions ?? [], version: checkinVersion(w.status, saved) },
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
  const laps = (run.laps ?? []).map((l, i) => ({ n: i + 1, distanceM: Math.round(l.distanceM), durationSec: Math.round(l.durationSec), paceSec: Math.round(l.durationSec / (l.distanceM / 1000)) }));
  const inTarget = target ? laps.filter((l) => l.paceSec >= target.fastSec - 2 && l.paceSec <= target.slowSec + 2).length : null;
  const distance = planned.maxM === 0 ? null : run.distanceM < planned.minM - 300 ? 'short' : run.distanceM > planned.maxM + 300 && !planned.unknown ? 'long' : 'ok';
  const pace = !target || !steady ? null : avgPaceSec < target.fastSec - 2 ? 'faster' : avgPaceSec > target.slowSec + 2 ? 'slower' : 'in';
  const reps: RepRow[] = (run.reps ?? []).map((r, i) => {
    const paceSec = Math.round(r.durationSec / (r.distanceM / 1000));
    return { n: i + 1, distanceM: Math.round(r.distanceM), durationSec: Math.round(r.durationSec), paceSec, avgHr: r.avgHr ?? null, offSec: target ? offBand(paceSec, target) : 0 };
  });
  const score = scoreOf(run.distanceM, planned.minM, planned.maxM, planned.unknown > 0, avgPaceSec, target, steady, conditions, reps);
  const estimate = estimateOf(ws, target?.key, steady, run.distanceM, avgPaceSec, reps, conditions);
  const text = [
    `Zobrazeno hodnocení běhu proti jednotce ${w.workout.title} (${w.date}).`,
    `Běh ${formatKm(run.distanceM)}, průměrné tempo ${formatPace(avgPaceSec)}/km; plán ${planned.maxM ? `${String(km(planned.minM)).replace('.', ',')}${planned.maxM !== planned.minM ? `–${String(km(planned.maxM)).replace('.', ',')}` : ''} km` : 'bez dané vzdálenosti'}${planned.unknown ? ' + nevyčíslené úseky' : ''}.`,
    score ? `Odhad splnění ${score.total} % (${score.label}): ${score.parts.map((p) => `${p.label.toLowerCase()} ${p.text}`).join('; ')}.` : '',
    target && laps.length && !steady ? `V pásmu ${target.label} bylo ${inTarget} z ${laps.length} kol (počítají se i rozklus a pauzy).` : '',
    !steady && !reps.length ? 'Jednotka má rychlé úseky, proto se průměrné tempo celého běhu nehodnotí. Pošli rychlé úseky v run.reps a ohodnotí se jejich tempo.' : '',
    conditions.length ? `Okolnosti: ${conditions.map((x) => CONDITIONS[x]).join(', ')}.` : '',
    estimate ? `Odhad formy: VDOT ${String(estimate.vdot).replace('.', ',')} (${estimate.basis}), odpovídá ${formatKm(estimate.distanceM)} za ${formatTime(estimate.sec)}.` : '',
    'Čísla běhu se jen vykreslila, Run Tracker je neuložil. Pocit a bolest uživatel doplní v kartě; když je řekne slovy, zapiš je přes set_status.',
  ].filter(Boolean).join(' ');
  return {
    ok: true,
    text,
    data: {
      ...base,
      run: { date: run.date ?? null, distanceM: Math.round(run.distanceM), movingSec: Math.round(run.movingSec), avgPaceSec: Math.round(avgPaceSec), avgHr: run.avgHr ?? null, elevGainM: run.elevGainM ?? null, laps, reps },
      score, estimate, verdict: { distance, pace, lapsInTarget: inTarget, steady },
    },
  };
}

// ---------- Odhad formy ----------

const RACE_OF: Record<string, { distanceM: number; label: string }> = {
  '5k_pace': { distanceM: 5000, label: 'tempo na 5 km' }, '10k_pace': { distanceM: 10000, label: 'tempo na 10 km' },
  hm_pace: { distanceM: 21097.5, label: 'tempo půlmaratonu' }, mp: { distanceM: 42195, label: 'maratonské tempo' },
};
const formatTime = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0'); };

/** Odhad VDOT jen z úseků v závodním tempu (úseky nebo tempový běh) a bez okolností, které zpomalují.
 *  Tempo úseků se bere jako závodní tempo dané vzdálenosti; protože jsou úseky kratší než závod, je odhad spíš optimistický. */
function estimateOf(ws: Workspace, key: string | undefined, steady: boolean, distanceM: number, avgPaceSec: number, reps: RepRow[], conditions: Condition[]) {
  const race = key ? RACE_OF[key] : undefined;
  if (!race || conditions.some((x) => SLOWING.includes(x))) return null;
  const repM = reps.reduce((s, r) => s + r.distanceM, 0);
  const pace = reps.length && repM >= 2000 ? reps.reduce((s, r) => s + r.durationSec, 0) / (repM / 1000) : steady && distanceM >= 3000 ? avgPaceSec : null;
  if (!pace) return null;
  const vdot = Math.round(vdotFromRace(race.distanceM, pace * race.distanceM / 1000) * 10) / 10;
  if (vdot < 20 || vdot > 90) return null;
  const goal = ws.profile.raceDistanceM ?? 10000;
  return { vdot, basis: reps.length ? `úseky v pásmu „${race.label}“` : `běh v pásmu „${race.label}“`, distanceM: goal, sec: predictTime(vdot, goal) };
}

/** Křivka formy z uložených odhadů: poslední tři zprůměrované jako současná forma. */
function fitnessOf(ws: Workspace) {
  const points = ws.notes.filter((n) => n.vdot != null).sort((a, b) => a.date.localeCompare(b.date)).map((n) => ({ date: n.date, vdot: n.vdot! }));
  if (!points.length) return null;
  const last = points.slice(-3);
  const vdot = Math.round(last.reduce((s, p) => s + p.vdot, 0) / last.length * 10) / 10;
  const distanceM = ws.profile.raceDistanceM ?? 10000;
  return { points: points.slice(-20), vdot, distanceM, predictedSec: predictTime(vdot, distanceM), targetSec: ws.profile.raceTargetSec ?? null };
}

// ---------- Tempa z výkonu (VDOT) ----------

export function calcView(input: z.infer<typeof calcInput>): View {
  const r = trainingPaces(input.distanceM, input.timeSec);
  const paces = paceRows(r.chart);
  const fmt = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
  return {
    ok: true,
    text: `Tempa podle VDOT ${String(r.vdot).replace('.', ',')} z výkonu ${formatKm(input.distanceM)} za ${fmt(input.timeSec)} (vzorce Danielse a Gilberta): ${paces.map((p) => `${p.label} ${formatPace(p.fromSec)}–${formatPace(p.toSec)}`).join('; ')}. Předpověď: ${r.predictions.map((p) => `${p.label} ${fmt(p.timeSec)}`).join(', ')}. Předpověď platí pro odpovídající trénink na danou vzdálenost. ${input.save ? 'Tempa jsou uložená v profilu.' : 'Tempa nejsou uložená; ulož je jen se souhlasem uživatele (save: true).'} Používej tato čísla, neodhaduj vlastní.`,
    data: { view: 'paces', paces, workout: null, calc: { vdot: r.vdot, distanceM: input.distanceM, timeSec: input.timeSec, predictions: r.predictions, saved: input.save } },
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
  const fileName = `run-tracker-${w.date}-${w.workout.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trenink'}.fit`;
  return {
    file: { name: fileName, bytes: encodeWorkoutFit(name, steps, now) },
    view: {
      ok: true,
      text: `Připraven trénink pro Garmin: ${w.workout.title} (${w.date}), ${steps.length} kroků.`,
      data: { view: 'garmin', workout: { id: w.id, date: w.date, title: w.workout.title, summary: workoutSummary(w.workout), dow: dowOf(w.date) }, steps: steps.map(describeStep), fileName, hasPaces: steps.some((s) => s.targetType === 0) },
    },
  };
}
