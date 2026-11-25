import { describe, expect, it } from 'vitest';
import { applyScheduleCommand, projectRevision, revertRevision, type ScheduleSnapshot } from './commands';
import { addDays, dowOf, weekStartOf } from './dates';
import { generateWeeks, pickRunDays } from './generator';
import { buildMapping, createActivation, newId, REST } from './schedule';
import { isHard } from './format';
import type { Dow, DraftParams, PlanTemplate, TemplateWeek, WorkoutSpec } from './types';

const NOW = '2026-11-16T08:00:00.000Z';
const meta = { author: 'user' as const, now: NOW };
const run = (title: string, km: number, type: WorkoutSpec['type'] = 'easy'): WorkoutSpec => ({ type, title, distanceM: km * 1000, load: type === 'easy' ? 'low' : 'high', blocks: [] });

function week(index: number): TemplateWeek {
  const specs: WorkoutSpec[] = [run('Volný běh', 10), run('Intervaly', 12, 'speed'), REST, run('Volný běh', 10), run('Volný běh', 13), REST, run('Dlouhý běh', 16 + index, 'long')];
  return { index, days: specs.map((workout, dow) => ({ dow: dow as Dow, workout, source: { method: 'manual', review: 'confirmed', issues: [] } })) };
}
const template: PlanTemplate = { id: 't1', name: 'Test', origin: 'manual', createdAt: NOW, verifiedAt: NOW, units: 'km', weeks: [1, 2, 3, 4, 5, 6].map(week) };

function snapshot(opts = { mode: 'start' as const, date: '2026-11-16' }): ScheduleSnapshot {
  const { activation, workouts } = createActivation(template, opts, NOW);
  return { activation, workouts };
}
const cmd = (operation: string, payload: unknown) => ({ id: newId(), operation, payload, reason: 'test' });
const at = (s: ScheduleSnapshot, date: string) => s.workouts.find((w) => w.date === date)!;

describe('mapování týdnů (PLAN-01)', () => {
  it('začne od týdne 2 a přeskočí týden 3 bez přečíslování', () => {
    const { mapping, skippedSourceWeeks } = buildMapping(template.weeks, { mode: 'start', date: '2026-11-18', startFromWeek: 2, skipWeeks: [3] });
    expect(skippedSourceWeeks).toEqual([1, 3]);
    expect(mapping.map((m) => m.sourceWeek)).toEqual([2, 4, 5, 6]);
    expect(mapping[0].weekStart).toBe('2026-11-16');
    expect(mapping[1].weekStart).toBe('2026-11-23');
  });
  it('mapuje zpětně od závodu', () => {
    const { mapping } = buildMapping(template.weeks, { mode: 'race', date: '2026-12-20' });
    expect(mapping[5]).toEqual({ sourceWeek: 6, weekStart: '2026-12-14' });
    expect(mapping[0].weekStart).toBe('2026-11-09');
  });
});

