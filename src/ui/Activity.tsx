'use client';

import { ArrowSquareOut } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { db } from '@/db/db';
import { addActivity, deleteActivity, getProfile, saveCheckIn, setMatch } from '@/db/repo';
import { buildActivity, evaluate, fromFitData, matchCandidates, parseGpx, parseTcx, sha256Hex, type ParsedActivity } from '@/domain/activities';
import { formatDay, localDateOf, todayIso } from '@/domain/dates';
import { formatDuration, formatKm, formatPace, paceOf } from '@/domain/format';
import { newId } from '@/domain/schedule';
import type { Activity, CheckIn, PaceChart } from '@/domain/types';
import { Button, Chip, cx, Field, inputClass, Segmented, Sheet, toast } from './primitives';

async function parseFile(file: File): Promise<{ parsed: ParsedActivity; source: Activity['source'] } | { error: string }> {
  const name = file.name.toLowerCase();
  if (file.size > 30 * 1024 * 1024) return { error: 'Soubor je větší než 30 MB.' };
  if (name.endsWith('.gpx')) return { parsed: parseGpx(await file.text()), source: 'file_gpx' };
  if (name.endsWith('.tcx')) return { parsed: parseTcx(await file.text()), source: 'file_tcx' };
  if (name.endsWith('.fit')) {
    const { default: FitParser } = await import('fit-file-parser');
    const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' });
    const buffer = await file.arrayBuffer();
    try {
      const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const maybe = (parser as unknown as { parse: (b: ArrayBuffer, cb: (e: unknown, d: Record<string, unknown>) => void) => unknown }).parse(buffer, (e, d) => (e ? reject(e) : resolve(d)));
        if (maybe && typeof (maybe as Promise<unknown>).then === 'function') (maybe as Promise<Record<string, unknown>>).then(resolve, reject);
      });
      return { parsed: fromFitData(data), source: 'file_fit' };
    } catch {
      return { error: 'FIT soubor se nepodařilo přečíst.' };
    }
  }
  return { error: 'Podporované jsou soubory GPX, TCX a FIT.' };
}

/** Přidání aktivity: vlastní soubor z hodinek nebo ruční zápis (R-07). */
export function AddActivitySheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (a: Activity) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => todayIso());
  const [km, setKm] = useState('');
  const [time, setTime] = useState('');

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const profile = await getProfile();
    let last: Activity | undefined;
    for (const file of Array.from(files)) {
      const r = await parseFile(file);
      if ('error' in r) { toast(`${file.name}: ${r.error}`, { tone: 'error' }); continue; }
      const built = buildActivity(r.parsed, { source: r.source, checksum: await sha256Hex(await file.arrayBuffer()), fileName: file.name, timezone: profile.timezone, now: new Date().toISOString() });
      if ('error' in built) { toast(`${file.name}: ${built.error}`, { tone: 'error' }); continue; }
      const res = await addActivity(built);
      last = res.activity;
      toast(res.duplicate ? `${file.name} už tu je, nic se nepřidalo.` : res.match ? 'Aktivita přidaná a spárovaná s plánem.' : 'Aktivita přidaná.');
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (last) { onClose(); onAdded(last); }
  };

  const addManual = async () => {
    const profile = await getProfile();
    const distanceM = Math.round(Number(km.replace(',', '.')) * 1000);
    const parts = time.split(':').map(Number);
    const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 60;
    if (!(distanceM > 0) || !(sec > 0) || parts.some(Number.isNaN)) { toast('Vyplň vzdálenost v km a čas jako minuty:sekundy.', { tone: 'error' }); return; }
    const day = date || todayIso(profile.timezone);
    const startUtc = new Date(`${day}T12:00:00`).toISOString();
    const res = await addActivity({
      id: newId(), source: 'manual', provenance: 'USER_ENTERED', name: 'Běh', sport: 'run', startUtc,
      localDate: localDateOf(startUtc, profile.timezone) === day ? day : day,
      distanceM, movingSec: sec, elapsedSec: sec, laps: [], missing: ['hr', 'laps', 'elevation', 'gps'], createdAt: new Date().toISOString(),
    });
    toast(res.match ? 'Aktivita zapsaná a spárovaná s plánem.' : 'Aktivita zapsaná.');
    setKm(''); setTime('');
    onClose();
    onAdded(res.activity);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Přidat aktivitu">
      <div className="space-y-5">
        <div>
          <input ref={fileRef} type="file" accept=".gpx,.tcx,.fit" multiple className="sr-only" id="activity-file" onChange={(e) => onFiles(e.target.files)} />
          <Button variant="primary" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Zpracovávám…' : 'Nahrát soubor z hodinek'}</Button>
          <p className="mt-2 text-[13px] text-muted">GPX, TCX nebo FIT. Soubor se zpracuje v zařízení a nikam se neodesílá.</p>
        </div>
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="display text-[20px]">Zapsat ručně</h3>
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2">
            <Field label="Den"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Vzdálenost"><input inputMode="decimal" className={inputClass} value={km} onChange={(e) => setKm(e.target.value)} placeholder="km" aria-label="Vzdálenost v km" /></Field>
            <Field label="Čas"><input className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} placeholder="min:s" aria-label="Čas ve tvaru minuty:sekundy" /></Field>
          </div>
          <p className="text-[13px] text-muted">Například 10 km za 52:30.</p>
          <Button className="w-full" onClick={addManual}>Zapsat běh</Button>
        </div>
      </div>
    </Sheet>
  );
}

