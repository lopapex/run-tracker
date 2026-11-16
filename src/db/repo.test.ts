import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContext, handleCommand } from '@/ai/coach';
import { toStravaActivity } from '@/strava/client';
import { completionOf } from '@/ui/Strava';
import { buildActivity, parseGpx } from '@/domain/activities';
import { db } from './db';
import { activateDraft, addActivity, createDraft, exportAll, publishTemplate, runScheduleCommand, saveProfile, undoRevision, updateDraft, wipeAll } from './repo';

const params = { intent: 'maintain', weeks: 2, startDate: '2026-11-16', weeklyKm: 40, runsPerWeek: 4, restDows: [], longRunDow: 6, assumptions: [] };

function gpx(day: string, km: number) {
  const pts: string[] = [];
  const t0 = Date.parse(`${day}T06:00:00Z`);
  const n = km * 60;
  for (let i = 0; i <= n; i++) pts.push(`<trkpt lat="${(50 + (i * (km * 1000 / n)) / 111_195).toFixed(7)}" lon="16.47"><time>${new Date(t0 + i * 5000).toISOString()}</time></trkpt>`);
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

beforeEach(async () => {
  await wipeAll();
  await saveProfile({ timezone: 'Europe/Prague', onboardedAt: '2026-11-16T08:00:00Z' });
});

describe('úložiště', () => {
  it('aktivuje jen aktuální verzi draftu a změna jde vrátit (PLAN-06)', async () => {
    const created = await createDraft(params, 'Test', 'user', 'test');
    if (!created.ok) throw new Error(created.message);
    const v1 = created.revision.id;
    const upd = await updateDraft(created.draft!.id, [{ op: 'scale_week', week: 1, factor: 0.8 }], 'user', 'lehčí', v1);
    if (!upd.ok) throw new Error(upd.message);

    expect(await activateDraft(created.draft!.id, v1)).toMatchObject({ ok: false });
    expect(await db().activations.count()).toBe(0);

    const act = await activateDraft(created.draft!.id, upd.revision.id);
    expect(act.ok).toBe(true);
    expect(await db().workouts.count()).toBe(14);
    expect((await db().drafts.get(created.draft!.id))!.status).toBe('accepted');
    expect(await updateDraft(created.draft!.id, [{ op: 'scale_week', week: 1, factor: 0.8 }], 'user', 'x')).toMatchObject({ ok: false });

    const run = (await db().workouts.toArray()).find((w) => w.workout.type !== 'rest')!;
    const r = await runScheduleCommand({ operation: 'SKIP_WORKOUT', payload: { workoutId: run.id } });
    if (!r.ok) throw new Error(r.message);
    expect((await db().workouts.get(run.id))!.status).toBe('skipped');
    expect((await undoRevision(r.revision.id)).ok).toBe(true);
    expect((await db().workouts.get(run.id))!.status).toBe('scheduled');
    expect(await db().revisions.count()).toBe(2);
    expect(await db().audit.count()).toBeGreaterThan(3);
  });

  it('ověřenou verzi plánu nejde přepsat (INV-01)', async () => {
    const t = { id: 't', name: 'A', origin: 'manual' as const, createdAt: '', verifiedAt: '', units: 'km' as const, weeks: [] };
    await publishTemplate(t);
    await expect(publishTemplate({ ...t, name: 'B' })).rejects.toThrow();
    expect((await db().templates.get('t'))!.name).toBe('A');
  });

  it('reimport stejného souboru nepřidá aktivitu a nezdvojí splnění (ACT-01)', async () => {
    const created = await createDraft(params, 'Test', 'user', 'test');
    if (!created.ok) throw new Error();
    await activateDraft(created.draft!.id, created.revision.id);
    const planned = (await db().workouts.toArray()).filter((w) => w.workout.type !== 'rest').sort((a, b) => a.date.localeCompare(b.date))[0];
    const km = Math.round((planned.workout.distanceM ?? 8000) / 1000);
    const a = buildActivity(parseGpx(gpx(planned.date, km)), { source: 'file_gpx', checksum: 'abc', timezone: 'Europe/Prague', now: '2026-11-16T08:00:00Z' });
    if ('error' in a) throw new Error(a.error);
    const first = await addActivity(a);
    expect(first.duplicate).toBe(false);
    expect(first.match?.workoutId).toBe(planned.id);
    expect((await db().workouts.get(planned.id))!.status).toBe('completed');
    const again = await addActivity({ ...a, id: 'other' });
    expect(again.duplicate).toBe(true);
    expect(await db().activities.count()).toBe(1);
    expect(await db().matches.count()).toBe(1);
  });
});

describe('Strava a AI (DATA-01)', () => {
  const raw = { id: 987654321, name: 'TAJNY-NAZEV-ZE-STRAVY', sport_type: 'Run', start_date: '2026-11-16T05:00:00Z', start_date_local: '2026-11-16T06:00:00Z', distance: 10234, moving_time: 3070, elapsed_time: 3100, average_heartrate: 151.2 };

  it('převede souhrn aktivity a nastaví expiraci do 7 dnů', () => {
    const now = new Date('2026-11-16T08:00:00Z');
    const a = toStravaActivity(raw, now)!;
    expect(a).toMatchObject({ id: 987654321, isRun: true, localDate: '2026-11-16', distanceM: 10234, provenance: 'STRAVA_API_RESTRICTED' });
    expect(Date.parse(a.expiresAt) - now.getTime()).toBe(7 * 86_400_000);
    expect(toStravaActivity({ ...raw, sport_type: 'Ride' }, now)!.isRun).toBe(false);
    expect(toStravaActivity({ name: 'x' }, now)).toBeNull();
  });

  it('běh ze Stravy se nedostane do kontextu trenéra ani do exportu', async () => {
    const a = toStravaActivity(raw, new Date())!;
    await db().stravaActivities.put(a);
    await db().connections.put({ id: 'strava', accessToken: 'TOKEN-A', refreshToken: 'TOKEN-R', expiresAt: 0, scope: 'read,activity:read', connectedAt: '' });
    const ctx = await buildContext();
    expect(ctx.system).not.toContain('TAJNY-NAZEV');
    expect(ctx.system).not.toContain('10,2');
    const exported = await (await exportAll()).text();
    expect(exported).not.toContain('TOKEN-A');
    expect(exported).not.toContain('TAJNY-NAZEV');
  });

  it('splnění se počítá jen pro zobrazení', () => {
    const run = toStravaActivity(raw, new Date())!;
    const planned = (m: number | undefined) => ({ workout: { type: 'easy', title: 'x', distanceM: m, blocks: [] } }) as never;
    expect(completionOf(run, planned(10_000))).toBe('done');
    expect(completionOf(run, planned(16_000))).toBe('short');
    expect(completionOf(run, undefined)).toBe('unplanned');
  });
});

describe('příkazy z chatu (CHAT-02)', () => {
  it('neplatný nebo vymyšlený příkaz nic nezmění', async () => {
    const created = await createDraft(params, 'Test', 'user', 'test');
    if (!created.ok) throw new Error();
    await activateDraft(created.draft!.id, created.revision.id);
    const ctx = await buildContext();
    const before = JSON.stringify(await db().workouts.toArray());
    expect((await handleCommand('{nejde o json', ctx)).proposal?.state).toBe('invalid');
    expect((await handleCommand('{"operation":"MOVE_WORKOUT","payload":{"workoutId":"w999","toDate":"2026-11-20"}}', ctx)).proposal?.state).toBe('invalid');
    expect((await handleCommand('{"operation":"DELETE_EVERYTHING","payload":{}}', ctx)).proposal?.state).toBe('invalid');
    const ok = await handleCommand(`{"operation":"SKIP_WORKOUT","payload":{"workoutId":"${[...ctx.aliases.keys()].find((k) => true)}"}}`, ctx);
    // Platný návrh se jen připraví; do rozpisu se zapíše až po „Použít“.
    expect(['pending', 'invalid']).toContain(ok.proposal?.state);
    expect(JSON.stringify(await db().workouts.toArray())).toBe(before);
  });
});