describe('příkazy nad rozpisem', () => {
  it('přesun na volný den prohodí volno a jde vrátit (INV-06)', () => {
    const s = snapshot();
    const tue = at(s, '2026-11-17');
    const r = applyScheduleCommand(s, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: '2026-11-18' }), meta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s2 = projectRevision(s, r.revision);
    expect(s2.workouts.find((w) => w.id === tue.id)!.date).toBe('2026-11-18');
    expect(at(s2, '2026-11-17').workout.type).toBe('rest');
    expect(s2.activation.revisionSeq).toBe(1);

    const undo = revertRevision(s2, r.revision, meta);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    const s3 = projectRevision(s2, undo.revision);
    expect(s3.workouts.find((w) => w.id === tue.id)!.date).toBe('2026-11-17');
    expect(undo.revision.revertsId).toBe(r.revision.id);
  });

  it('obsazený den hlásí konflikt, prohození je výslovná volba', () => {
    const s = snapshot();
    const tue = at(s, '2026-11-17');
    const blocked = applyScheduleCommand(s, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: '2026-11-19' }), meta);
    expect(blocked).toMatchObject({ ok: false, code: 'conflict' });
    const swapped = applyScheduleCommand(s, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: '2026-11-19', onConflict: 'swap' }), meta);
    expect(swapped.ok).toBe(true);
  });

  it('upozorní na dva těžké dny po sobě', () => {
    const s = snapshot();
    const tue = at(s, '2026-11-17');
    const r = applyScheduleCommand(s, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: '2026-11-21' }), meta);
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('zamčená jednotka se nepřesune a chybný příkaz nic nezmění (CHAT-02)', () => {
    const s = snapshot();
    const tue = at(s, '2026-11-17');
    const lock = applyScheduleCommand(s, cmd('SET_LOCK', { workoutId: tue.id, locked: true }), meta);
    if (!lock.ok) throw new Error();
    const s2 = projectRevision(s, lock.revision);
    expect(applyScheduleCommand(s2, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: '2026-11-18' }), meta)).toMatchObject({ ok: false, code: 'locked' });
    expect(applyScheduleCommand(s2, cmd('MOVE_WORKOUT', { workoutId: 'neexistuje', toDate: '2026-11-18' }), meta)).toMatchObject({ ok: false, code: 'not_found' });
    expect(applyScheduleCommand(s2, cmd('DROP_TABLE', {}), meta)).toMatchObject({ ok: false, code: 'invalid' });
    expect(applyScheduleCommand(s2, cmd('MOVE_WORKOUT', { workoutId: tue.id, toDate: 'zítra' }), meta)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('zastaralý návrh se neprovede (INV-11)', () => {
    const s = snapshot();
    const tue = at(s, '2026-11-17');
    const r = applyScheduleCommand(s, { ...cmd('SKIP_WORKOUT', { workoutId: tue.id }), expectedRevisionSeq: 5 }, meta);
    expect(r).toMatchObject({ ok: false, code: 'stale' });
  });

  it('přeskočení týdne zachová identitu zdrojových týdnů a jde vrátit', () => {
    const s = snapshot();
    const r = applyScheduleCommand(s, cmd('REMAP_PLAN', { mode: 'skip_week', weekStart: '2026-11-30' }), meta);
    if (!r.ok) throw new Error(r.message);
    const s2 = projectRevision(s, r.revision);
    expect(s2.activation.mapping.map((m) => m.sourceWeek)).toEqual([1, 2, 4, 5, 6]);
    expect(s2.activation.skippedSourceWeeks).toEqual([3]);
    expect(s2.workouts.some((w) => w.sourceWeek === 3)).toBe(false);
    expect(at(s2, '2026-12-06').sourceWeek).toBe(4);
    const undo = revertRevision(s2, r.revision, meta);
    if (!undo.ok) throw new Error(undo.message);
    const s3 = projectRevision(s2, undo.revision);
    expect(s3.workouts.length).toBe(s.workouts.length);
    expect(s3.activation.skippedSourceWeeks).toEqual([]);
  });

  it('pauza posune jen budoucnost', () => {
    const s = snapshot();
    const r = applyScheduleCommand(s, cmd('REMAP_PLAN', { mode: 'pause_week', weekStart: '2026-11-23' }), meta);
    if (!r.ok) throw new Error(r.message);
    const s2 = projectRevision(s, r.revision);
    expect(s2.activation.mapping[1]).toEqual({ weekStart: '2026-11-23', sourceWeek: null });
    expect(s2.workouts.filter((w) => w.date >= '2026-11-23' && w.date <= '2026-11-29')).toHaveLength(0);
    expect(at(s2, '2026-11-16').sourceWeek).toBe(1);
  });

  it('obnoví původní předpis po úpravě', () => {
    const s = snapshot();
    const mon = at(s, '2026-11-16');
    const e = applyScheduleCommand(s, cmd('EDIT_WORKOUT', { workoutId: mon.id, workout: run('Kratší běh', 6) }), meta);
    if (!e.ok) throw new Error();
    const s2 = projectRevision(s, e.revision);
    const back = applyScheduleCommand(s2, cmd('RESTORE_ORIGINAL', { workoutId: mon.id }), meta);
    if (!back.ok) throw new Error();
    expect(projectRevision(s2, back.revision).workouts.find((w) => w.id === mon.id)!.workout.distanceM).toBe(10_000);
  });
});

const params: DraftParams = { intent: 'maintain', weeks: 4, startDate: '2026-11-23', weeklyKm: 50, runsPerWeek: 5, restDows: [], longRunDow: 6, assumptions: [] };

describe('generátor', () => {
  it('drží odstup kvality od dlouhého běhu a volné dny', () => {
    const { runDays, qualityDow } = pickRunDays({ runsPerWeek: 4, restDows: [6], longRunDow: 5 });
    expect(runDays).toHaveLength(4);
    expect(runDays).not.toContain(6);
    expect(Math.abs(qualityDow! - 5)).toBeGreaterThanOrEqual(2);
  });
  it('udržování nenavyšuje objem a nedává dva těžké dny za sebou', () => {
    const weeks = generateWeeks(params);
    const totals = weeks.map((w) => w.days.reduce((a, d) => a + (d.workout.distanceM ?? 0), 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(3000);
    for (const w of weeks) for (let i = 0; i < 6; i++) expect(isHard(w.days[i].workout) && isHard(w.days[i + 1].workout)).toBe(false);
  });
  it('závodní plán dá závod na datum závodu a před ním ubere', () => {
    const weeks = generateWeeks({ ...params, intent: 'race', weeks: 5, raceDate: '2026-12-20', raceDistanceM: 10_000 });
    const raceWeek = weeks[Math.floor((Date.parse('2026-12-20') - Date.parse(weekStartOf('2026-11-23'))) / (7 * 86_400_000))];
    expect(raceWeek.days[dowOf('2026-12-20')].workout.type).toBe('race');
    const total = (w: TemplateWeek) => w.days.reduce((a, d) => a + (d.workout.type === 'race' ? 0 : (d.workout.distanceM ?? 0)), 0);
    expect(total(raceWeek)).toBeLessThan(total(weeks[0]));
  });
  it('dlouhý běh roste od nejdelšího běhu ze Stravy, objem týdne zůstane', () => {
    const long = (w: TemplateWeek) => w.days.find((d) => d.workout.type === 'long')!.workout.distanceM!;
    const sum = (w: TemplateWeek) => w.days.reduce((a, d) => a + (d.workout.distanceM ?? 0), 0);
    const free = generateWeeks({ ...params, weeklyKm: 60 });
    const capped = generateWeeks({ ...params, weeklyKm: 60, longestRunKm: 12 });
    expect(long(free[0])).toBe(18_000);
    expect(long(capped[0])).toBe(14_000);
    expect(long(capped[1])).toBe(15_000);
    expect(Math.abs(sum(capped[0]) - sum(free[0]))).toBeLessThanOrEqual(3000);
  });
});

it('addDays přes změnu času', () => {
  expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
});
