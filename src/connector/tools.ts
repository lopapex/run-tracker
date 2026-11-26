// Operace konektoru nad prostorem uživatele. Čisté funkce: dostanou prostor, upraví ho na místě
// a vrátí text pro model. Změny rozpisu jdou vždy přes registr příkazů z domény (vratná revize).
import { z } from 'zod';
import { applyScheduleCommand, OPERATION_LABEL, projectRevision, revertRevision, workoutSpecSchema, type ScheduleOperation, type ScheduleSnapshot } from '../domain/commands';
import { addDays, DOW_LONG, dowOf, formatDay, isIsoDate, todayIso, weekStartOf } from '../domain/dates';
import { plannedDistance } from '../domain/distance';
import { blockLines, formatDistanceRange, formatKm, formatPace, resolvePaceChart, workoutSummary } from '../domain/format';
import { createActivation, newId, planRange } from '../domain/schedule';
import { defaultStart, generateWeeks, weeksUntil } from '../domain/generator';
import { predictTime, trainingPaces } from '../domain/vdot';
import { autofixWorkout, checkWeekTotal, lintPaceChart, lintWeek } from '../domain/lint';
import type { Dow, PaceChart, PaceTableRow, PlanActivation, PlanTemplate, ScheduledWorkout, TemplateWeek } from '../domain/types';
import { checkinVersion, CONDITIONS, fatigueOf, MAX_REVISIONS, type Condition, type ConnectorRevision, type WorkoutNote, type Workspace } from './workspace';

/** `banner` je krátké shrnutí pro appku, když je text pro model delší. */
export type Outcome = { ok: true; text: string; changed: boolean; banner?: string } | { ok: false; text: string };
const fail = (text: string): Outcome => ({ ok: false, text });
const done = (text: string, changed = true): Outcome => ({ ok: true, text, changed });

// ---------- Vstupní schémata ----------

const isoDate = z.string().refine(isIsoDate, 'Datum musí být RRRR-MM-DD.');
const dow = z.number().int().min(0).max(6);
const paceRange = z.object({ fromSec: z.number().int().min(120).max(900), toSec: z.number().int().min(120).max(900) });
export const paceChartSchema = z.object({ easy: paceRange, steady: paceRange, mp: paceRange, hm_pace: paceRange, '10k_pace': paceRange, '5k_pace': paceRange }).partial();

export const planRangeInput = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const profileInput = z.object({
  timezone: z.string().max(60).optional(),
  intent: z.enum(['maintain', 'improve', 'race']).optional(),
  weeklyKm: z.number().min(0).max(300).optional(),
  runsPerWeek: z.number().int().min(1).max(7).optional(),
  restDows: z.array(dow).max(6).optional(),
  longRunDow: dow.optional(),
  raceDate: isoDate.optional(),
  raceDistanceM: z.number().positive().max(200_000).optional(),
  raceTargetSec: z.number().int().positive().max(48 * 3600).optional(),
  paceChart: paceChartSchema.optional(),
  strava: z.boolean().optional().describe('Uživatel má v Claude připojený konektor Strava. Appka podle toho ukáže nebo skryje tlačítka Stravy.'),
  notes: z.string().max(1500).optional().describe('Poznámky trenéra o běžci: zranění a omezení, dny a časy, cíle, závody, co mu nesedí. Pošli celé nové znění; prázdný text poznámky smaže.'),
});

export const draftInput = z.object({
  name: z.string().min(1).max(80),
  intent: z.enum(['maintain', 'improve', 'race']).describe('maintain = udržování, improve = postupné zlepšení, race = příprava na závod'),
  weeks: z.number().int().min(1).max(30).optional().describe('Počet týdnů; u závodu se dopočítá z data závodu.'),
  weeklyKm: z.number().min(5).max(250).describe('Výchozí týdenní objem v km, nejlíp průměr posledních 4 týdnů ze Stravy.'),
  longestRunKm: z.number().min(3).max(60).optional().describe('Nejdelší běh posledních 4–6 týdnů ze Stravy; dlouhý běh od něj poroste postupně.'),
  runsPerWeek: z.number().int().min(2).max(7),
  restDows: z.array(dow).max(5).default([]).describe('Dny bez běhu (0 = pondělí … 6 = neděle).'),
  longRunDow: dow.default(6),
  startDate: isoDate.optional().describe('Začátek plánu; bez něj příští pondělí.'),
  raceDate: isoDate.optional(),
  raceDistanceM: z.number().positive().max(200_000).optional(),
});

export const stageInput = z.object({
  name: z.string().min(1).max(80),
  units: z.enum(['km', 'mi']).default('km'),
  paceChart: paceChartSchema.optional(),
  paceTable: z.array(z.object({ goalSec: z.number().int().min(600).max(8 * 3600), paces: paceChartSchema })).min(2).max(10).optional()
    .describe('Celá tabulka temp, má-li dokument řádky pro různé cílové časy: každý řádek s cílovým časem závodu v sekundách. Appka pak tempa přepočítá podle cíle.'),
  restart: z.boolean().default(false),
  weeks: z.array(z.object({
    index: z.number().int().min(1).max(52),
    phase: z.string().max(40).optional(),
    note: z.string().max(1500).optional(),
    declaredTotalM: z.number().positive().max(400_000).optional(),
    days: z.array(z.object({ dow, workout: workoutSpecSchema })).length(7),
  })).min(1).max(8),
});

export const goalInput = z.object({
  goalSec: z.number().int().min(600).max(8 * 3600).describe('Cílový čas závodu v sekundách.'),
  method: z.enum(['table', 'vdot']).optional().describe('Podle čeho tempa počítat: table = tabulka temp z plánu, vdot = VDOT na délku závodu. Bez něj zůstane dosavadní volba. Čas mimo rozsah zvolené metody se posune na nejbližší mez.'),
});

