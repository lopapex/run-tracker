'use client';

import { ArrowSquareOut, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { formatDuration, formatKm, formatPace, paceOf } from '@/domain/format';
import type { IsoDate, ScheduledWorkout } from '@/domain/types';
import { beginConnect, disconnect, purgeExpired, StravaError, stravaActivityUrl, syncRange } from '@/strava/client';
import type { StravaActivity, StravaConnection } from '@/strava/types';
import { Button, Card, cx, toast } from './primitives';

export interface StravaView {
  connection: StravaConnection | null;
  runs: StravaActivity[];
}

export function useStrava(): StravaView | undefined {
  return useLiveQuery(async () => ({
    connection: (await db().connections.get('strava')) ?? null,
    runs: (await db().stravaActivities.orderBy('localDate').reverse().toArray()).filter((a) => a.isRun),
  }), []);
}

const synced = new Map<string, number>();

/** Načte rozmezí ze Stravy, když je propojená. Stejné rozmezí se neptá častěji než jednou za 10 minut. */
export function useStravaSync(connected: boolean, from: IsoDate, to: IsoDate): { syncing: boolean; error: string | null; refresh: () => void } {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const key = `${from}:${to}`;
    if (tick === 0 && Date.now() - (synced.get(key) ?? 0) < 600_000) return;
    if (!navigator.onLine) { setError('Jsi offline; ukazuji naposledy stažené běhy.'); void purgeExpired(); return; }
    let cancelled = false;
    setSyncing(true);
    syncRange(from, to)
      .then(() => { synced.set(key, Date.now()); if (!cancelled) setError(null); })
      .catch((e) => { if (!cancelled) setError(e instanceof StravaError ? e.message : 'Stravu se nepodařilo načíst.'); })
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [connected, from, to, tick]);
  return { syncing, error, refresh: () => setTick((t) => t + 1) };
}

export async function connectStrava(): Promise<void> {
  try {
    await beginConnect();
  } catch (e) {
    toast(e instanceof StravaError ? e.message : 'Propojení se nepodařilo spustit.', { tone: 'error' });
  }
}

/** Odkaz podle pravidel značky Stravy: text „View on Strava“. V telefonu ho systém otevře v aplikaci, pokud je nainstalovaná. */
export function ViewOnStrava({ id, className }: { id: number; className?: string }) {
  return (
    <a href={stravaActivityUrl(id)} target="_blank" rel="noopener noreferrer" className={cx('inline-flex min-h-11 items-center gap-1.5 font-semibold text-[#FC5200] underline underline-offset-2', className)}>
      View on Strava <ArrowSquareOut size={16} />
    </a>
  );
}

export type Completion = 'done' | 'short' | 'unplanned';

/** Splnění jen pro zobrazení: porovná délku s plánem. Neukládá se, mizí s cache ze Stravy. */
export function completionOf(run: StravaActivity, planned: ScheduledWorkout | undefined): Completion {
  if (!planned || planned.workout.type === 'rest') return 'unplanned';
  if (!planned.workout.distanceM) return 'done';
  return run.distanceM / planned.workout.distanceM >= 0.9 ? 'done' : 'short';
}

export function StravaRun({ run, planned, compact }: { run: StravaActivity; planned?: ScheduledWorkout; compact?: boolean }) {
  const c = completionOf(run, planned);
  const pace = formatPace(paceOf(run.distanceM, run.movingSec));
  return (
    <div className={cx('rounded-[12px] border border-line bg-surface', compact ? 'px-3 py-2' : 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="num text-[15px]">
          <strong>{formatKm(run.distanceM, 2)}</strong> · {formatDuration(run.movingSec)} · <strong>{pace}/km</strong>
          {run.avgHr ? ` · tep ${Math.round(run.avgHr)}` : ''}
        </span>
        {c === 'done' && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-done"><CheckCircle size={16} weight="fill" />odběháno</span>}
        {c === 'short' && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-warn"><WarningCircle size={16} weight="fill" />kratší než plán{planned?.workout.distanceM ? ` (${formatKm(planned.workout.distanceM)})` : ''}</span>}
        {c === 'unplanned' && <span className="text-[13px] text-muted">mimo plán</span>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-muted">{run.name}</span>
        <ViewOnStrava id={run.id} className="shrink-0 text-[14px]" />
      </div>
    </div>
  );
}

/** Karta v přehledu: propojení, nebo stav synchronizace. */
export function StravaCard({ view, syncing, error, onRefresh }: { view: StravaView; syncing: boolean; error: string | null; onRefresh: () => void }) {
  if (!view.connection) {
    return (
      <Card className="space-y-2">
        <h2 className="font-semibold">Strava</h2>
        <p className="text-[15px] text-muted">Propoj Stravu a uvidíš tady své běhy: vzdálenost, tempo a jestli máš dnešek odběhaný. Aplikace jen čte tvoje aktivity; nic neupravuje a trenérovi je nepředává.</p>
        <button type="button" className="min-h-11 w-full rounded-[8px] bg-[#FC5200] px-4 font-semibold text-white active:opacity-70" onClick={connectStrava}>Propojit se Stravou</button>
      </Card>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
      <span>{error ?? (syncing ? 'Načítám běhy ze Stravy…' : `Strava propojená${view.connection.athleteName ? ` · ${view.connection.athleteName}` : ''}`)}</span>
      <span className="flex items-center gap-3">
        <button type="button" className="min-h-11 font-medium text-accent underline" disabled={syncing} onClick={onRefresh}>Obnovit</button>
        <span>Powered by Strava</span>
      </span>
    </div>
  );
}

export function StravaSettings({ view }: { view: StravaView }) {
  const [busy, setBusy] = useState(false);
  if (!view.connection) {
    return (
      <div className="space-y-2">
        <p className="text-[14px] text-muted">Čtení tvých aktivit ze Stravy k zobrazení v přehledu a v plánu. Žádá se jen oprávnění číst aktivity (bez soukromých „jen já“).</p>
        <button type="button" className="min-h-11 w-full rounded-[8px] bg-[#FC5200] px-4 font-semibold text-white active:opacity-70" onClick={connectStrava}>Propojit se Stravou</button>
      </div>
    );
  }
  const c = view.connection;
  return (
    <div className="space-y-2 text-[14px]">
      <dl className="space-y-1">
        <div className="flex justify-between gap-4"><dt className="text-muted">Účet</dt><dd>{c.athleteName ?? 'propojený'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Oprávnění</dt><dd>{c.scope}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Poslední načtení</dt><dd>{c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString('cs-CZ') : 'zatím ne'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Dočasně uložených běhů</dt><dd>{view.runs.length}</dd></div>
      </dl>
      <p className="text-muted">Běhy ze Stravy se v zařízení drží nejvýš 7 dní od stažení a pak se smažou; starší týdny se načtou znovu, až je otevřeš. Trenér (AI) tahle data nedostává, to podmínky Stravy nedovolují.</p>
      <Button variant="danger" className="w-full" disabled={busy} onClick={async () => { setBusy(true); await disconnect(); setBusy(false); toast('Strava odpojená, stažené běhy smazané.'); }}>Odpojit Stravu a smazat stažené běhy</Button>
    </div>
  );
}
