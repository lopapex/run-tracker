'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { exportAll, saveProfile, wipeAll } from '@/db/repo';
import { addDays, DOW_LONG, todayIso } from '@/domain/dates';
import { INTENT_LABEL } from '@/domain/drafts';
import { formatPace, INTENSITY_LABEL, parsePace } from '@/domain/format';
import type { Dow, PaceChart, TrainingIntent } from '@/domain/types';
import { useProfile } from '@/ui/hooks';
import { Button, Card, Chip, DayToggles, Field, inputClass, Segmented, toast } from '@/ui/primitives';
import { StravaSettings, useStrava } from '@/ui/Strava';

const PACE_KEYS: Array<keyof PaceChart> = ['easy', 'mp', 'hm_pace', '10k_pace', '5k_pace'];

export default function ProfilePage() {
  const profile = useProfile();
  const [period, setPeriod] = useState<7 | 30 | 0>(7);
  const usage = useLiveQuery(() => db().usage.orderBy('startedAt').reverse().toArray(), []);
  const counts = useLiveQuery(async () => ({ plans: await db().templates.count(), activities: await db().activities.count(), messages: await db().messages.count(), documents: await db().documents.count() }), []);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [confirmWipe, setConfirmWipe] = useState(false);
  const strava = useStrava();

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);

  if (!profile || !usage || !counts || !strava) return null;
  const since = period ? addDays(todayIso(profile.timezone), -period) : '';
  const inPeriod = usage.filter((u) => !since || u.startedAt.slice(0, 10) >= since);
  const measured = inPeriod.filter((u) => u.totalTokens != null);
  const sum = (k: 'inputTokens' | 'outputTokens' | 'totalTokens') => measured.reduce((a, u) => a + (u[k] ?? 0), 0);
  const mb = (n?: number) => (n != null ? `${(n / 1024 / 1024).toFixed(n > 1024 ** 3 ? 0 : 1)} MB` : 'neznámé');
  const setChart = (key: keyof PaceChart, part: 'fromSec' | 'toSec', value: string) => {
    const sec = parsePace(value);
    if (value.trim() && sec == null) { toast('Tempo zadej jako 4:45.', { tone: 'error' }); return; }
    const chart: PaceChart = { ...(profile.paceChart ?? {}) };
    const cur = chart[key] ?? { fromSec: sec ?? 0, toSec: sec ?? 0 };
    if (sec == null) delete chart[key];
    else chart[key] = { ...cur, [part]: sec, ...(chart[key] ? {} : { fromSec: sec, toSec: sec }) };
    void saveProfile({ paceChart: chart });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h2 className="font-semibold">Účet</h2>
        <p className="text-[15px] text-muted">Používáš aplikaci bez účtu. Všechna data jsou jen v tomhle zařízení a prohlížeči. Přihlášení a synchronizace mezi zařízeními zatím nejsou hotové; do té doby si data zálohuj exportem.</p>
        <Field label="Jméno (volitelné)"><input className={inputClass} defaultValue={profile.name ?? ''} onBlur={(e) => saveProfile({ name: e.target.value.trim() || undefined })} /></Field>
        <dl className="text-[14px] text-muted"><div className="flex justify-between"><dt>Jazyk a jednotky</dt><dd>čeština, km, min/km</dd></div><div className="flex justify-between"><dt>Časová zóna</dt><dd>{profile.timezone}</dd></div></dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Záměr a dostupnost</h2>
        <Segmented label="Záměr" value={profile.intent ?? ''} onChange={(v) => saveProfile({ intent: (v || undefined) as TrainingIntent | undefined })} options={(Object.keys(INTENT_LABEL) as TrainingIntent[]).map((k) => ({ value: k, label: k === 'maintain' ? 'Udržování' : k === 'improve' ? 'Zlepšení' : 'Závod' }))} />
        {profile.intent === 'race' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum závodu"><input type="date" className={inputClass} defaultValue={profile.raceDate ?? ''} onBlur={(e) => saveProfile({ raceDate: e.target.value || undefined })} /></Field>
            <Field label="Délka v km"><input inputMode="decimal" className={inputClass} defaultValue={profile.raceDistanceM ? profile.raceDistanceM / 1000 : ''} onBlur={(e) => { const n = Number(e.target.value.replace(',', '.')); void saveProfile({ raceDistanceM: n > 0 ? n * 1000 : undefined }); }} /></Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Týdenní objem v km"><input inputMode="decimal" className={inputClass} defaultValue={profile.weeklyKm ?? ''} onBlur={(e) => { const n = Number(e.target.value.replace(',', '.')); void saveProfile({ weeklyKm: n > 0 ? n : undefined }); }} /></Field>
          <Field label="Běhů týdně"><input inputMode="numeric" className={inputClass} defaultValue={profile.runsPerWeek ?? ''} onBlur={(e) => { const n = Number(e.target.value); void saveProfile({ runsPerWeek: n >= 1 && n <= 7 ? Math.round(n) : undefined }); }} /></Field>
        </div>
        <div><span className="mb-1 block text-[13px] font-medium text-muted">Dny bez běhu</span><DayToggles label="Dny bez běhu" value={profile.restDows} onChange={(v) => saveProfile({ restDows: v as Dow[] })} /></div>
        <Field label="Den dlouhého běhu">
          <select className={inputClass} value={profile.longRunDow} onChange={(e) => saveProfile({ longRunDow: Number(e.target.value) as Dow })}>{DOW_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </Field>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Moje tempa</h2>
        <p className="text-[14px] text-muted">Pásma v min/km. Zobrazí se u jednotek a přepočítají časové úseky na odhad kilometrů. Z importovaného PDF se zatím nenačítají, zadej je sem.</p>
        {PACE_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
            <span className="text-[15px]">{INTENSITY_LABEL[k]}</span>
            <input aria-label={`${INTENSITY_LABEL[k]} od`} className={inputClass} placeholder="od" defaultValue={profile.paceChart?.[k] ? formatPace(profile.paceChart[k]!.fromSec) : ''} onBlur={(e) => setChart(k, 'fromSec', e.target.value)} />
            <input aria-label={`${INTENSITY_LABEL[k]} do`} className={inputClass} placeholder="do" defaultValue={profile.paceChart?.[k] ? formatPace(profile.paceChart[k]!.toSec) : ''} onBlur={(e) => setChart(k, 'toSec', e.target.value)} />
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">AI a spotřeba</h2>
        <p className="text-[14px] text-muted">Trenéra používáš ve vlastním ChatGPT / Claude s jeho oficiálním připojením ke Stravě. V aplikaci otevři Trenér → připrav otázku → zkopíruj podklady → vrať návrh. Žádný API klíč není potřeba.</p>

        <h3 className="pt-2 text-[15px] font-medium">Historická spotřeba</h3>
        <Segmented label="Období" value={period} onChange={setPeriod} options={[{ value: 7, label: '7 dní' }, { value: 30, label: '30 dní' }, { value: 0, label: 'Vše' }]} />
        <dl className="num grid grid-cols-2 gap-2 text-center">
          {[['Požadavků', inPeriod.length], ['Tokenů celkem', sum('totalTokens')], ['Vstupních', sum('inputTokens')], ['Výstupních', sum('outputTokens')]].map(([k, v]) => (
            <div key={String(k)} className="rounded-[8px] bg-surface-2 px-2 py-2"><dt className="text-[12px] text-muted">{k}</dt><dd className="text-[16px] font-semibold">{Number(v).toLocaleString('cs-CZ')}</dd></div>
          ))}
        </dl>
        <p className="text-[13px] text-muted">
          Historie požadavků starších verzí aplikace. Spotřebu a zbývající limit vlastního ChatGPT / Claude tato aplikace nevidí; kontroluj je přímo v dané službě. {inPeriod.length - measured.length > 0 ? `U ${inPeriod.length - measured.length} požadavků není počet tokenů známý. ` : ''}
        </p>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">Zdroje dat</h2>
        <p className="text-[15px] text-muted">Aktivity přidáváš vlastním souborem z hodinek (GPX, TCX, FIT) nebo ručně. K aktivitě si můžeš uložit odkaz, třeba na Stravu.</p>
        <h3 className="pt-2 text-[15px] font-medium">Strava</h3>
        <StravaSettings view={strava} />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Data v zařízení</h2>
        <dl className="num space-y-1 text-[15px]">
          {[['Ověřené plány', counts.plans], ['Uložené originály', counts.documents], ['Aktivity', counts.activities], ['Zprávy v chatu', counts.messages], ['Obsazené úložiště (včetně modelů)', mb(storage.usage)], ['Trvalé úložiště', storage.persisted == null ? 'neznámé' : storage.persisted ? 'ano' : 'ne, prohlížeč může data smazat']].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <Button className="w-full" onClick={async () => { const blob = await exportAll(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `run-tracker-${todayIso(profile.timezone)}.json`; a.click(); URL.revokeObjectURL(a.href); }}>Exportovat moje data (JSON)</Button>
        {confirmWipe ? (
          <div className="space-y-2 rounded-[8px] bg-danger-soft p-3">
            <p className="text-[14px] text-danger">Smaže plány, aktivity, chat, originály i nastavení z tohoto zařízení. Nejde to vrátit. </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => setConfirmWipe(false)}>Nechat</Button>
              <Button variant="danger" className="flex-1" onClick={async () => { await wipeAll(); sessionStorage.clear(); location.href = '/'; }}>Smazat všechno</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="w-full text-danger" onClick={() => setConfirmWipe(true)}>Smazat všechna moje data</Button>
        )}
      </Card>
    </div>
  );
}