export const activateInput = z.object({
  mode: z.enum(['start', 'race']),
  date: isoDate,
  startFromWeek: z.number().int().min(1).max(52).optional(),
  skipWeeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
});

export const bulkStatusInput = z.object({
  workoutIds: z.array(z.string().min(1)).min(1).max(60).describe('Id jednotek z get_plan.'),
  status: z.enum(['scheduled', 'completed', 'partial']),
  reason: z.string().max(300).default('').describe('Stručně proč, slovy uživatele.'),
});

export const statusInput = z.object({
  workoutId: z.string().min(1),
  status: z.enum(['scheduled', 'completed', 'partial']),
  feel: z.number().int().min(1).max(5).optional(),
  pain: z.enum(['none', 'mild', 'significant']).optional(),
  conditions: z.array(z.enum(Object.keys(CONDITIONS) as [Condition, ...Condition[]])).max(8).optional().describe('Okolnosti běhu, které uživatel zmínil: cold, heat, wind, rain, hills, poor_sleep, alcohol, dehydrated, tired, sick, stress, sore. Prázdné pole okolnosti smaže.'),
  note: z.string().max(300).optional(),
  estimateVdot: z.number().min(20).max(90).optional().describe('Jen hodnota estimate.vdot z výsledku show_result; jinak neposílej.'),
  seen: z.string().max(80).optional().describe('Jen pro appku; nevyplňuj.'),
});

export const STALE_CHECKIN = 'Zápis k jednotce se mezitím změnil jinde. Nic se nepřepsalo; appka ukazuje aktuální stav.';

// ---------- Pomocné ----------

function activeOf(ws: Workspace): PlanActivation | undefined {
  return ws.activations.find((a) => a.status === 'active');
}

function snapshotOf(ws: Workspace, activation: PlanActivation): ScheduleSnapshot {
  return { activation, workouts: ws.workouts.filter((w) => w.activationId === activation.id) };
}

function chartOf(ws: Workspace, activation?: PlanActivation): PaceChart {
  const template = activation ? ws.templates.find((t) => t.id === activation.templateId) : undefined;
  return resolvePaceChart(ws.profile, template?.paceChart);
}

// Zápisy jednotek, které z rozpisu dočasně zmizely (přeskočený týden), se nemažou: undo jednotku vrátí i se zápisem.
function persist(ws: Workspace, snap: ScheduleSnapshot, rev: ConnectorRevision): void {
  const next = projectRevision(snap, rev);
  ws.workouts = [...ws.workouts.filter((w) => w.activationId !== snap.activation.id), ...next.workouts];
  ws.activations = ws.activations.map((a) => (a.id === next.activation.id ? next.activation : a));
  if (rev.revertsId) ws.revisions = ws.revisions.map((r) => (r.id === rev.revertsId ? { ...r, revertedById: rev.id } : r));
  ws.revisions = [...ws.revisions, rev].slice(-MAX_REVISIONS);
}

const noteOf = (ws: Workspace, workoutId: string): WorkoutNote | null => ws.notes.find((n) => n.workoutId === workoutId) ?? null;
const sameNote = (a: WorkoutNote | null, b: WorkoutNote | null): boolean => (a?.feel ?? null) === (b?.feel ?? null) && (a?.pain ?? null) === (b?.pain ?? null) && (a?.note ?? null) === (b?.note ?? null) && [...(a?.conditions ?? [])].sort().join() === [...(b?.conditions ?? [])].sort().join() && (a?.vdot ?? null) === (b?.vdot ?? null);
function putNote(ws: Workspace, workoutId: string, note: WorkoutNote | null): void {
  ws.notes = [...ws.notes.filter((n) => n.workoutId !== workoutId), ...(note ? [note] : [])];
}

/** Krátké id do výpisů: celé UUID stojí zbytečné tokeny. Nástroje přijmou krátké i celé. */
export const shortId = (id: string): string => id.slice(0, 8);
export function resolveId<T extends { id: string }>(items: T[], ref: string): string {
  if (items.some((i) => i.id === ref)) return ref;
  const hits = ref.length >= 6 ? items.filter((i) => i.id.startsWith(ref)) : [];
  return hits.length === 1 ? hits[0].id : ref;
}

const STATUS_LABEL: Record<ScheduledWorkout['status'], string> = { scheduled: 'v plánu', completed: 'splněno', partial: 'splněno částečně', skipped: 'vynecháno' };

function workoutLine(ws: Workspace, w: ScheduledWorkout, chart: PaceChart): string[] {
  const week = w.sourceWeek != null ? `T${w.sourceWeek}` : 'mimo plán';
  const flags = [STATUS_LABEL[w.status], w.locked ? 'zamčeno' : '', w.date !== w.originDate ? `přesunuto z ${w.originDate}` : '', w.skipReason ? `důvod: ${w.skipReason}` : ''].filter(Boolean).join(', ');
  const lines = [`${shortId(w.id)} | ${w.date} ${DOW_LONG[dowOf(w.date)]} | ${week} | ${w.workout.title} | ${workoutSummary(w.workout)} | ${flags}`];
  const blocks = blockLines(w.workout.blocks, chart);
  if (blocks.length) lines.push(`  Struktura: ${blocks.join('; ')}.`);
  if (w.workout.note) lines.push(`  Poznámka plánu: ${w.workout.note}`);
  const note = noteOf(ws, w.id);
  if (note) lines.push(`  Zápis uživatele: ${[note.feel ? `pocit ${note.feel}/5` : '', note.pain && note.pain !== 'none' ? `bolest ${note.pain === 'mild' ? 'mírná' : 'výrazná'}` : '', note.conditions?.length ? `okolnosti: ${note.conditions.map((c) => CONDITIONS[c]).join(', ')}` : '', note.note ?? ''].filter(Boolean).join(', ')}`);
  return lines;
}

