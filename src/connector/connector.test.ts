// Průchod konektorem přes skutečný MCP protokol: klient SDK → handleMcp → nástroje → úložiště v paměti.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFile, handleMcp } from './http';
import { MemoryStore, workspaceId } from './store';
import type { WorkoutSpec } from '../domain/types';

const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);

/** Výchozí klient je appka RPM (dostává data a show_week); `app: false` je model v Claude. */
async function connect(store: MemoryStore, key = KEY_A, app = true) {
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`https://example.test/mcp/${key}${app ? '?client=app' : ''}`), {
    fetch: (url, init) => handleMcp(new Request(url, init), key, store),
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n');
    return { text, isError: result.isError === true, data: result.structuredContent as any };
  };
  return { client, call };
}

const rest: WorkoutSpec = { type: 'rest', title: 'Rest Day', blocks: [] };
const easy = (km: number): WorkoutSpec => ({ type: 'easy', title: 'Easy Run', distanceM: km * 1000, load: 'low', blocks: [], rawInstruction: `Easy Run\n${km}k` });
const speed: WorkoutSpec = {
  type: 'speed', title: 'Speed Session', load: 'high', rawInstruction: 'Speed Session\n15 Mins Easy\n6x\n3 Mins at 5k Pace\n2 Mins Walk\n10 Mins Easy',
  blocks: [
    { kind: 'segment', role: 'warmup', durationSec: 900, intensity: 'easy' },
    { kind: 'repeat', count: 6, work: { role: 'work', durationSec: 180, intensity: '5k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'walk' }, recoveryAfterLast: null },
    { kind: 'segment', role: 'cooldown', durationSec: 600, intensity: 'easy' },
  ],
};
const long = (km: number): WorkoutSpec => ({ type: 'long', title: 'Long Run', distanceM: km * 1000, load: 'medium', blocks: [{ kind: 'segment', role: 'steady', distanceM: km * 1000, intensity: 'easy' }] });
// Po: volně, Út: rychlost, St: volno, Čt: volně, Pá: volno, So: volně, Ne: dlouhý
const week = (index: number, declaredTotalM?: number) => ({
  index, phase: 'PREP', declaredTotalM,
  days: [easy(10), speed, rest, easy(10), rest, easy(13), long(16)].map((workout, dow) => ({ dow, workout })),
});

const idOf = (plan: string, date: string, title: string) => {
  const line = plan.split('\n').find((l) => l.includes(`| ${date} `) && l.includes(`| ${title} |`));
  if (!line) throw new Error(`V rozpisu chybí ${title} ${date}:\n${plan}`);
  return line.split(' | ')[0];
};

describe('konektor RPM', () => {
  // Testy počítají s „dnes“ uprostřed testovacího týdne; skutečné datum by je časem rozbilo.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-18T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('odmítne neplatnou adresu a jiné metody než POST', async () => {
    const store = new MemoryStore();
    expect((await handleMcp(new Request('https://example.test/mcp/x', { method: 'POST' }), 'kratky', store)).status).toBe(404);
    expect((await handleMcp(new Request('https://example.test/mcp/x', { method: 'POST' }), undefined, store)).status).toBe(404);
    expect((await handleMcp(new Request('https://example.test/mcp/x'), KEY_A, store)).status).toBe(405);
  });

  it('nabídne nástroje s popsaným tvarem jednotky a instrukce pro model', async () => {
    const { client } = await connect(new MemoryStore());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['activate_plan', 'add_workout', 'calculate_paces', 'delete_all_data', 'draft_plan', 'edit_workout', 'export_garmin', 'get_plan', 'import_plan_weeks', 'move_workout', 'restore_workout', 'set_goal_time', 'set_profile', 'set_status', 'set_statuses', 'shift_plan', 'show_result', 'show_week', 'skip_workout', 'undo_change']);
    expect(tools.find((t) => t.name === 'get_plan')?.annotations?.readOnlyHint).toBe(true);
    const edit = JSON.stringify(tools.find((t) => t.name === 'import_plan_weeks')?.inputSchema);
    for (const word of ['recoveryAfterLast', '5k_pace', 'strides', 'rawInstruction']) expect(edit).toContain(word);
    expect(client.getInstructions()).toContain('oficiální konektor Strava');
    expect(client.getInstructions()).toContain('export GPX');
    // ikona a web konektoru jdou z adresy, na které běží
    const info = client.getServerVersion() as { websiteUrl?: string; icons?: Array<{ src: string }> };
    expect(info.websiteUrl).toBe('https://example.test');
    expect(info.icons?.map((i) => i.src)).toContain('https://example.test/brand/run-tracker-v2-192.png');
  });

  it('bez plánu řekne, jak ho založit, a nic neuloží', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    const plan = await call('get_plan');
    expect(plan.isError).toBe(false);
    expect(plan.text).toContain('nemá aktivní plán');
    expect(await store.load(await workspaceId(KEY_A))).toBeNull();
  });

  it('nahraje plán po částech, zkontroluje součty a zařadí ho do kalendáře', async () => {
    const { call } = await connect(new MemoryStore());
    // 10 + 10 + 13 + 16 = 49 km a rychlostní jednotka jen časem
    const first = await call('import_plan_weeks', { name: 'Half Marathon L4', weeks: [week(1, 58000)], paceChart: { easy: { fromSec: 304, toSec: 336 }, '5k_pace': { fromSec: 240, toSec: 250 } } });
    expect(first.isError).toBe(false);
    expect(first.text).toContain('T1: součet ≈');
    expect(first.text).toContain('autor uvádí 58 km');
    expect(first.text).not.toContain('NESEDÍ');

    // autor uvádí míň, než dávají samotné jednotky se známou délkou: přepis je určitě špatně
    const wrong = await call('import_plan_weeks', { name: 'Half Marathon L4', weeks: [week(3, 30000)] });
    expect(wrong.text).toContain('Chybí týdny 2');
    expect(wrong.text).toContain('NESEDÍ');
    expect((await call('activate_plan', { mode: 'start', date: '2026-11-16' })).text).toContain('chybí týden 2');

    await call('import_plan_weeks', { name: 'Half Marathon L4', weeks: [week(2), week(3, 58000)] });
    const activated = await call('activate_plan', { mode: 'start', date: '2026-11-18' });
    expect(activated.isError).toBe(false);
    expect(activated.text).toContain('2026-11-16 až 2026-12-06');

    const plan = await call('get_plan', { from: '2026-11-16', to: '2026-11-22' });
    expect(plan.text).toContain('Aktivní plán „Half Marathon L4“');
    expect(plan.text).toContain('týden 1 plánu (PREP)');
    expect(plan.text).toContain('2026-11-17 úterý | T1 | Speed Session');
    expect(plan.text).toContain('6× 3 min tempo na 5 km (4:00–4:10/km)');
    expect(plan.text).toContain('easy 5:04–5:36');
    expect(plan.text).not.toContain('Rozpracovaný import');
  });

  it('přesune, prohodí, vynechá a vrátí změny; zapíše splnění', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const before = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    const longRun = idOf(before, '2026-11-22', 'Long Run');
    const saturday = idOf(before, '2026-11-21', 'Easy Run');

    // sobota je obsazená: bez prohození chyba, s prohozením se dny vymění
    const blocked = await call('move_workout', { workoutId: longRun, toDate: '2026-11-21', reason: 'v neděli nemůžu' });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain('prohodit');
    const swapped = await call('move_workout', { workoutId: longRun, toDate: '2026-11-21', swap: true, reason: 'v neděli nemůžu' });
    expect(swapped.isError).toBe(false);
    // změna rovnou vykreslí týden s pruhem a možností vrácení; id ve výpisech jsou krátká
    expect(swapped.data).toMatchObject({ view: 'week', weekStart: '2026-11-16' });
    expect(swapped.data.banner.revisionId).toMatch(/^[0-9a-f]{8}$/);
    expect(swapped.data.banner.text).toContain('Long Run');
    expect(swapped.data.banner.text).not.toContain('Změna');
    expect(longRun).toHaveLength(8);
    let plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    expect(idOf(plan, '2026-11-21', 'Long Run')).toBe(longRun);
    expect(idOf(plan, '2026-11-22', 'Easy Run')).toBe(saturday);
    expect(plan).toContain('přesun jednotky – v neděli nemůžu');

    const skipped = await call('skip_workout', { workoutId: saturday, reason: 'rodinná akce' });
    expect(skipped.text).toContain('Vynecháno');
    expect((await call('move_workout', { workoutId: 'neexistuje', toDate: '2026-11-20', reason: '' })).isError).toBe(true);

    const status = await call('set_status', { workoutId: longRun, status: 'completed', feel: 4, note: 'šlo to dobře' });
    expect(status.isError).toBe(false);
    plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    expect(plan).toContain('splněno');
    expect(plan).toContain('pocit 4/5, šlo to dobře');
    expect(plan).toContain('| vynecháno, přesunuto z 2026-11-21, důvod: rodinná akce');

    // undo jde od poslední změny: splnění → vynechání → přesun
    expect((await call('undo_change')).isError).toBe(false);
    expect((await call('undo_change')).isError).toBe(false);
    expect((await call('undo_change')).isError).toBe(false);
    expect((await call('undo_change')).text).toContain('Není žádná změna');
    plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    expect(idOf(plan, '2026-11-22', 'Long Run')).toBe(longRun);
    expect(idOf(plan, '2026-11-21', 'Easy Run')).toBe(saturday);
    expect(plan).not.toContain('vynecháno');
    expect(plan).not.toContain('splněno');
    expect(plan).not.toContain('Zápis uživatele');
  });

  it('zápis k jednotce je součást vratné změny', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const range = { from: '2026-11-16', to: '2026-11-29' };
    const monday = idOf((await call('get_plan', range)).text, '2026-11-16', 'Easy Run');
    const revisionOf = (text: string) => /Změna (\S+) je uložená/.exec(text)![1];

    // splnění se zápisem je jedna změna
    const first = await call('set_status', { workoutId: monday, status: 'completed', feel: 4, note: 'lehké nohy' });
    expect(first.text.match(/Změna /g)).toHaveLength(1);
    // samotná úprava zápisu je taky změna, kterou jde vrátit
    const second = await call('set_status', { workoutId: monday, status: 'completed', feel: 2, pain: 'mild', note: 'táhlo lýtko' });
    expect(second.isError).toBe(false);
    expect((await call('get_plan', range)).text).toContain('pocit 2/5, bolest mírná, táhlo lýtko');
    expect((await call('set_status', { workoutId: monday, status: 'completed', feel: 2 })).text).toContain('Beze změny');

    // starší změnu nejde vrátit, dokud na ní stojí novější zápis
    const blocked = await call('undo_change', { revisionId: revisionOf(first.text) });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain('Zápis k jednotce se od té doby znovu změnil');

    expect((await call('undo_change')).text).toContain('Vráceno: zápis k jednotce');
    let plan = (await call('get_plan', range)).text;
    expect(plan).toContain('pocit 4/5, lehké nohy');
    expect(plan).not.toContain('táhlo lýtko');
    expect(plan).toContain('| Easy Run | 10 km | splněno');

    expect((await call('undo_change')).text).toContain('Vráceno: stav splnění');
    plan = (await call('get_plan', range)).text;
    expect(plan).not.toContain('Zápis uživatele');
    expect(plan).not.toContain('splněno');

    // vrácení vrácení (výslovně podle id) obnoví stav i zápis
    const reverts = plan.split('\n').filter((l) => l.includes('vrácení změny'));
    expect(reverts).toHaveLength(2);
    expect((await call('undo_change', { revisionId: reverts[0].split(' | ')[0] })).isError).toBe(false);
    plan = (await call('get_plan', range)).text;
    expect(plan).toContain('pocit 4/5, lehké nohy');
    expect(plan).toContain('| Easy Run | 10 km | splněno');
  });

  it('přeskočený týden jde vrátit i se zápisy jeho jednotek', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const range = { from: '2026-11-16', to: '2026-11-29' };
    const nextMonday = idOf((await call('get_plan', range)).text, '2026-11-23', 'Easy Run');
    await call('set_status', { workoutId: nextMonday, status: 'scheduled', note: 'chci běžet ráno' });
    expect((await call('shift_plan', { mode: 'skip_week', weekStart: '2026-11-23', reason: 'dovolená' })).isError).toBe(false);
    expect((await call('get_plan', range)).text).not.toContain('chci běžet ráno');
    expect((await call('undo_change')).isError).toBe(false);
    const plan = (await call('get_plan', range)).text;
    expect(idOf(plan, '2026-11-23', 'Easy Run')).toBe(nextMonday);
    expect(plan).toContain('chci běžet ráno');
  });

  it('pauza posune zbytek plánu o týden a nový plán archivuje starý', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'První', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'race', date: '2026-11-29' });
    const paused = await call('shift_plan', { mode: 'pause_week', weekStart: '2026-11-25', reason: 'nemoc' });
    expect(paused.text).toContain('Pauza');
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-12-06' })).text;
    expect(plan).toContain('Týden od 2026-11-23: pauza');
    expect(plan).toContain('Týden od 2026-11-30: týden 2 plánu');

    await call('import_plan_weeks', { name: 'Druhý', weeks: [week(1)] });
    const next = await call('activate_plan', { mode: 'start', date: '2026-12-07' });
    expect(next.text).toContain('Předchozí plán je archivovaný');
    const after = (await call('get_plan', { from: '2026-12-07', to: '2026-12-13' })).text;
    expect(after).toContain('Aktivní plán „Druhý“');
  });

  it('upraví a přidá jednotku, odmítne neplatný předpis a uloží profil', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const before = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    const monday = idOf(before, '2026-11-16', 'Easy Run');
    expect((await call('edit_workout', { workoutId: monday, workout: { ...easy(6), title: 'Kratší běh' }, reason: 'únava' })).isError).toBe(false);
    expect((await call('add_workout', { date: '2026-11-18', workout: { type: 'cross', title: 'Kolo', durationSec: 3600, blocks: [] }, reason: 'náhrada' })).isError).toBe(false);
    const bad = await call('edit_workout', { workoutId: monday, workout: { type: 'easy', title: 'x', blocks: [{ kind: 'segment', role: 'work', intensity: 'easy' }] }, reason: '' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('blocks.0');
    expect(bad.text).toContain('import_plan_weeks');
    expect((await call('add_workout', { date: '2026-11-18', workout: { title: 'Bez typu', blocks: [] }, reason: '' })).text).toContain('type');
    expect((await call('set_profile', { timezone: 'Nekde/Nikde' })).isError).toBe(true);
    expect((await call('set_profile', { intent: 'race', raceDate: '2027-02-07', raceDistanceM: 21097, restDows: [2, 4] })).isError).toBe(false);
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    expect(plan).toContain('Kratší běh | 6 km');
    expect(plan).toContain('| Kolo |');
    expect(plan).toContain('závod 2027-02-07 na 21,1 km');
    expect((await call('restore_workout', { workoutId: monday, reason: '' })).text).toContain('Obnoven původní předpis: Easy Run');
  });

  it('každý klíč má vlastní prostor a souběžný zápis nepřepíše cizí změnu', async () => {
    const store = new MemoryStore();
    const a = await connect(store, KEY_A);
    const b = await connect(store, KEY_B);
    await a.call('import_plan_weeks', { name: 'Plán A', weeks: [week(1)] });
    expect((await b.call('get_plan')).text).not.toContain('Plán A');

    const id = await workspaceId(KEY_A);
    const stale = await store.load(id);
    await a.call('set_profile', { weeklyKm: 50 });
    expect(await store.save(id, stale!.ws, stale!.etag)).toBe(false);
    expect((await store.load(id))!.ws.profile.weeklyKm).toBe(50);
  });

  it('appka dostane data a show_week, model jen text a žádné karty', async () => {
    const store = new MemoryStore();
    const { client, call } = await connect(store);
    const model = await connect(store, KEY_A, false);
    const appTools = (await client.listTools()).tools;
    const modelTools = (await model.client.listTools()).tools;
    expect(appTools.map((t) => t.name)).toContain('show_week');
    expect(modelTools.map((t) => t.name)).not.toContain('show_week');
    expect(modelTools.some((t) => t._meta)).toBe(false);
    expect(JSON.stringify(modelTools)).not.toMatch(/openai|ui:\/\//);
    expect((await client.listResources().catch(() => ({ resources: [] }))).resources).toEqual([]);
    const instructions = model.client.getInstructions() ?? '';
    expect(instructions).toContain('https://example.test/app/');
    expect(instructions).not.toMatch(/ChatGPT|karta|widget/i);

    expect((await call('show_week')).data.view).toBe('empty');
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)], paceChart: { easy: { fromSec: 304, toSec: 336 }, '5k_pace': { fromSec: 240, toSec: 250 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    const monday = idOf(plan, '2026-11-16', 'Easy Run');
    const tuesday = idOf(plan, '2026-11-17', 'Speed Session');
    await call('set_status', { workoutId: monday, status: 'completed', feel: 4 });

    const weekData = (await call('show_week', { date: '2026-11-18' })).data;
    expect(weekData.view).toBe('week');
    expect(weekData.weekStart).toBe('2026-11-16');
    expect(weekData.days).toHaveLength(7);
    expect(weekData.stats).toMatchObject({ units: 5, unitsDone: 1, doneKm: 10 });
    expect(weekData.days[0].workouts[0]).toMatchObject({ status: 'completed', feel: 4, kmMin: 10 });
    // rychlost s chůzí v pauzách: km jsou známé (chůze se nepočítá), ne prázdné
    expect(weekData.days[1].workouts[0]).toMatchObject({ kmUnknown: false });
    expect(weekData.days[1].workouts[0].kmMax).toBeGreaterThan(4);

    const planData = (await call('show_week', { tab: 'plan' })).data;
    expect(planData.weeks).toHaveLength(2);
    expect(planData.weeks[0]).toMatchObject({ sourceWeek: 1, phase: 'PREP', unitsDone: 1, longRunKm: 16 });
    expect(planData.totals).toMatchObject({ units: 10, unitsDone: 1, doneKm: 10 });

    // 3 minuty v tempu 4:00–4:10 jsou 720–750 m
    const paceData = (await call('show_week', { tab: 'paces', workoutId: tuesday })).data;
    expect(paceData.paces.map((p: { key: string }) => p.key)).toEqual(['easy', '5k_pace']);
    expect(paceData.workout.rows.find((r: { label: string }) => r.label === 'Rychlý úsek')).toMatchObject({ reps: 6, distMinM: 720, distMaxM: 750 });
    expect(paceData.workout.rows.find((r: { label: string }) => r.label === 'Pauza')).toMatchObject({ reps: 5 });
    // model dostane po změně jen text, bez dat pro appku
    const modelSet = await model.call('set_status', { workoutId: tuesday, status: 'completed' });
    expect(modelSet.isError).toBe(false);
    expect(modelSet.data).toBeUndefined();
    expect(modelSet.text).not.toContain('ODPOVĚĎ');
  });

  it('porovná běh s plánem, zapíše jen stav a čísla běhu neuloží', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)], paceChart: { easy: { fromSec: 304, toSec: 336 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const monday = idOf((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text, '2026-11-16', 'Easy Run');
    const laps = Array.from({ length: 10 }, (_, i) => ({ distanceM: 1000, durationSec: i < 8 ? 320 : 290 }));
    const result = await call('show_result', { workoutId: monday, run: { name: 'Ranní běh', distanceM: 10020, movingSec: 3140, avgHr: 146, laps } });
    expect(result.isError).toBe(false);
    expect(result.data.view).toBe('result');
    expect(result.data.score).toMatchObject({ total: 100, label: 'Splněno', suggestedStatus: 'completed' });
    expect(result.data.run.avgPaceSec).toBe(313);
    expect(result.data.target).toMatchObject({ key: 'easy', fastSec: 304, slowSec: 336 });
    expect(result.data.verdict).toMatchObject({ distance: 'ok', pace: 'in', lapsInTarget: 8 });
    expect(result.text).toContain('RPM je neuložil');
    // stav se zapsal podle hodnocení a jde vrátit
    expect(result.data.checkin.status).toBe('completed');
    expect(result.data.banner).toMatchObject({ text: 'Zapsáno jako splněno.' });
    expect(result.data.banner.revisionId).toBeTruthy();

    const short = await call('show_result', { workoutId: monday, run: { distanceM: 6000, movingSec: 1700 } });
    expect(short.data.verdict).toMatchObject({ distance: 'short', pace: 'faster' });
    expect(short.data.checkin.status).toBe('partial');
    // stejné volání znovu: karta se vykreslí, nic dalšího se nezapíše
    const again = await call('show_result', { workoutId: monday, run: { distanceM: 6000, movingSec: 1700 } });
    expect(again.data.view).toBe('result');
    expect(again.data.banner).toBeUndefined();
    const saved = JSON.stringify((await store.load(await workspaceId(KEY_A)))!.ws);
    for (const number of ['Ranní běh', '10020', '3140', '1700', 'movingSec', 'laps']) expect(saved).not.toContain(number);
  });

  it('okolnosti běhu se zapíšou, vrátí přes undo a zmírní hodnocení pomalejšího tempa', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)], paceChart: { easy: { fromSec: 304, toSec: 336 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const range = { from: '2026-11-16', to: '2026-11-22' };
    const monday = idOf((await call('get_plan', range)).text, '2026-11-16', 'Easy Run');
    const slow = { distanceM: 10000, movingSec: 3600 }; // 6:00/km, o 24 s pomaleji než pásmo

    const plain = (await call('show_result', { workoutId: monday, run: slow })).data;
    expect(plain.score).toMatchObject({ total: 86, label: 'Splněno s odchylkou' });
    const windy = (await call('show_result', { workoutId: monday, run: slow, conditions: ['cold', 'wind'] })).data;
    expect(windy.score.total).toBe(95);
    expect(windy.score.parts[1].text).toContain('okolnosti to vysvětlují');

    // zápis bez čísel běhu: jen formulář s tím, co už je zapsané
    const form = (await call('show_result', { workoutId: monday })).data;
    expect(form).toMatchObject({ view: 'result', run: null, score: null, checkin: { status: 'completed', conditions: ['cold', 'wind'] } });

    const saved = await call('set_status', { workoutId: monday, status: 'completed', feel: 2, conditions: ['cold', 'wind', 'alcohol'] });
    expect(saved.data.days[0].workouts[0]).toMatchObject({ status: 'completed', conditions: ['zima', 'vítr', 'alkohol den předem'] });
    expect((await call('get_plan', range)).text).toContain('okolnosti: zima, vítr, alkohol den předem');
    expect((await call('show_result', { workoutId: monday, run: slow })).data.score.total).toBe(95);
    expect((await call('set_status', { workoutId: monday, status: 'completed', conditions: ['bez'] })).isError).toBe(true);
    await call('undo_change');
    const undone = (await call('get_plan', range)).text;
    expect(undone).toContain('okolnosti: zima, vítr');
    expect(undone).not.toContain('alkohol');
  });

  it('připraví trénink pro Garmin a vydá ho na dočasném odkazu', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)], paceChart: { easy: { fromSec: 304, toSec: 336 }, '5k_pace': { fromSec: 240, toSec: 250 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    const exported = await call('export_garmin', { workoutId: idOf(plan, '2026-11-17', 'Speed Session') });
    expect(exported.isError).toBe(false);
    expect(exported.data).toMatchObject({ view: 'garmin', fileName: 'run-tracker-2026-11-17-speed-session.fit', hasPaces: true });
    expect(exported.data.steps).toEqual(['Rozklus volně · 15 min · 5:04–5:36 /km', 'Úsek tempo na 5 km · 3 min · 4:00–4:10 /km', 'Pauza chůze · 2 min', 'Opakuj 6× od kroku 2', 'Výklus volně · 10 min · 5:04–5:36 /km']);
    expect(exported.data.url).toMatch(/^https:\/\/example\.test\/garmin\/[0-9a-f]{48}$/);

    const token = exported.data.url.split('/').pop();
    const res = await handleFile(token, store);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('run-tracker-2026-11-17-speed-session.fit');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');

    expect((await handleFile('x'.repeat(48), store)).status).toBe(404);
    expect((await handleFile('../etc', store)).status).toBe(404);
    await store.putFile('y'.repeat(48), { owner: 'jiny', name: 'a.fit', mime: 'application/vnd.ant.fit', base64: '', expiresAt: '2020-01-01T00:00:00.000Z' });
    expect((await handleFile('y'.repeat(48), store)).status).toBe(404);
    // volný den do hodinek poslat nejde
    expect((await call('export_garmin', { workoutId: idOf(plan, '2026-11-16', 'Easy Run').slice(0, 3) })).isError).toBe(true);
  });

  it('tempa spočítá z výkonu a uloží je jen na vyžádání', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    const preview = await call('calculate_paces', { distanceM: 21097.5, timeSec: 5400 });
    expect(preview.isError).toBe(false);
    expect(preview.data).toMatchObject({ view: 'paces', calc: { saved: false } });
    expect(preview.data.calc.vdot).toBeGreaterThan(50);
    expect(preview.data.paces.find((p: { key: string }) => p.key === 'hm_pace')).toMatchObject({ fromSec: 254, toSec: 258 });
    expect(preview.text).toContain('neodhaduj');
    expect(await store.load(await workspaceId(KEY_A))).toBeNull();

    const saved = await call('calculate_paces', { distanceM: 21097.5, timeSec: 5400, save: true });
    expect(saved.data).toMatchObject({ calc: { saved: true }, banner: { text: 'Tempa uložena do profilu.' } });
    expect((await call('get_plan')).text).toContain('nemá aktivní plán');
    const ws = (await store.load(await workspaceId(KEY_A)))!.ws;
    expect(ws.profile.paceChart?.hm_pace).toEqual({ fromSec: 254, toSec: 258 });
    expect(ws.profile.paceSource).toBe('profile');
  });

  it('popisy nástrojů nesou tvar jednotky jen jednou', async () => {
    const { client } = await connect(new MemoryStore());
    const { tools } = await client.listTools();
    const size = (name: string) => JSON.stringify(tools.find((t) => t.name === name)).length;
    expect(size('edit_workout')).toBeLessThan(1500);
    expect(size('add_workout')).toBeLessThan(1500);
    expect(JSON.stringify(tools.find((t) => t.name === 'import_plan_weeks'))).toContain('recoveryAfterLast');
    expect(JSON.stringify(tools).length).toBeLessThan(28_000);
  });

  it('tlačítko Vrátit vrací právě tu změnu a po vrácení se už nenabízí', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    const activated = await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    expect(activated.data.banner.revisionId).toBeNull();
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-29' })).text;
    const monday = idOf(plan, '2026-11-16', 'Easy Run');
    const skipped = await call('skip_workout', { workoutId: monday, reason: 'x' });
    const moved = await call('move_workout', { workoutId: idOf(plan, '2026-11-19', 'Easy Run'), toDate: '2026-11-20', reason: 'x' });
    expect(moved.data.banner.revisionId).not.toBe(skipped.data.banner.revisionId);
    // vrácení staršího vynechání podle id z jeho pruhu
    const undone = await call('undo_change', { revisionId: skipped.data.banner.revisionId });
    expect(undone.text).toContain('Vráceno: vynechání jednotky');
    expect(undone.data.banner.revisionId).toBeNull();
    expect((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text).toContain('2026-11-20 pátek | T1 | Easy Run');
    // pauza týdne vrací přehled plánu a jde vrátit
    const paused = await call('shift_plan', { mode: 'pause_week', weekStart: '2026-11-23', reason: 'nemoc' });
    expect(paused.data.view).toBe('plan');
    expect(paused.data.banner.revisionId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('vrácení samotného zápisu ukáže týden, kam zápis patří', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const nextMonday = idOf((await call('get_plan', { from: '2026-11-23', to: '2026-11-29' })).text, '2026-11-23', 'Easy Run');
    await call('set_status', { workoutId: nextMonday, status: 'scheduled', note: 'ráno' });
    const undone = await call('undo_change');
    expect(undone.data).toMatchObject({ view: 'week', weekStart: '2026-11-23' });
  });

  it('profil bez temp vykreslí přehled plánu', async () => {
    const { call } = await connect(new MemoryStore());
    expect((await call('set_profile', { intent: 'race', raceDate: '2027-02-07' })).data.view).toBe('empty');
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const saved = await call('set_profile', { raceDate: '2027-02-07' });
    expect(saved.data).toMatchObject({ view: 'plan', raceDate: '2027-02-07' });
  });

  it('hodnocení: běh s rychlými úseky se nesoudí průměrným tempem a delší běh s úseky na čas se netrestá', async () => {
    const { call } = await connect(new MemoryStore());
    const progression: WorkoutSpec = { type: 'long', title: 'Long Run', distanceM: 19000, blocks: [
      { kind: 'segment', role: 'steady', distanceM: 8000, intensity: 'easy' },
      { kind: 'segment', role: 'work', distanceM: 3000, intensity: 'hm_pace' },
      { kind: 'segment', role: 'steady', distanceM: 8000, intensity: 'easy' },
    ] };
    const days = [easy(10), speed, rest, easy(10), rest, easy(13), progression].map((workout, dow) => ({ dow, workout }));
    await call('import_plan_weeks', { name: 'Plán', weeks: [{ index: 1, days }], paceChart: { easy: { fromSec: 304, toSec: 336 }, hm_pace: { fromSec: 256, toSec: 262 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;

    // dlouhý běh s 3 km v tempu půlmaratonu: průměr 4:55 je rychlejší než volné tempo, ale to není chyba
    const long = await call('show_result', { workoutId: idOf(plan, '2026-11-22', 'Long Run'), run: { distanceM: 19000, movingSec: 5605 } });
    expect(long.data.verdict).toMatchObject({ steady: false, pace: null, distance: 'ok' });
    expect(long.data.target).toMatchObject({ key: 'hm_pace' });
    expect(long.data.score.parts.map((p: { label: string }) => p.label)).toEqual(['Vzdálenost']);
    expect(long.data.score.total).toBe(100);
    expect(long.text).toContain('průměrné tempo celého běhu nehodnotí');

    // rychlostní trénink: úseky v tempu na 5 km nemají v tempech rozsah, takže jejich délka není známá
    const fast = await call('show_result', { workoutId: idOf(plan, '2026-11-17', 'Speed Session'), run: { distanceM: 9000, movingSec: 2900 } });
    expect(fast.data.score.parts[0]).toMatchObject({ label: 'Vzdálenost', value: 100 });
    expect(fast.data.score.parts[0].text).toContain('část jen na čas');
    expect(fast.data.verdict.distance).toBe('ok');
  });

  it('soubory do hodinek: prošlé se uklidí, smazání dat smaže i vlastní soubory, název bez rozbité diakritiky', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)], paceChart: { easy: { fromSec: 304, toSec: 336 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    await call('add_workout', { date: '2026-11-18', workout: { type: 'tempo', title: 'Tempový běh', distanceM: 8000, blocks: [] }, reason: '' });
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    await store.putFile('o'.repeat(48), { owner: 'jiny', name: 'stary.fit', mime: 'application/vnd.ant.fit', base64: '', expiresAt: '2020-01-01T00:00:00.000Z' });
    await store.putFile('p'.repeat(48), { owner: 'jiny', name: 'platny.fit', mime: 'application/vnd.ant.fit', base64: '', expiresAt: '2099-01-01T00:00:00.000Z' });
    const exported = await call('export_garmin', { workoutId: idOf(plan, '2026-11-18', 'Tempový běh') });
    expect(exported.data.fileName).toBe('run-tracker-2026-11-18-tempovy-beh.fit');
    const token = exported.data.url.split('/').pop();
    expect(await store.getFile('o'.repeat(48))).toBeNull();
    expect(await store.getFile(token)).not.toBeNull();
    await call('delete_all_data', { confirm: 'SMAZAT' });
    expect(await store.getFile(token)).toBeNull();
    expect(await store.getFile('p'.repeat(48))).not.toBeNull();
  });

  it('hromadný zápis splnění: jedno volání, jedna vratná změna', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-29' })).text;
    const ids = [idOf(plan, '2026-11-16', 'Easy Run'), idOf(plan, '2026-11-17', 'Speed Session'), idOf(plan, '2026-11-19', 'Easy Run')];

    const missing = await call('set_statuses', { workoutIds: [...ids, 'neexistuje'], status: 'completed' });
    expect(missing.isError).toBe(true);
    expect((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text).not.toContain('splněno');

    const revisionsBefore = (await store.load(await workspaceId(KEY_A)))!.ws.revisions.length;
    const marked = await call('set_statuses', { workoutIds: ids, status: 'completed', reason: 'podle Stravy' });
    expect(marked.isError).toBe(false);
    expect(marked.data).toMatchObject({ view: 'week', weekStart: '2026-11-16', banner: { text: 'Splněno: 3 jednotky (16. 11. – 19. 11.).' } });
    expect(marked.data.banner.revisionId).toMatch(/^[0-9a-f]{8}$/);
    expect(marked.data.stats.unitsDone).toBe(3);
    expect((await store.load(await workspaceId(KEY_A)))!.ws.revisions.length).toBe(revisionsBefore + 1);
    expect((await call('set_statuses', { workoutIds: ids, status: 'completed' })).text).toContain('Beze změny');

    // přes dva týdny ukáže přehled plánu
    const both = await call('set_statuses', { workoutIds: [idOf(plan, '2026-11-21', 'Easy Run'), idOf(plan, '2026-11-23', 'Easy Run')], status: 'partial' });
    expect(both.data.view).toBe('plan');

    // vrácení vrátí celé hromadné zapsání najednou
    await call('undo_change');
    const undone = await call('undo_change', { revisionId: marked.data.banner.revisionId });
    expect(undone.isError).toBe(false);
    const after = (await call('get_plan', { from: '2026-11-16', to: '2026-11-29' })).text;
    expect(after).not.toContain('splněno');
  });

  it('intervaly se hodnotí podle rychlých úseků, ne podle průměru běhu', async () => {
    const { call } = await connect(new MemoryStore());
    const intervals: WorkoutSpec = { type: 'speed', title: 'Speed', blocks: [
      { kind: 'segment', role: 'warmup', durationSec: 750, intensity: 'easy' },
      { kind: 'repeat', count: 4, work: { role: 'work', distanceM: 1600, intensity: '10k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'walk' }, recoveryAfterLast: false },
      { kind: 'segment', role: 'cooldown', durationSec: 750, intensity: 'easy' },
    ] };
    const days = [intervals, easy(10), rest, easy(10), rest, easy(13), long(16)].map((workout, dow) => ({ dow, workout }));
    await call('import_plan_weeks', { name: 'Plán', weeks: [{ index: 1, days }], paceChart: { easy: { fromSec: 285, toSec: 315 }, '10k_pace': { fromSec: 227, toSec: 233 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const id = idOf((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text, '2026-11-16', 'Speed');

    // skutečný trénink: úseky 3:56, 3:56, 3:56, 3:58 proti cíli 3:47–3:53
    const reps = [378, 378, 378, 381].map((durationSec) => ({ distanceM: 1600, durationSec }));
    const result = await call('show_result', { workoutId: id, run: { distanceM: 12020, movingSec: 3585, reps } });
    expect(result.data.target).toMatchObject({ key: '10k_pace', fastSec: 227, slowSec: 233 });
    expect(result.data.run.reps.map((r: { paceSec: number; offSec: number }) => [r.paceSec, r.offSec])).toEqual([[236, 3], [236, 3], [236, 3], [238, 5]]);
    const part = result.data.score.parts.find((p: { label: string }) => p.label === 'Úseky');
    expect(part).toMatchObject({ value: 90, text: '0 z 4 v cílovém pásmu, průměrně o 4 s/km pomaleji' });
    expect(result.data.score).toMatchObject({ total: 95, label: 'Splněno' });

    // za větru se pomalejší úseky omlouvají a váha tempa klesne
    const windy = await call('show_result', { workoutId: id, run: { distanceM: 12020, movingSec: 3585, reps }, conditions: ['wind'] });
    expect(windy.data.score.parts.find((p: { label: string }) => p.label === 'Úseky').text).toContain('okolnosti to vysvětlují');
    expect(windy.data.score.total).toBe(98);

    // bez úseků se tempo nehodnotí a model dostane radu, co poslat
    const plain = await call('show_result', { workoutId: id, run: { distanceM: 12020, movingSec: 3585 } });
    expect(plain.data.score.parts.map((p: { label: string }) => p.label)).toEqual(['Vzdálenost']);
    expect(plain.text).toContain('run.reps');
  });

  it('proběhlé nezapsané tréninky a odpočet do závodu', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1), week(2), week(3)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-02' });
    const today = new Date().toISOString().slice(0, 10);
    const raceDate = '2027-04-11';
    await call('set_profile', { raceDate });

    // týden 2.–8. 11. je celý za námi: 5 běhů, jeden zapsaný
    const plan = (await call('get_plan', { from: '2026-11-02', to: '2026-11-08' })).text;
    await call('set_status', { workoutId: idOf(plan, '2026-11-02', 'Easy Run'), status: 'completed' });
    const past = await call('show_week', { date: '2026-11-04' });
    expect(past.data.stats).toMatchObject({ units: 5, unitsDone: 1, unrecorded: 4 });
    expect(past.text).toContain('Nezapsáno: 4 proběhlých běhů');
    expect(past.data.daysToRace).toBe(Math.round((Date.parse(raceDate) - Date.parse(today)) / 86_400_000));
    expect((await call('show_week', { tab: 'plan' })).data.totals.unrecorded).toBeGreaterThanOrEqual(4);

    // budoucí týden nic nezapsaného nemá
    const future = await call('show_week', { date: '2027-03-01' });
    expect(future.data.stats.unrecorded).toBe(0);
    expect(future.text).not.toContain('Nezapsáno');
  });

  it('import varuje u podezřelých jednotek, ale aktivaci nebrání', async () => {
    const { call } = await connect(new MemoryStore());
    const strides: WorkoutSpec = { type: 'easy', title: 'Easy 11 km + 5× 20s strides', blocks: [{ kind: 'segment', role: 'steady', distanceM: 11000, intensity: 'strides' }] };
    const named: WorkoutSpec = { type: 'easy', title: 'Volný běh s rovinkami', distanceM: 8000, blocks: [] };
    const odd = { index: 1, phase: 'BUILD', days: [easy(10), speed, rest, strides, named, easy(13), long(16)].map((workout, dow) => ({ dow, workout })) };
    const imported = await call('import_plan_weeks', { name: 'Test', weeks: [odd], paceChart: { easy: { fromSec: 285, toSec: 315 }, '5k_pace': { fromSec: 330, toSec: 340 } } });
    expect(imported.isError).toBe(false);
    expect(imported.text).toContain('nejsou to chyby, které by import blokovaly');
    // 11 km „rovinek“ je skoro jistá chyba přepisu: opraví se hned a model dostane, co se změnilo.
    expect(imported.text).toContain('Opraveno automaticky');
    expect(imported.text).toContain('rovinky 5× 20 s zvlášť');
    expect(imported.data.weeks[0].days[3]).toMatchObject({ fixes: [expect.stringContaining('změněn na volný')] });
    expect(imported.text).toContain('Název zmiňuje rovinky');
    expect(imported.text).toContain('vychází pomalejší');
    expect(imported.data).toMatchObject({ view: 'import', name: 'Test', hasPaces: true, banner: { text: 'Nahráno: týden 1.' } });
    expect(imported.data.warnings).toBeGreaterThanOrEqual(2);
    expect(imported.data.weeks[0].issues[0]).toMatchObject({ day: 'pá', title: 'Volný běh s rovinkami' });
    // varování nic neblokují
    expect((await call('activate_plan', { mode: 'start', date: '2026-11-16' })).isError).toBe(false);
  });

  it('závod bez délky dostane délku z názvu a součet týdne odhalí vypadlý den', async () => {
    const { call } = await connect(new MemoryStore());
    const race: WorkoutSpec = { type: 'race', title: 'Half Marathon!', blocks: [] };
    const timed: WorkoutSpec = { type: 'easy', title: 'Optional Easy Run', durationSec: 1200, blocks: [] };
    const last = { index: 1, declaredTotalM: 48000, days: [rest, speed, easy(10), easy(8), rest, timed, race].map((workout, dow) => ({ dow, workout })) };
    const ok = await call('import_plan_weeks', { name: 'Závod', weeks: [last] });
    expect(ok.text).toContain('doplněno 21,1 km');
    expect(ok.data.weeks[0].totals).toBe('ok');
    expect(ok.data.suggest).toMatchObject({ mode: 'race', dow: 6 });
    // Bez středečního běhu chybí 10 km: i s úseky jen na čas (bez temp z dokumentu) to kontrola pozná.
    const short = { ...last, days: [rest, speed, rest, easy(8), rest, timed, race].map((workout, dow) => ({ dow, workout })) };
    const off = await call('import_plan_weeks', { name: 'Závod', weeks: [short] });
    expect(off.text).toContain('NESEDÍ');
    expect(off.data.weeks[0].totals).toBe('off');
    // Stav kontroly vidí model i v další konverzaci.
    expect((await call('get_plan', {})).text).toContain('Součet nesedí s dokumentem v týdnech 1');
    // Po zařazení appka u jednotky ukáže, co se při přepisu opravilo.
    await call('import_plan_weeks', { name: 'Závod', weeks: [last], restart: true });
    await call('activate_plan', { mode: 'race', date: '2026-12-06' });
    const raceWeek = await call('show_week', { date: '2026-12-06' });
    const raceCard = raceWeek.data.days[6].workouts[0];
    expect(raceCard).toMatchObject({ kmMax: 21.1, fixes: [expect.stringContaining('doplněno 21,1 km')] });
  });

  it('cílový čas přepočítá tempa podle tabulky z plánu jen v jejím rozsahu', async () => {
    const { call } = await connect(new MemoryStore());
    const row = (e: number, h: number) => ({ easy: { fromSec: e, toSec: e + 30 }, hm_pace: { fromSec: h, toSec: h + 6 } });
    const paceTable = [{ goalSec: 5100, paces: row(286, 239) }, { goalSec: 5400, paces: row(304, 252) }, { goalSec: 5700, paces: row(317, 267) }];
    await call('import_plan_weeks', { name: 'Půlmaraton', weeks: [week(1)], paceChart: paceTable[1].paces, paceTable });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const before = await call('show_week', { tab: 'paces' });
    expect(before.data.goal).toMatchObject({ source: 'table', minSec: 5100, maxSec: 5700, sec: 5400 });
    const set = await call('set_goal_time', { goalSec: 5250 });
    expect(set.isError).toBe(false);
    const hm = set.data.paces.find((p: { key: string }) => p.key === 'hm_pace');
    expect(hm).toMatchObject({ fromSec: 246, toSec: 252 });
    expect(set.data.goal.sec).toBe(5250);
    expect((await call('set_goal_time', { goalSec: 4800 })).text).toContain('1:25:00 až 1:35:00');
    // Bez délky závodu je jediná možnost tabulka.
    expect(set.data.goal.methods).toEqual(['table']);
    expect((await call('set_goal_time', { goalSec: 5400, method: 'vdot' })).isError).toBe(true);
  });

  it('tlačítka Stravy: neznámo, zapne je hodnocení čísly ze Stravy, ruční vypnutí vydrží', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    expect((await call('show_week', {})).data.strava).toBeNull();
    const id = idOf((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text, '2026-11-16', 'Easy Run');
    // Čísla od uživatele Stravu nezapnou.
    await call('show_result', { workoutId: id, run: { distanceM: 8000, movingSec: 2700 }, source: 'user' });
    expect((await call('show_week', {})).data.strava).toBeNull();
    await call('show_result', { workoutId: id, run: { distanceM: 8000, movingSec: 2700 }, source: 'strava' });
    expect((await call('show_week', {})).data.strava).toBe(true);
    await call('set_profile', { strava: false });
    await call('show_result', { workoutId: id, run: { distanceM: 8000, movingSec: 2700 }, source: 'strava' });
    expect((await call('show_week', {})).data.strava).toBe(false);
  });

  it('s tabulkou i délkou závodu jde přepnout tempa mezi tabulkou a VDOT', async () => {
    const { call } = await connect(new MemoryStore());
    const row = (e: number, h: number) => ({ easy: { fromSec: e, toSec: e + 30 }, hm_pace: { fromSec: h, toSec: h + 6 } });
    const paceTable = [{ goalSec: 5100, paces: row(286, 239) }, { goalSec: 5400, paces: row(304, 252) }, { goalSec: 5700, paces: row(317, 267) }];
    await call('import_plan_weeks', { name: 'Půlmaraton', weeks: [week(1)], paceChart: paceTable[1].paces, paceTable });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    await call('set_profile', { raceDistanceM: 21097.5 });
    const before = await call('show_week', { tab: 'paces' });
    expect(before.data.goal).toMatchObject({ source: 'table', methods: ['table', 'vdot'] });
    // VDOT má širší rozsah a vlastní pásma (ustáleně, maraton).
    const vdot = await call('set_goal_time', { goalSec: 4800, method: 'vdot' });
    expect(vdot.isError).toBe(false);
    expect(vdot.data.goal).toMatchObject({ source: 'vdot', sec: 4800 });
    expect(vdot.data.paces.map((p: { key: string }) => p.key)).toContain('steady');
    // Volba zůstane i bez method; zpět na tabulku se čas posune do jejího rozsahu.
    expect((await call('set_goal_time', { goalSec: 4900 })).data.goal.source).toBe('vdot');
    const back = await call('set_goal_time', { goalSec: 4900, method: 'table' });
    expect(back.data.goal).toMatchObject({ source: 'table', sec: 5100 });
  });

  it('dva těžké běhy po sobě ukážou upozornění na únavu', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const today = new Date().toISOString().slice(0, 10);
    const plan = (await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text;
    expect((await call('show_week', { date: today })).data.fatigue).toBeNull();
    await call('set_status', { workoutId: idOf(plan, '2026-11-16', 'Easy Run'), status: 'completed', feel: 2 });
    await call('set_status', { workoutId: idOf(plan, '2026-11-17', 'Speed Session'), status: 'partial', feel: 1 });
    const week1 = await call('show_week', { date: today });
    expect(week1.data.fatigue).toMatchObject({ kind: 'tired' });
    expect(week1.text).toContain('Únava:');
    expect((await call('get_plan')).text).toContain('Únava:');
  });

  it('odhad formy z úseků se uloží s hodnocením a ukáže v plánu', async () => {
    const { call } = await connect(new MemoryStore());
    const intervals: WorkoutSpec = { type: 'speed', title: 'Speed', blocks: [
      { kind: 'repeat', count: 4, work: { role: 'work', distanceM: 1600, intensity: '10k_pace' }, recovery: { role: 'recovery', durationSec: 120, intensity: 'walk' }, recoveryAfterLast: false },
    ] };
    const days = [intervals, easy(10), rest, easy(10), rest, easy(13), long(16)].map((workout, dow) => ({ dow, workout }));
    await call('import_plan_weeks', { name: 'Plán', weeks: [{ index: 1, days }], paceChart: { easy: { fromSec: 285, toSec: 315 }, '10k_pace': { fromSec: 227, toSec: 233 } } });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    await call('set_profile', { raceDistanceM: 10000, raceTargetSec: 2310 });
    const id = idOf((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text, '2026-11-16', 'Speed');
    const reps = [378, 378, 378, 381].map((durationSec) => ({ distanceM: 1600, durationSec }));
    const result = await call('show_result', { workoutId: id, run: { distanceM: 9000, movingSec: 2900, reps } });
    expect(result.data.estimate.vdot).toBeGreaterThan(50);
    expect(result.data.estimate.vdot).toBeLessThan(56);
    expect(result.text).toContain('Odhad formy: VDOT');
    // za větru se odhad nedělá: pomalejší úseky by formu podhodnotily
    expect((await call('show_result', { workoutId: id, run: { distanceM: 9000, movingSec: 2900, reps }, conditions: ['wind'] })).data.estimate).toBeNull();
    const fitness = (await call('show_week', { tab: 'plan' })).data.fitness;
    expect(fitness).toMatchObject({ vdot: result.data.estimate.vdot, distanceM: 10000, targetSec: 2310 });
    expect(fitness.predictedSec).toBeGreaterThan(2300);
  });

  it('starší karta nepřepíše novější zápis', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const monday = idOf((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text, '2026-11-16', 'Easy Run');
    const old = (await call('show_result', { workoutId: monday })).data.checkin.version;
    const first = await call('set_status', { workoutId: monday, status: 'completed', feel: 2, pain: 'mild', seen: old });
    expect(first.isError).toBe(false);
    // druhá karta s původní verzí: nic se nepřepíše
    const stale = await call('set_status', { workoutId: monday, status: 'completed', feel: 3, pain: 'none', seen: old });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain('mezitím změnil');
    expect((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text).toContain('pocit 2/5, bolest mírná');
    // s aktuální verzí jde jen pocit, zbytek zápisu zůstane
    const fresh = (await call('show_week', { date: '2026-11-16' })).data.days[0].workouts[0].version;
    expect((await call('set_status', { workoutId: monday, status: 'completed', feel: 3, seen: fresh })).isError).toBe(false);
    expect((await call('get_plan', { from: '2026-11-16', to: '2026-11-22' })).text).toContain('pocit 3/5, bolest mírná');
  });

  it('poznámky trenéra se ukládají do profilu a get_plan je vrací', async () => {
    const { call } = await connect(new MemoryStore());
    expect((await call('get_plan')).text).toContain('Poznámky trenéra: žádné.');
    await call('set_profile', { notes: 'Citlivá levá Achillovka. V pondělí nemůže běhat. Cíl: půlmaraton pod 1:30.' });
    expect((await call('get_plan')).text).toContain('Poznámky trenéra: Citlivá levá Achillovka. V pondělí nemůže běhat. Cíl: půlmaraton pod 1:30.');
    await call('set_profile', { notes: '' });
    expect((await call('get_plan')).text).toContain('Poznámky trenéra: žádné.');
  });

  it('kostra nového plánu na závod: růst, lehčí týdny, ubrání a závod v posledním týdnu', async () => {
    const { call } = await connect(new MemoryStore());
    expect((await call('draft_plan', { name: 'Jaro', intent: 'race', weeklyKm: 40, runsPerWeek: 4 })).isError).toBe(true);
    const draft = await call('draft_plan', { name: 'Půlmaraton jaro', intent: 'race', weeklyKm: 40, runsPerWeek: 4, restDows: [0, 4], longRunDow: 6, startDate: '2026-11-23', raceDate: '2027-01-31', raceDistanceM: 21097.5 });
    expect(draft.isError).toBe(false);
    expect(draft.text).toContain('10 týdnů od 2026-11-23, závod 2027-01-31');
    expect(draft.text).toContain('T4 ');
    expect(draft.text).toContain('(odpočinkový)');
    expect(draft.text).toContain('T10 ');
    expect(draft.text).toContain('mode "race" a date 2027-01-31');
    // Appka ukáže náhled kostry: bez falešných varování, s maticí a s tím, jak plán zařadit.
    expect(draft.data).toMatchObject({ view: 'import', warnings: 0, activate: { mode: 'race', date: '2027-01-31' } });
    expect((draft.data.weeks as Array<{ cells: unknown[] }>)[0].cells).toHaveLength(7);
    const activated = await call('activate_plan', { mode: 'race', date: '2027-01-31' });
    expect(activated.data).toMatchObject({ view: 'plan', planName: 'Půlmaraton jaro', first: '2026-11-23', last: '2027-01-31' });
    const weeks = activated.data.weeks as Array<{ plannedKmMax: number }>;
    expect(weeks).toHaveLength(10);
    // objem roste, 4. týden je lehčí, poslední týden ubírá
    expect(weeks[2].plannedKmMax).toBeGreaterThan(weeks[0].plannedKmMax);
    expect(weeks[3].plannedKmMax).toBeLessThan(weeks[2].plannedKmMax);
    expect(weeks[9].plannedKmMax).toBeLessThan(weeks[8].plannedKmMax);
    const raceWeek = (await call('get_plan', { from: '2027-01-25', to: '2027-01-31' })).text;
    expect(raceWeek).toContain('2027-01-31 neděle | T10 | Závod');
    // pondělí a pátek zůstaly bez běhu
    expect(raceWeek).toMatch(/Volno: pondělí 01-25.*pátek 01-29/);
  });

  it('po doběhnutí plánu ukáže shrnutí a historie se přenese do dalšího plánu', async () => {
    const { call } = await connect(new MemoryStore());
    await call('import_plan_weeks', { name: 'Podzim', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-10-05' });
    const plan = (await call('get_plan', { from: '2026-10-05', to: '2026-10-11' })).text;
    await call('set_statuses', { workoutIds: [idOf(plan, '2026-10-05', 'Easy Run'), idOf(plan, '2026-10-06', 'Speed Session')], status: 'completed' });
    await call('set_status', { workoutId: idOf(plan, '2026-10-11', 'Long Run'), status: 'partial', feel: 2, pain: 'mild', conditions: ['heat'] });
    await call('skip_workout', { workoutId: idOf(plan, '2026-10-08', 'Easy Run'), reason: 'nemoc' });

    const finished = await call('show_week');
    expect(finished.data).toMatchObject({ view: 'finished', plan: { name: 'Podzim', first: '2026-10-05', last: '2026-10-11', runs: 5, done: 2, partial: 1, skipped: 1, avgFeel: 2, painCount: 1, conditions: ['horko'] } });
    expect(finished.text).toContain('draft_plan');
    const text = (await call('get_plan')).text;
    expect(text).toContain('Plán skončil 2026-10-11');
    expect(text).toContain('Historie plánů:');
    expect(text).toContain('- Podzim (2026-10-05 až 2026-10-11): splněno 2 + 1 částečně z 5 běhů, vynecháno 1');

    // další plán: předchozí zůstane v historii a ve shrnutí
    await call('import_plan_weeks', { name: 'Zima', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const next = (await call('get_plan')).text;
    expect(next).toContain('Aktivní plán „Zima“');
    expect(next).toContain('- Podzim (2026-10-05 až 2026-10-11)');
    expect((await call('show_week')).data.view).toBe('week');
  });

  it('nabízí připravené prompty pro nový plán a týdenní kontrolu', async () => {
    const { client } = await connect(new MemoryStore());
    const { prompts } = await client.listPrompts();
    expect(prompts.map((x) => x.name).sort()).toEqual(['novy-plan', 'plan-z-dokumentu', 'tydenni-kontrola']);
    const newPlan = await client.getPrompt({ name: 'novy-plan' });
    expect(JSON.stringify(newPlan.messages)).toContain('draft_plan');
    const review = await client.getPrompt({ name: 'tydenni-kontrola' });
    expect(JSON.stringify(review.messages)).toContain('set_statuses');
  });

  it('smaže všechna data jen s výslovným potvrzením', async () => {
    const store = new MemoryStore();
    const { call } = await connect(store);
    await call('import_plan_weeks', { name: 'Plán', weeks: [week(1)] });
    await call('activate_plan', { mode: 'start', date: '2026-11-16' });
    const id = await workspaceId(KEY_A);
    expect((await call('delete_all_data', { confirm: 'ano' })).isError).toBe(true);
    expect(await store.load(id)).not.toBeNull();
    expect((await call('delete_all_data', { confirm: 'SMAZAT' })).isError).toBe(false);
    expect(await store.load(id)).toBeNull();
    expect((await call('get_plan')).text).toContain('nemá aktivní plán');
  });
});
