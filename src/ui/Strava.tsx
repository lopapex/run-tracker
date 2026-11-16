'use client';

import { ArrowSquareOut, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    if (e instanceof StravaError && e.code === 'not_configured') { location.href = '/profil/#strava'; return; }
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
    <div className={cx('rounded-[16px] border border-line bg-surface', compact ? 'px-3 py-2' : 'p-4')}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-3">
          <span><span className={cx('display', compact ? 'text-[22px]' : 'text-[34px]')}>{formatKm(run.distanceM, 2).replace(' km', '')}</span> <span className="label text-muted">km</span></span>
          <span><span className={cx('display', compact ? 'text-[22px]' : 'text-[34px]')}>{pace}</span> <span className="label text-muted">/km</span></span>
          <span className="num text-[13px] text-muted">{formatDuration(run.movingSec)}{run.avgHr ? ` · tep ${Math.round(run.avgHr)}` : ''}</span>
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
        <h2 className="display text-[24px]">Strava</h2>
        <p className="text-[15px] text-muted">Propoj Stravu a uvidíš tady své běhy: vzdálenost, tempo a jestli máš dnešek odběhaný. Aplikace jen čte tvoje aktivity; nic neupravuje a trenérovi je nepředává.</p>
        <Link href="/profil/#strava" className="flex min-h-12 w-full items-center justify-center rounded-full bg-[#FC5200] px-4 font-semibold text-white active:opacity-70">Nastavit propojení Stravy</Link>
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
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/api/strava').then(r => r.ok ? r.json() : null).then(data => { if (active) setConfigured(data?.configured ?? false); }).catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);
  if (!view.connection) {
    return (
      <div className="space-y-2">
        <p className="text-[14px] text-muted">Čtení tvých aktivit ze Stravy k zobrazení v přehledu a v plánu. Žádá se jen oprávnění číst aktivity (bez soukromých „jen já“).</p>
        {configured === false ? <div className="space-y-2 rounded-[12px] border border-line p-3 text-[14px]">
          <p className="font-medium">Provozovatel musí nejdřív nastavit Stravu</p>
          <p>Běžný uživatel žádný klíč nezadává. Až bude propojení připravené, tlačítko tě zavede do Stravy, kde povolíš čtení svých aktivit.</p>
          <details><summary className="min-h-11 cursor-pointer py-2 font-medium">Návod pro provozovatele aplikace</summary><ol className="list-decimal space-y-2 pl-5">
            <li>Otevři <a className="underline" href="https://www.strava.com/settings/api" target="_blank" rel="noopener noreferrer">Strava → Settings → My API Application</a> a založ aplikaci.</li>
            <li>Jako web použij adresu této aplikace. Authorization Callback Domain nastav na <code className="break-all">{typeof location !== 'undefined' ? location.hostname : 'doménu aplikace'}</code> bez https:// a bez cesty.</li>
            <li>V Netlify otevři projekt → Project configuration → Environment variables. Client ID vlož jako <code>STRAVA_CLIENT_ID</code>, Client Secret jako <code>STRAVA_CLIENT_SECRET</code> pro Functions. Secret nepatří do veřejného kódu.</li>
            <li>Spusť nové nasazení a vrať se sem. Pak můžeš připojit svůj Strava účet. Pro veřejné uživatele je potřeba také schválení Stravy.</li>
          </ol></details>
        </div> : <button disabled={configured == null} type="button" className="min-h-12 w-full rounded-full bg-[#FC5200] px-4 font-semibold text-white active:opacity-70 disabled:opacity-50" onClick={connectStrava}>{configured == null ? 'Ověřuji dostupnost propojení…' : 'Propojit se Stravou'}</button>}
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