function weekCheck(week: Pick<TemplateWeek, 'index' | 'declaredTotalM' | 'days'>, chart?: PaceChart): string {
  // Úseky na čas se pro kontrolu odhadnou i bez temp z dokumentu, takže vypadlý den nebo závod bez délky se ukáže.
  const c = checkWeekTotal(week, chart);
  const sum = formatDistanceRange({ minM: c.minM, maxM: c.maxM, estimated: c.minM !== c.maxM, unknown: c.unknown ? 1 : 0 });
  if (c.declaredM == null) return `T${week.index}: součet ${sum}`;
  const verdict = c.status === 'off' ? ' – NESEDÍ, najdi v dokumentu, co v přepisu chybí nebo přebývá, a týden pošli znovu' : c.status === 'unknown' ? ' (část jednotek nemá délku ani čas, nejde ověřit)' : ' – sedí';
  return `T${week.index}: součet ${sum}, autor uvádí ${formatKm(c.declaredM)}${verdict}`;
}

// ---------- Čtení ----------

export function describePlan(ws: Workspace, input: z.infer<typeof planRangeInput>, now: Date = new Date()): Outcome {
  const p = ws.profile;
  const today = todayIso(p.timezone, now);
  const lines = [`Dnes je ${formatDay(today, { weekday: true, year: true })} (${today}), časová zóna ${p.timezone}.`];
  const about = [
    p.intent ? `záměr ${p.intent === 'race' ? 'příprava na závod' : p.intent === 'improve' ? 'postupné zlepšení' : 'udržování'}` : '',
    p.raceDate ? `závod ${p.raceDate}${p.raceDistanceM ? ` na ${formatKm(p.raceDistanceM)}` : ''}` : '',
    p.weeklyKm ? `obvykle ${p.weeklyKm} km týdně` : '',
    p.runsPerWeek ? `${p.runsPerWeek} běhů týdně` : '',
    p.restDows.length ? `bez běhu: ${p.restDows.map((d) => DOW_LONG[d]).join(', ')}` : '',
  ].filter(Boolean);
  lines.push(about.length ? `Profil: ${about.join('; ')}.` : 'Profil je prázdný (záměr, objem a dny bez běhu nejsou zadané).');
  lines.push(p.coachNotes ? `Poznámky trenéra: ${p.coachNotes}` : 'Poznámky trenéra: žádné.');
  const fatigue = fatigueOf(ws.notes, today);
  if (fatigue) lines.push(`Únava: ${fatigue.text} Zeptej se, jak se cítí, a nabídni lehčí dny; rozpis měň jen se souhlasem.`);
  const history = planSummaries(ws).filter((s) => !s.active || s.last < today);
  if (history.length) lines.push('Historie plánů:', ...history.slice(-5).map(summaryLine));

  if (ws.staged) {
    // Stav kontroly importu i v další konverzaci: model týdny se špatným součtem dořeší, i když import dělal jindy.
    const chart = { ...ws.profile.paceChart, ...ws.staged.paceChart };
    const off = ws.staged.weeks.filter((w) => checkWeekTotal(w, chart).status === 'off').map((w) => w.index);
    const flagged = ws.staged.weeks.filter((w) => lintWeek(w, chart).length).map((w) => w.index);
    lines.push(`Rozpracovaný import „${ws.staged.name}“: nahrané týdny ${ws.staged.weeks.map((w) => w.index).join(', ')}. Ještě není zařazený do kalendáře.${off.length ? ` Součet nesedí s dokumentem v týdnech ${off.join(', ')}: oprav je podle dokumentu.` : ''}${flagged.length ? ` Varování v týdnech ${flagged.join(', ')}.` : ''}`);
  }

  const activation = activeOf(ws);
  if (!activation) {
    lines.push('Uživatel nemá aktivní plán. Plán vznikne přes import_plan_weeks a activate_plan.');
    return done(lines.join('\n'), false);
  }
  const template = ws.templates.find((t) => t.id === activation.templateId);
  const chart = chartOf(ws, activation);
  const range = planRange(activation);
  const paces = Object.entries(chart).map(([k, v]) => `${k} ${formatPace(v.fromSec)}–${formatPace(v.toSec)}`).join('; ');
  lines.push(`Tempa min/km: ${paces || 'nezadaná'}.`);
  lines.push(`Aktivní plán „${template?.name ?? 'bez názvu'}“${range ? `, ${range.first} až ${range.last}` : ''}. Verze rozpisu ${activation.revisionSeq}.`);
  if (range && range.last < today) lines.push(`Plán skončil ${range.last}. Nabídni další: kostru přes draft_plan podle Stravy a poznámek, nebo import nového dokumentu.`);

  const from = input.from ?? weekStartOf(today);
  const to = input.to ?? addDays(from, 13);
  if (to < from) return fail('Konec rozsahu je před začátkem.');
  if (addDays(from, 180) < to) return fail('Rozsah je delší než 180 dní. Zeptej se na kratší období.');

  const all = snapshotOf(ws, activation).workouts;
  // Proběhlé dny bez zápisu za poslední dva týdny: model je ověří ve Stravě a doplní, uživatel nemusí nic hlásit.
  const unrecorded = all.filter((w) => w.status === 'scheduled' && w.date < today && w.date >= addDays(today, -14) && !['rest', 'strength', 'cross'].includes(w.workout.type)).sort((a, b) => a.date.localeCompare(b.date));
  if (unrecorded.length) lines.push(`Nezapsané proběhlé jednotky: ${unrecorded.map((w) => `${formatDay(w.date, { weekday: true })} ${w.workout.title} (${shortId(w.id)})`).join('; ')}. Ověř je ve Stravě a zapiš jedním set_statuses; co ve Stravě není, nech být a zeptej se.`);
  for (let start = weekStartOf(from); start <= to; start = addDays(start, 7)) {
    const mapping = activation.mapping.find((m) => m.weekStart === start);
    const source = mapping?.sourceWeek != null ? template?.weeks.find((w) => w.index === mapping.sourceWeek) : undefined;
    const label = !mapping ? 'mimo plán' : mapping.sourceWeek == null ? 'pauza' : `týden ${mapping.sourceWeek} plánu${source?.phase ? ` (${source.phase})` : ''}`;
    const days = all.filter((w) => w.date >= start && w.date <= addDays(start, 6) && w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    lines.push('', `Týden od ${start}: ${label}${start === weekStartOf(today) ? ' – probíhá' : ''}`);
    if (source?.note && start === weekStartOf(today)) lines.push(`Poznámka autora plánu: ${source.note.length > 300 ? `${source.note.slice(0, 300)}…` : source.note}`);
    if (!days.length) { lines.push('Žádné jednotky.'); continue; }
    const rest = days.filter((w) => w.workout.type === 'rest' && w.status === 'scheduled');
    for (const w of days) if (!rest.includes(w)) lines.push(...workoutLine(ws, w, chart));
    if (rest.length) lines.push(`Volno: ${rest.map((w) => `${DOW_LONG[dowOf(w.date)]} ${w.date.slice(5)} (${shortId(w.id)})`).join(', ')}.`);
    const planned = days.filter((w) => w.status !== 'skipped').map((w) => w.workout);
    lines.push(`Součet naplánovaného: ${formatDistanceRange(plannedDistance(planned, chart))}.`);
  }

  const recent = ws.revisions.filter((r) => r.activationId === activation.id).slice(-5).reverse();
  if (recent.length) {
    lines.push('', 'Poslední změny (id pro undo_change):');
    for (const r of recent) lines.push(`${shortId(r.id)} | ${r.at.slice(0, 16)} | ${OPERATION_LABEL[r.operation] ?? r.operation}${r.reason ? ` – ${r.reason}` : ''}${r.revertedById ? ' (vráceno)' : ''}`);
  }
  return done(lines.join('\n'), false);
}

// ---------- Profil ----------

export function setProfile(ws: Workspace, input: z.infer<typeof profileInput>): Outcome {
  if (input.timezone) {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }); } catch { return fail(`Neznámá časová zóna „${input.timezone}“. Použij název jako Europe/Prague.`); }
  }
  const { paceChart, restDows, longRunDow, notes, ...rest } = input;
  ws.profile = {
    ...ws.profile,
    ...rest,
    ...(notes != null ? { coachNotes: notes.trim() || undefined } : {}),
    ...(restDows ? { restDows: restDows as Dow[] } : {}),
    ...(longRunDow != null ? { longRunDow: longRunDow as Dow } : {}),
    ...(paceChart ? { paceChart: { ...ws.profile.paceChart, ...paceChart }, paceSource: 'profile' as const } : {}),
  };
  return done(`Profil uložen: ${Object.keys(input).join(', ') || 'beze změny'}.`, Object.keys(input).length > 0);
}

