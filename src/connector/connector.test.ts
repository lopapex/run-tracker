// Průchod konektorem přes skutečný MCP protokol: klient SDK → handleMcp → nástroje → úložiště v paměti.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { handleMcp } from './http';
import { MemoryStore, workspaceId } from './store';
import type { WorkoutSpec } from '../domain/types';

const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);

async function connect(store: MemoryStore, key = KEY_A) {
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`https://example.test/mcp/${key}`), {
    fetch: (url, init) => handleMcp(new Request(url, init), key, store),
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n');
    return { text, isError: result.isError === true };
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

describe('konektor Run Tracker', () => {
  it('odmítne neplatnou adresu a jiné metody než POST', async () => {
    const store = new MemoryStore();
    expect((await handleMcp(new Request('https://example.test/mcp/x', { method: 'POST' }), 'kratky', store)).status).toBe(404);
    expect((await handleMcp(new Request('https://example.test/mcp/x', { method: 'POST' }), undefined, store)).status).toBe(404);
    expect((await handleMcp(new Request('https://example.test/mcp/x'), KEY_A, store)).status).toBe(405);
  });

  it('nabídne nástroje s popsaným tvarem jednotky a instrukce pro model', async () => {
    const { client } = await connect(new MemoryStore());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['activate_plan', 'add_workout', 'delete_all_data', 'edit_workout', 'get_plan', 'import_plan_weeks', 'move_workout', 'restore_workout', 'set_profile', 'set_status', 'shift_plan', 'skip_workout', 'undo_change']);
    expect(tools.find((t) => t.name === 'get_plan')?.annotations?.readOnlyHint).toBe(true);
    const edit = JSON.stringify(tools.find((t) => t.name === 'edit_workout')?.inputSchema);
    for (const word of ['recoveryAfterLast', '5k_pace', 'strides', 'rawInstruction']) expect(edit).toContain(word);
    expect(client.getInstructions()).toContain('oficiální konektor Strava');
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