const FEELS: Array<{ value: CheckIn['feel']; label: string }> = [
  { value: 1, label: 'Hodně těžké' }, { value: 2, label: 'Těžké' }, { value: 3, label: 'Tak akorát' }, { value: 4, label: 'Dobré' }, { value: 5, label: 'Výborné' },
];

/** Rychlý check-in (§7.4): dvě otázky, zbytek volitelný. */
export function CheckInForm({ activity, existing, onDone }: { activity: Activity; existing?: CheckIn; onDone?: () => void }) {
  const [feel, setFeel] = useState<CheckIn['feel'] | undefined>(existing?.feel);
  const [pain, setPain] = useState<CheckIn['pain']>(existing?.pain ?? 'none');
  const [painNote, setPainNote] = useState(existing?.painNote ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const match = useLiveQuery(() => db().matches.where('activityId').equals(activity.id).first(), [activity.id]);

  const save = async () => {
    if (!feel) return;
    await saveCheckIn({ id: existing?.id, date: activity.localDate, activityId: activity.id, workoutId: match?.workoutId, feel, pain, painNote: pain !== 'none' && painNote ? painNote : undefined, note: note || undefined });
    toast('Pocit uložen.');
    onDone?.();
  };

  return (
    <div className="space-y-3">
      <p className="font-medium">Jaké to bylo?</p>
      <div role="radiogroup" aria-label="Pocit z běhu" className="grid grid-cols-5 gap-1">
        {FEELS.map((f) => (
          <button key={f.value} type="button" role="radio" aria-checked={feel === f.value} onClick={() => setFeel(f.value)} className={cx('min-h-14 rounded-[8px] px-1 text-[12px] font-medium leading-tight', feel === f.value ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted')}>{f.label}</button>
        ))}
      </div>
      <p className="font-medium">Nějaká bolest?</p>
      <Segmented label="Bolest" value={pain} onChange={setPain} options={[{ value: 'none', label: 'Žádná' }, { value: 'mild', label: 'Mírná' }, { value: 'significant', label: 'Výrazná' }]} />
      {pain !== 'none' && <input className={inputClass} placeholder="Kde a jak? (volitelné)" value={painNote} onChange={(e) => setPainNote(e.target.value)} />}
      {pain === 'significant' && <p className="rounded-[8px] bg-danger-soft px-3 py-2 text-[14px] text-danger">Výraznou bolest nepřebíhej. Další dny uber a pokud nepoleví nebo se objeví otok či kulhání, nech se vyšetřit.</p>}
      <input className={inputClass} placeholder="Poznámka (volitelná)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button variant="primary" className="w-full" disabled={!feel} onClick={save}>Uložit pocit</Button>
    </div>
  );
}

export function ActivitySheet({ activityId, onClose, chart }: { activityId: string | null; onClose: () => void; chart?: PaceChart }) {
  const [editCheckIn, setEditCheckIn] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useLiveQuery(async () => {
    if (!activityId) return null;
    const activity = await db().activities.get(activityId);
    if (!activity) return null;
    const match = await db().matches.where('activityId').equals(activityId).first();
    const active = await db().activations.where('status').equals('active').first();
    const workouts = active ? await db().workouts.where('activationId').equals(active.id).toArray() : [];
    const planned = match ? await db().workouts.get(match.workoutId) : undefined;
    const checkIn = await db().checkIns.where('activityId').equals(activityId).first();
    const taken = new Set((await db().matches.toArray()).filter((m) => m.activityId !== activityId).map((m) => m.workoutId));
    return { activity, match, planned, checkIn, candidates: matchCandidates(activity, workouts, taken) };
  }, [activityId]);

  const close = () => { setEditCheckIn(false); setConfirmDelete(false); onClose(); };
  if (!activityId || !data) return <Sheet open={false} onClose={close} title="Aktivita">{null}</Sheet>;
  const { activity: a, planned, checkIn, candidates, match } = data;
  const ev = evaluate(a, planned, chart, checkIn);
  const sourceLabel = a.source === 'manual' ? 'ruční zápis' : `soubor ${a.source.replace('file_', '').toUpperCase()}`;

  return (
    <Sheet open onClose={close} title={a.name}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Chip>{formatDay(a.localDate, { weekday: true })}</Chip>
          <Chip>{sourceLabel}</Chip>
        </div>
        <dl className="num grid grid-cols-3 gap-2 text-center">
          {[
            ['Vzdálenost', formatKm(a.distanceM, 2)],
            ['Čas', formatDuration(a.movingSec)],
            ['Tempo', `${formatPace(paceOf(a.distanceM, a.movingSec))}/km`],
            ['Tep', a.avgHr != null ? `${a.avgHr}` : '–'],
            ['Nastoupáno', a.elevGainM != null ? `${Math.round(a.elevGainM)} m` : '–'],
            ['Kadence', a.avgCadence != null ? `${a.avgCadence}` : '–'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[8px] bg-surface-2 px-2 py-2">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="text-[16px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h3 className="font-semibold">{ev.headline}</h3>
          <Link href={`/trener/?aktivita=${a.id}`} className="flex min-h-11 items-center justify-center rounded-full bg-accent-soft px-3 font-medium">Probrat tento běh s trenérem</Link>
          {ev.facts.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[15px]">{ev.facts.map((f) => <li key={f}>{f}</li>)}</ul>}
          {ev.gaps.length > 0 && <p className="text-[14px] text-muted">Co chybí: {ev.gaps.join(' ')}</p>}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Jednotka plánu</h3>
          {planned ? (
            <div className="flex items-center justify-between gap-2 rounded-[8px] bg-surface-2 px-3 py-2">
              <span>{planned.workout.title} · {formatDay(planned.date, { weekday: true })}{match?.state === 'auto' ? ' (spárováno automaticky)' : ''}</span>
              <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => setMatch(a.id, null)}>Zrušit</button>
            </div>
          ) : candidates.length > 0 ? (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.workout.id}>
                  <button type="button" onClick={() => setMatch(a.id, c.workout.id)} className="w-full rounded-[8px] border border-line px-3 py-2 text-left">
                    <span className="block font-medium">{c.workout.workout.title} · {formatDay(c.workout.date, { weekday: true })}</span>
                    <span className="block text-[13px] text-muted">{c.reasons.join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">V plánu není ve stejný ani sousední den žádná jednotka, ke které by šla aktivita přiřadit.</p>
          )}
        </section>

        <section className="space-y-2 border-t border-line pt-4">
          {checkIn && !editCheckIn ? (
            <div className="flex items-center justify-between gap-2">
              <p>Pocit: <strong>{FEELS.find((f) => f.value === checkIn.feel)?.label}</strong>{checkIn.pain !== 'none' ? `, bolest ${checkIn.pain === 'mild' ? 'mírná' : 'výrazná'}` : ''}{checkIn.note ? ` · ${checkIn.note}` : ''}</p>
              <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => setEditCheckIn(true)}>Změnit</button>
            </div>
          ) : (
            <CheckInForm activity={a} existing={checkIn} onDone={() => setEditCheckIn(false)} />
          )}
        </section>

        {a.laps.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">{a.laps[0].kind === 'device' ? 'Kola z hodinek' : 'Po kilometrech'} ({a.laps.length})</summary>
            <table className="num w-full text-[14px]">
              <thead><tr className="text-left text-muted"><th className="py-1 font-medium">#</th><th className="font-medium">Délka</th><th className="font-medium">Čas</th><th className="font-medium">Tempo</th><th className="font-medium">Tep</th></tr></thead>
              <tbody>
                {a.laps.map((l) => (
                  <tr key={l.index} className="border-t border-line">
                    <td className="py-1">{l.index}</td><td>{formatKm(l.distanceM, 2)}</td><td>{formatDuration(l.durationSec)}</td><td>{formatPace(paceOf(l.distanceM, l.durationSec))}</td><td>{l.avgHr != null ? Math.round(l.avgHr) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        <section className="space-y-2 border-t border-line pt-4">
          <Field label="Odkaz na aktivitu (např. ve Stravě)" hint="Jen odkaz, který sem vložíš. Aplikace ze Stravy nic nestahuje.">
            <input type="url" className={inputClass} defaultValue={a.externalUrl ?? ''} placeholder="https://www.strava.com/activities/…" onBlur={(e) => { const v = e.target.value.trim(); if (v === (a.externalUrl ?? '')) return; if (v && !/^https:\/\//.test(v)) { toast('Odkaz musí začínat https://', { tone: 'error' }); return; } void db().activities.update(a.id, { externalUrl: v || undefined }); }} />
          </Field>
          {a.externalUrl && (
            <a href={a.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-medium text-accent underline">
              <ArrowSquareOut size={18} /> {/strava\.com/.test(a.externalUrl) ? 'View on Strava' : 'Otevřít odkaz'}
            </a>
          )}
        </section>

        {confirmDelete ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setConfirmDelete(false)}>Nechat</Button>
            <Button variant="danger" className="flex-1" onClick={async () => { await deleteActivity(a.id); toast('Aktivita smazána.'); close(); }}>Opravdu smazat</Button>
          </div>
        ) : (
          <Button variant="ghost" className="w-full text-danger" onClick={() => setConfirmDelete(true)}>Smazat aktivitu</Button>
        )}
      </div>
    </Sheet>
  );
}