// ---------- Import a aktivace ----------

export function stageWeeks(ws: Workspace, input: z.infer<typeof stageInput>, now: string): Outcome {
  for (const w of input.weeks) if (new Set(w.days.map((d) => d.dow)).size !== 7) return fail(`Týden ${w.index} musí obsahovat každý den právě jednou (0 = pondělí … 6 = neděle); volný den zapiš jako typ rest.`);
  const base = input.restart || !ws.staged ? [] : ws.staged.weeks;
  const byIndex = new Map(base.map((w) => [w.index, w]));
  const fixed: string[] = [];
  for (const w of input.weeks) {
    byIndex.set(w.index, {
      index: w.index,
      phase: w.phase,
      note: w.note,
      declaredTotalM: w.declaredTotalM,
      days: [...w.days].sort((a, b) => a.dow - b.dow).map((d) => {
        // Skoro jisté chyby přepisu (závod bez délky, běh vedený jako rovinky) se opraví hned; model dostane, co se změnilo.
        const { workout, fixes } = autofixWorkout(d.workout);
        for (const f of fixes) fixed.push(`T${w.index} ${DOW_LONG[d.dow as Dow]} „${workout.title}“: ${f}`);
        return { dow: d.dow as Dow, workout, source: { method: 'generated' as const, review: 'unreviewed' as const, issues: fixes } };
      }),
    });
  }
  const weeks = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const paceChart = input.paceChart ?? (input.restart ? undefined : ws.staged?.paceChart);
  const paceTable = input.paceTable ? [...input.paceTable].sort((a, b) => a.goalSec - b.goalSec) : input.restart ? undefined : ws.staged?.paceTable;
  ws.staged = { name: input.name, units: input.units, paceChart, paceTable, weeks, updatedAt: now, activate: input.restart ? undefined : ws.staged?.activate };
  const chart = { ...ws.profile.paceChart, ...paceChart };
  const missing: number[] = [];
  for (let i = 1; i <= weeks[weeks.length - 1].index; i++) if (!byIndex.has(i)) missing.push(i);
  const warnings = [...lintPaceChart(paceChart), ...input.weeks.flatMap((w) => lintWeek(byIndex.get(w.index)!, chart).map((x) => `T${w.index} ${DOW_LONG[x.dow as Dow]} „${x.title}“: ${x.text}`))];
  const shown = input.weeks.map((w) => w.index);
  return { ok: true, changed: true, text: [
    `Nahráno do rozpracovaného importu „${input.name}“: týdny ${weeks.map((w) => w.index).join(', ')}.`,
    missing.length ? `Chybí týdny ${missing.join(', ')}; doplň je dalším voláním.` : 'Týdny na sebe navazují od 1.',
    'Kontrola součtů:',
    ...input.weeks.map((w) => weekCheck({ ...w, days: byIndex.get(w.index)!.days }, chart)),
    fixed.length ? `Opraveno automaticky (${fixed.length}; uživateli stačí říct souhrnně, další volání to už posílat nemusí):` : '',
    ...fixed.slice(0, 12).map((x) => '- ' + x),
    fixed.length > 12 ? `- … a dalších ${fixed.length - 12}.` : '',
    warnings.length ? `Varování (${warnings.length}; nejsou to chyby, které by import blokovaly – ukaž je uživateli a oprav jen to, co potvrdí podle dokumentu):` : 'Kontrola jednotek: bez varování.',
    ...warnings.slice(0, 15).map((x) => '- ' + x),
    warnings.length > 15 ? `- … a dalších ${warnings.length - 15}, celé jsou v appce.` : '',
    'Uživatel rozpracovaný plán vidí v appce (Plán) a může ho tam zařadit. Až budou všechny týdny nahrané, řekni mu to; když chce zařazení po tobě, zeptej se na začátek nebo datum závodu a zavolej activate_plan. Varování aktivaci nebrání.',
  ].filter(Boolean).join('\n'), banner: `Nahráno: ${shown.length > 1 ? `týdny ${shown[0]}–${shown[shown.length - 1]}` : `týden ${shown[0]}`}.` };
}

export function activatePlan(ws: Workspace, input: z.infer<typeof activateInput>, now: string): Outcome {
  const staged = ws.staged;
  if (!staged || !staged.weeks.length) return fail('Není co aktivovat. Nejdřív nahraj týdny přes import_plan_weeks.');
  const gap = staged.weeks.findIndex((w, i) => w.index !== i + 1);
  if (gap >= 0) return fail(`Týdny musí jít od 1 po sobě; chybí týden ${gap + 1}.`);
  const template: PlanTemplate = { id: newId(), name: staged.name, origin: 'import', createdAt: now, verifiedAt: now, units: staged.units, paceChart: staged.paceChart, paceTable: staged.paceTable, weeks: staged.weeks };
  const { activation, workouts } = createActivation(template, { mode: input.mode, date: input.date, startFromWeek: input.startFromWeek, skipWeeks: input.skipWeeks }, now);
  if (!activation.mapping.length) return fail('Po přeskočení nezbyl žádný týden k zařazení.');
  const first = activation.mapping[0].weekStart;
  const endedOn = addDays(first, -1);
  const archived = new Set(ws.activations.filter((a) => a.status === 'active').map((a) => a.id));
  ws.activations = [...ws.activations.map((a) => (archived.has(a.id) ? { ...a, status: 'archived' as const, endedOn } : a)), activation];
  // Z nahrazeného plánu zůstává jen to, co už proběhlo.
  ws.workouts = [...ws.workouts.filter((w) => !archived.has(w.activationId) || w.date <= endedOn), ...workouts];
  ws.templates = [...ws.templates.filter((t) => ws.activations.some((a) => a.templateId === t.id)), template];
  const alive = new Set(ws.workouts.map((w) => w.id));
  ws.notes = ws.notes.filter((n) => alive.has(n.workoutId));
  ws.staged = undefined;
  if (staged.paceChart) ws.profile = { ...ws.profile, paceSource: 'plan' };
  const range = planRange(activation)!;
  return done([
    `Plán „${template.name}“ je zařazený do kalendáře: ${range.first} až ${range.last}, ${activation.mapping.length} týdnů.`,
    activation.skippedSourceWeeks.length ? `Přeskočené týdny plánu: ${activation.skippedSourceWeeks.join(', ')}.` : '',
    archived.size ? 'Předchozí plán je archivovaný; jeho proběhlé jednotky zůstaly v historii.' : '',
  ].filter(Boolean).join('\n'));
}

// ---------- Změny rozpisu ----------

/** Ověří předpis jednotky a chybu vrátí s cestou k poli, ať ji model umí opravit. */
export function checkWorkout(raw: unknown): { ok: true; workout: z.infer<typeof workoutSpecSchema> } | { ok: false; text: string } {
  const parsed = workoutSpecSchema.safeParse(raw);
  if (parsed.success) return { ok: true, workout: parsed.data };
  const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'workout'}: ${i.message}`).join('; ');
  return { ok: false, text: `Předpis jednotky nemá platný tvar (${issues}). Tvar je stejný jako u dnů v import_plan_weeks.` };
}

export function scheduleCommand(ws: Workspace, operation: ScheduleOperation, payload: unknown, reason: string, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const snap = snapshotOf(ws, activation);
  const p = payload as { workoutId?: unknown };
  if (p && typeof p.workoutId === 'string') payload = { ...p, workoutId: resolveId(snap.workouts, p.workoutId) };
  const result = applyScheduleCommand(snap, { id: newId(), operation, payload, reason }, { author: 'coach', now });
  if (!result.ok) return fail(result.message);
  persist(ws, snap, result.revision);
  return done([...result.summary, ...result.warnings.map((w) => `Pozor: ${w}`), `Změna ${shortId(result.revision.id)} je uložená a jde vrátit přes undo_change.`].join('\n'));
}

export function setStatus(ws: Workspace, input: z.infer<typeof statusInput>, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const wanted = resolveId(ws.workouts.filter((w) => w.activationId === activation.id), input.workoutId);
  const workout = ws.workouts.find((w) => w.id === wanted && w.activationId === activation.id);
  if (!workout) return fail('Jednotka v rozpisu není. Načti aktuální id přes get_plan.');
  const previous = noteOf(ws, workout.id);
  if (input.seen != null && input.seen !== checkinVersion(workout.status, previous)) return fail(STALE_CHECKIN);
  const next: WorkoutNote = { ...previous, workoutId: workout.id, date: workout.date, at: now, ...(input.feel != null ? { feel: input.feel as 1 | 2 | 3 | 4 | 5 } : {}), ...(input.pain != null ? { pain: input.pain } : {}), ...(input.note != null ? { note: input.note } : {}), ...(input.conditions != null ? { conditions: [...new Set(input.conditions)] } : {}), ...(input.estimateVdot != null ? { vdot: Math.round(input.estimateVdot * 10) / 10 } : {}) };
  const noteChanged = !sameNote(previous, next);
  const statusChanged = workout.status !== input.status;
  if (!statusChanged && !noteChanged) return done('Beze změny, jednotka už tenhle stav i zápis má.', false);

  // Stav i zápis jsou jedna vratná změna; samotný zápis dostane vlastní revizi bez dotčených jednotek.
  const snap = snapshotOf(ws, activation);
  const lines: string[] = [];
  let revision: ConnectorRevision;
  if (statusChanged) {
    const result = applyScheduleCommand(snap, { id: newId(), operation: 'SET_STATUS', payload: { workoutId: workout.id, status: input.status }, reason: '' }, { author: 'coach', now });
    if (!result.ok) return fail(result.message);
    revision = result.revision;
    lines.push(...result.summary);
  } else {
    revision = { id: newId(), activationId: activation.id, seq: activation.revisionSeq + 1, at: now, author: 'coach', operation: 'SET_NOTE', reason: '', commandId: newId(), before: [], after: [] };
  }
  if (noteChanged) {
    revision = { ...revision, note: { workoutId: workout.id, before: previous, after: next } };
    putNote(ws, workout.id, next);
    lines.push('Zápis k jednotce uložen.');
  }
  persist(ws, snap, revision);
  lines.push(`Změna ${shortId(revision.id)} je uložená a jde vrátit přes undo_change.`);
  return done(lines.join('\n'));
}

/** Stejný stav více jednotkám najednou: jedna vratná změna místo série volání. */
export function setStatuses(ws: Workspace, input: z.infer<typeof bulkStatusInput>, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const snap = snapshotOf(ws, activation);
  const missing: string[] = [];
  const before: ScheduledWorkout[] = [];
  const after: ScheduledWorkout[] = [];
  for (const ref of new Set(input.workoutIds)) {
    const w = snap.workouts.find((x) => x.id === resolveId(snap.workouts, ref));
    if (!w) { missing.push(ref); continue; }
    if (w.status === input.status || before.some((b) => b.id === w.id)) continue;
    before.push(w);
    const next: ScheduledWorkout = { ...structuredClone(w), status: input.status };
    if (w.status === 'skipped') delete next.skipReason;
    after.push(next);
  }
  if (missing.length) return fail(`Tyto jednotky v rozpisu nejsou: ${missing.join(', ')}. Nic se nezměnilo; načti aktuální id přes get_plan.`);
  if (!after.length) return done('Beze změny, jednotky už tenhle stav mají.', false);
  const rev: ConnectorRevision = { id: newId(), activationId: activation.id, seq: activation.revisionSeq + 1, at: now, author: 'coach', operation: 'SET_STATUS', reason: input.reason, commandId: newId(), before, after };
  persist(ws, snap, rev);
  const label = input.status === 'completed' ? 'Splněno' : input.status === 'partial' ? 'Splněno částečně' : 'Vráceno do plánu';
  const count = after.length === 1 ? '1 jednotka' : after.length < 5 ? `${after.length} jednotky` : `${after.length} jednotek`;
  const sorted = [...after].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ok: true,
    changed: true,
    banner: `${label}: ${count} (${formatDay(sorted[0].date)}${sorted.length > 1 ? ` – ${formatDay(sorted[sorted.length - 1].date)}` : ''}).`,
    text: [
      `${label}: ${count}.`,
      ...sorted.map((w) => `${w.date} ${DOW_LONG[dowOf(w.date)]}: ${w.workout.title}`),
      `Změna ${shortId(rev.id)} je uložená; undo_change ji vrátí celou najednou.`,
    ].join('\n'),
  };
}

// ---------- Historie plánů ----------

export interface PlanSummary {
  name: string; first: string; last: string; active: boolean;
  runs: number; done: number; partial: number; skipped: number;
  plannedKm: number; doneKm: number; avgFeel: number | null; painCount: number; conditions: string[];
}

/** Souhrn každého zařazeného plánu z uložených jednotek a zápisů. Data aktivit ze Stravy v něm nejsou. */
export function planSummaries(ws: Workspace): PlanSummary[] {
  return ws.activations.map((a) => {
    const template = ws.templates.find((t) => t.id === a.templateId);
    const range = planRange(a);
    const last = a.endedOn && (!range || a.endedOn < range.last) ? a.endedOn : range?.last ?? '';
    const chart = resolvePaceChart(ws.profile, template?.paceChart);
    const runs = ws.workouts.filter((w) => w.activationId === a.id && w.date <= last && !['rest', 'strength', 'cross'].includes(w.workout.type));
    const km = (list: ScheduledWorkout[]) => Math.round(plannedDistance(list.map((w) => w.workout), chart).minM / 1000);
    const doneList = runs.filter((w) => w.status === 'completed' || w.status === 'partial');
    const notes = ws.notes.filter((n) => runs.some((w) => w.id === n.workoutId));
    const feels = notes.map((n) => n.feel).filter((f): f is 1 | 2 | 3 | 4 | 5 => f != null);
    const counts = new Map<string, number>();
    for (const n of notes) for (const c of n.conditions ?? []) counts.set(CONDITIONS[c], (counts.get(CONDITIONS[c]) ?? 0) + 1);
    return {
      name: template?.name ?? 'Plán', first: range?.first ?? '', last, active: a.status === 'active',
      runs: runs.length, done: runs.filter((w) => w.status === 'completed').length, partial: runs.filter((w) => w.status === 'partial').length, skipped: runs.filter((w) => w.status === 'skipped').length,
      plannedKm: km(runs.filter((w) => w.status !== 'skipped')), doneKm: km(doneList),
      avgFeel: feels.length ? Math.round(feels.reduce((s, f) => s + f, 0) / feels.length * 10) / 10 : null,
      painCount: notes.filter((n) => n.pain && n.pain !== 'none').length,
      conditions: [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([label]) => label),
    };
  }).sort((x, y) => x.first.localeCompare(y.first));
}

function summaryLine(s: PlanSummary): string {
  return `- ${s.name} (${s.first} až ${s.last}): splněno ${s.done}${s.partial ? ` + ${s.partial} částečně` : ''} z ${s.runs} běhů, vynecháno ${s.skipped}; ${s.doneKm} z ${s.plannedKm} km podle plánu${s.avgFeel != null ? `; průměrný pocit ${String(s.avgFeel).replace('.', ',')}/5` : ''}${s.painCount ? `; bolest zapsaná ${s.painCount}×` : ''}${s.conditions.length ? `; nejčastější okolnosti: ${s.conditions.join(', ')}` : ''}.`;
}

// ---------- Kostra nového plánu ----------

/** Deterministická kostra z generátoru: objem roste po 3 týdnech, 4. týden je lehčí, před závodem se ubírá. */
export function draftPlan(ws: Workspace, input: z.infer<typeof draftInput>, now: string): Outcome {
  const today = todayIso(ws.profile.timezone, new Date(now));
  const startDate = weekStartOf(input.startDate ?? defaultStart(today));
  if (input.intent === 'race' && !input.raceDate) return fail('U přípravy na závod potřebuju datum závodu (raceDate).');
  if (input.raceDate && input.raceDate < startDate) return fail('Závod je před začátkem plánu.');
  const weeks = input.raceDate ? weeksUntil(startDate, input.raceDate) : input.weeks ?? 8;
  if (weeks > 30) return fail(`Plán by měl ${weeks} týdnů; víc než 30 neumím. Zvol pozdější začátek.`);
  const generated = generateWeeks({
    intent: input.intent, weeks, startDate, weeklyKm: input.weeklyKm, longestRunKm: input.longestRunKm, runsPerWeek: input.runsPerWeek,
    restDows: input.restDows as Dow[], longRunDow: input.longRunDow as Dow, raceDate: input.raceDate, raceDistanceM: input.raceDistanceM, assumptions: [],
  });
  ws.staged = { name: input.name, units: 'km', weeks: generated, updatedAt: now, activate: input.raceDate ? { mode: 'race', date: input.raceDate } : { mode: 'start', date: startDate } };
  // Kostra z generátoru se v appce ukáže stejně jako import, i s případnými varováními.
  const chart = resolvePaceChart(ws.profile);
  const volumes = generated.map((w) => `T${w.index} ${formatDistanceRange(plannedDistance(w.days.map((d) => d.workout), chart))} (${w.phase})`);
  return done([
    `Kostra plánu „${input.name}“: ${weeks} týdnů od ${startDate}${input.raceDate ? `, závod ${input.raceDate}` : ''}. Je v rozpracovaném importu, do kalendáře ještě zařazená není.`,
    `Objem po týdnech: ${volumes.join('; ')}.`,
    `Projdi ji s uživatelem a uprav podle Stravy a poznámek: týden přepíšeš přes import_plan_weeks se stejným name a číslem týdne. Po schválení zavolej activate_plan s mode "${input.raceDate ? 'race' : 'start'}" a date ${input.raceDate ?? startDate}.`,
  ].join('\n'));
}

export function undoChange(ws: Workspace, revisionId: string | undefined, now: string): Outcome {
  const activation = activeOf(ws);
  if (!activation) return fail('Uživatel nemá aktivní plán.');
  const own = ws.revisions.filter((r) => r.activationId === activation.id);
  const rev = revisionId ? own.find((r) => r.id === resolveId(own, revisionId)) : [...own].reverse().find((r) => !r.revertedById && r.operation !== 'REVERT');
  if (!rev) return fail(revisionId ? 'Změna s tímhle id není v historii aktivního plánu.' : 'Není žádná změna k vrácení.');
  const snap = snapshotOf(ws, activation);
  const result = revertRevision(snap, rev, { author: 'coach', now });
  if (!result.ok) return fail(result.message);
  let revision: ConnectorRevision = result.revision;
  if (rev.note) {
    // Stejné pravidlo jako u jednotek: vrátit jde jen to, co mezitím nikdo nepřepsal.
    if (!sameNote(noteOf(ws, rev.note.workoutId), rev.note.after)) return fail('Zápis k jednotce se od té doby znovu změnil. Vrať nejdřív novější změnu.');
    putNote(ws, rev.note.workoutId, rev.note.before);
    revision = { ...revision, note: { workoutId: rev.note.workoutId, before: rev.note.after, after: rev.note.before } };
  }
  persist(ws, snap, revision);
  return done(`${result.summary.join('\n')}${rev.reason ? ` (${rev.reason})` : ''}`);
}

// ---------- Cílový čas a tempa ----------

const RACE_KEY: Array<[number, keyof PaceChart]> = [[5000, '5k_pace'], [10000, '10k_pace'], [21097.5, 'hm_pace'], [42195, 'mp']];
const hms = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** Tempa pro cílový čas mezi dvěma řádky tabulky z plánu (lineárně). Mimo rozsah tabulky nic nedomýšlí. */
export function interpolatePaces(table: PaceTableRow[], goalSec: number): PaceChart {
  const rows = [...table].sort((a, b) => a.goalSec - b.goalSec);
  const above = rows.findIndex((r) => r.goalSec >= goalSec);
  const i = Math.max(0, Math.min(rows.length - 2, (above < 0 ? rows.length : above) - 1));
  const lo = rows[i], hi = rows[i + 1];
  const t = Math.max(0, Math.min(1, (goalSec - lo.goalSec) / (hi.goalSec - lo.goalSec)));
  const out: PaceChart = {};
  for (const k of Object.keys(lo.paces) as Array<keyof PaceChart>) {
    const a = lo.paces[k], b = hi.paces[k];
    if (a && b) out[k] = { fromSec: Math.round(a.fromSec + (b.fromSec - a.fromSec) * t), toSec: Math.round(a.toSec + (b.toSec - a.toSec) * t) };
  }
  return out;
}

type GoalMethod = 'table' | 'vdot';
export interface GoalOptions { source: GoalMethod; methods: GoalMethod[]; distanceM: number | null; minSec: number; maxSec: number; sec: number }

/** Co jde v appce nastavit jako cílový čas: v rozsahu tabulky z plánu, nebo podle VDOT na délku závodu.
 *  Když jde obojí, rozhoduje uložená volba (paceMethod), výchozí je tabulka autora plánu. */
export function goalOptions(ws: Workspace, want?: GoalMethod): GoalOptions | null {
  const activation = activeOf(ws);
  const template = activation ? ws.templates.find((t) => t.id === activation.templateId) : undefined;
  const raceInPlan = template?.weeks.flatMap((w) => w.days).find((d) => d.workout.type === 'race' && d.workout.distanceM)?.workout.distanceM;
  const distanceM = ws.profile.raceDistanceM ?? raceInPlan ?? null;
  const table = template?.paceTable && template.paceTable.length >= 2 ? [...template.paceTable].sort((a, b) => a.goalSec - b.goalSec) : null;
  const methods: GoalMethod[] = [...(table ? ['table' as const] : []), ...(distanceM ? ['vdot' as const] : [])];
  if (!methods.length) return null;
  const pick = want ?? ws.profile.paceMethod;
  const method: GoalMethod = pick && methods.includes(pick) ? pick : methods[0];
  if (method === 'table' && table) {
    const minSec = table[0].goalSec, maxSec = table[table.length - 1].goalSec;
    // Bez uloženého cíle řádek, podle kterého je plán (shoda tempa půlmaratonu), jinak prostřední.
    const hm = template!.paceChart?.hm_pace?.fromSec;
    const matching = hm != null ? table.find((r) => r.paces.hm_pace?.fromSec === hm) : undefined;
    const saved = ws.profile.raceTargetSec;
    const sec = saved != null && saved >= minSec && saved <= maxSec ? saved : (matching ?? table[Math.floor(table.length / 2)]).goalSec;
    return { source: 'table', methods, distanceM, minSec, maxSec, sec };
  }
  if (!distanceM) return null;
  const minSec = Math.round(predictTime(85, distanceM)), maxSec = Math.round(predictTime(30, distanceM));
  const key = RACE_KEY.find(([d]) => Math.abs(d - distanceM) < 200)?.[1];
  const pace = key ? resolvePaceChart(ws.profile, template?.paceChart)[key] : undefined;
  const guess = ws.profile.raceTargetSec ?? (pace ? Math.round((pace.fromSec + pace.toSec) / 2 * distanceM / 1000) : Math.round(predictTime(45, distanceM)));
  return { source: 'vdot', methods, distanceM, minSec, maxSec, sec: Math.min(maxSec, Math.max(minSec, guess)) };
}

/** Nastaví cílový čas a podle něj tempa v profilu (mají přednost před tempy plánu). */
export function setGoal(ws: Workspace, input: z.infer<typeof goalInput>): Outcome {
  const opts = goalOptions(ws, input.method);
  if (!opts) return fail('Cílový čas jde nastavit u plánu na závod (s tabulkou temp nebo se známou délkou závodu).');
  if (input.method && opts.source !== input.method) return fail(input.method === 'table' ? 'Plán nemá tabulku temp pro různé cílové časy.' : 'Pro VDOT chybí délka závodu; ulož ji přes set_profile (raceDistanceM).');
  // Při přepnutí metody se čas posune do jejího rozsahu; jinak čas mimo rozsah odmítne.
  const goalSec = input.method ? Math.min(opts.maxSec, Math.max(opts.minSec, input.goalSec)) : input.goalSec;
  if (goalSec < opts.minSec || goalSec > opts.maxSec) {
    return fail(opts.source === 'table' ? `Tabulka temp v plánu má řádky pro ${hms(opts.minSec)} až ${hms(opts.maxSec)}; mimo ně tempa nedopočítávám.` : `Cílový čas musí být mezi ${hms(opts.minSec)} a ${hms(opts.maxSec)}.`);
  }
  const activation = activeOf(ws);
  const template = activation ? ws.templates.find((t) => t.id === activation.templateId) : undefined;
  const chart = opts.source === 'table' ? interpolatePaces(template!.paceTable!, goalSec) : trainingPaces(opts.distanceM!, goalSec).chart;
  ws.profile = { ...ws.profile, raceTargetSec: goalSec, paceChart: chart, paceSource: 'profile', ...(opts.methods.length > 1 ? { paceMethod: opts.source } : {}) };
  const how = opts.source === 'table' ? 'podle tabulky temp z plánu' : 'podle VDOT';
  return { ok: true, changed: true, banner: `Cíl ${hms(goalSec)}, tempa ${how}.`, text: `Cílový čas ${hms(goalSec)} uložen. Tempa jsou přepočítaná ${how}: ${Object.entries(chart).map(([k, v]) => `${k} ${formatPace(v!.fromSec)}–${formatPace(v!.toSec)}`).join('; ')}.` };
}
