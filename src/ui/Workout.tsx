'use client';

import { ArrowsLeftRight, CheckCircle, Lock, MinusCircle, WarningCircle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useState } from 'react';
import { db } from '@/db/db';
import { undoRevision } from '@/db/repo';
import { OPERATION_LABEL } from '@/domain/commands';
import { addDays, DOW_SHORT, dowOf, formatDay, weekStartOf } from '@/domain/dates';
import { blockLines, formatKm, formatShortDuration, LOAD_LABEL, TYPE_LABEL, workoutSummary } from '@/domain/format';
import type { Load, PaceChart, ScheduledWorkout, WorkoutSpec, WorkoutType } from '@/domain/types';
import { runWithUndo } from './hooks';
import { Button, Chip, cx, Field, inputClass, Sheet, toast } from './primitives';

export const LOAD_DOT: Record<Load, string> = { rest: 'bg-rest', low: 'bg-load-low', medium: 'bg-load-medium', high: 'bg-load-high' };

export function LoadBadge({ load }: { load?: Load }) {
  if (!load) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className={cx('size-2 rounded-full', LOAD_DOT[load])} aria-hidden />
      {LOAD_LABEL[load]}
    </span>
  );
}

export function StatusMark({ w }: { w: ScheduledWorkout }) {
  if (w.status === 'completed') return <span className="inline-flex items-center gap-1 text-[13px] font-medium text-done"><CheckCircle size={16} weight="fill" />splněno</span>;
  if (w.status === 'partial') return <span className="inline-flex items-center gap-1 text-[13px] font-medium text-warn"><WarningCircle size={16} weight="fill" />částečně</span>;
  if (w.status === 'skipped') return <span className="inline-flex items-center gap-1 text-[13px] font-medium text-muted"><MinusCircle size={16} />vynecháno</span>;
  return null;
}

export function WorkoutBody({ workout, chart }: { workout: WorkoutSpec; chart?: PaceChart }) {
  const lines = blockLines(workout.blocks, chart);
  return (
    <div className="space-y-2 text-[15px]">
      <p className="num text-muted">{workoutSummary(workout)}</p>
      {lines.length > 0 && (
        <ol className="space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="num rounded-[10px] bg-surface-2 px-3 py-1.5">{l}</li>
          ))}
        </ol>
      )}
      {workout.strengthMin && <p>Posilování {workout.strengthMin} min</p>}
      {workout.note && <p className="text-muted">{workout.note}</p>}
      {workout.rawInstruction && (
        <div className="rounded-[8px] border border-line p-3">
          <p className="text-[13px] font-medium text-muted">Původní znění</p>
          <p className="whitespace-pre-line">{workout.rawInstruction}</p>
        </div>
      )}
    </div>
  );
}

export function WorkoutRow({ w, onOpen, today }: { w: ScheduledWorkout; onOpen: () => void; today: string }) {
  const rest = w.workout.type === 'rest';
  const moved = w.date !== w.originDate;
  return (
    <button type="button" onClick={onOpen} className={cx('relative flex w-full items-center gap-3 overflow-hidden rounded-[16px] text-left transition-transform active:scale-[0.99]', rest ? 'min-h-11 px-3 py-1' : 'min-h-16 border border-line bg-surface py-2 pl-4 pr-3', w.date === today && !rest && 'ring-2 ring-accent', w.status === 'skipped' && 'opacity-60')}>
      {!rest && <span aria-hidden className={cx('absolute inset-y-0 left-0 w-1.5', LOAD_DOT[w.workout.load ?? 'low'])} />}
      <span className="w-9 shrink-0 text-center">
        <span className={cx('label block', w.date === today ? 'text-text' : 'text-muted')}>{DOW_SHORT[dowOf(w.date)]}</span>
        <span className={cx('display block text-[22px]', rest && 'text-muted')}>{Number(w.date.slice(8))}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate', rest ? 'text-[14px] text-muted' : 'font-semibold', w.status === 'skipped' && 'line-through')}>{w.workout.title}</span>
        {!rest && <span className="num block truncate text-[13px] text-muted">{workoutSummary(w.workout)}</span>}
      </span>
      {!rest && w.workout.distanceM != null && (
        <span className="shrink-0 text-right">
          <span className="display block text-[26px]">{String(Math.round(w.workout.distanceM / 100) / 10).replace('.', ',')}</span>
          <span className="label block text-[11px] text-muted">km</span>
        </span>
      )}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <StatusMark w={w} />
        {moved && !rest && w.status === 'scheduled' && <span className="inline-flex items-center gap-1 text-[12px] text-warn"><ArrowsLeftRight size={14} />přesunuto</span>}
        {w.locked && <Lock size={14} className="text-muted" aria-label="zamčeno" />}
      </span>
    </button>
  );
}

const TYPES: WorkoutType[] = ['easy', 'long', 'speed', 'tempo', 'race', 'strength', 'cross', 'rest', 'other'];

/** Jednoduchá editace jednotky. Vizuální editor bloků je mimo MVP (§2.1); strukturu jde ponechat nebo zahodit. */
export function WorkoutEditor({ value, onChange }: { value: WorkoutSpec; onChange: (w: WorkoutSpec) => void }) {
  const set = (patch: Partial<WorkoutSpec>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Typ">
          <select
            className={inputClass}
            value={value.type}
            onChange={(e) => {
              const type = e.target.value as WorkoutType;
              const wasDefault = Object.values(TYPE_LABEL).includes(value.title) || !value.title;
              set({ type, title: wasDefault ? TYPE_LABEL[type] : value.title, ...(type === 'rest' ? { distanceM: undefined, durationSec: undefined, blocks: [], load: 'rest' as Load } : value.load === 'rest' ? { load: 'low' as Load } : {}) });
            }}
          >
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Zátěž">
          <select className={inputClass} value={value.load ?? ''} onChange={(e) => set({ load: (e.target.value || undefined) as Load | undefined })}>
            <option value="">neuvedeno</option>
            {(Object.keys(LOAD_LABEL) as Load[]).map((l) => <option key={l} value={l}>{LOAD_LABEL[l]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Název"><input className={inputClass} value={value.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      {value.type !== 'rest' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Délka v km">
            <input inputMode="decimal" className={inputClass} value={value.distanceM != null ? String(value.distanceM / 1000).replace('.', ',') : ''} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); set({ distanceM: e.target.value.trim() && n >= 0 ? Math.round(n * 1000) : undefined }); }} />
          </Field>
          <Field label="Čas v minutách">
            <input inputMode="numeric" className={inputClass} value={value.durationSec != null ? String(Math.round(value.durationSec / 60)) : ''} onChange={(e) => { const n = Number(e.target.value); set({ durationSec: e.target.value.trim() && n > 0 ? Math.round(n * 60) : undefined }); }} />
          </Field>
        </div>
      )}
      {value.blocks.length > 0 && (
        <div className="rounded-[8px] border border-line p-3 text-[14px]">
          <p className="mb-1 font-medium text-muted">Struktura</p>
          <ul className="num space-y-0.5">{blockLines(value.blocks).map((l, i) => <li key={i}>{l}</li>)}</ul>
          <button type="button" className="mt-2 min-h-11 text-danger underline" onClick={() => set({ blocks: [] })}>Odebrat strukturu</button>
        </div>
      )}
      <Field label="Poznámka"><textarea className={cx(inputClass, 'py-2')} rows={2} value={value.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} /></Field>
    </div>
  );
}

export function isValidSpec(w: WorkoutSpec): boolean {
  return w.title.trim().length > 0;
}

/** Detail jednotky (§4.4): záměr, bloky, původ, historie a akce. */
export function WorkoutSheet({ workout, onClose, chart, today }: { workout: ScheduledWorkout | null; onClose: () => void; chart?: PaceChart; today: string }) {
  const [mode, setMode] = useState<'view' | 'move' | 'edit'>('view');
  const [draft, setDraft] = useState<WorkoutSpec | null>(null);
  const live = useLiveQuery(async () => (workout ? await db().workouts.get(workout.id) : undefined), [workout?.id]);
  const history = useLiveQuery(async () => {
    if (!workout) return [];
    const all = await db().revisions.where('activationId').equals(workout.activationId).toArray();
    return all.filter((r) => [...r.before, ...r.after].some((x) => x.id === workout.id)).sort((a, b) => b.seq - a.seq);
  }, [workout?.id]);
  const dayOthers = useLiveQuery(async () => (workout ? db().workouts.where('activationId').equals(workout.activationId).toArray() : []), [workout?.id]);
  const matched = useLiveQuery(async () => {
    if (!workout) return [];
    const ms = await db().matches.where('workoutId').equals(workout.id).toArray();
    return (await db().activities.bulkGet(ms.map((m) => m.activityId))).filter((a) => a != null);
  }, [workout?.id]);

  const w = live ?? workout;
  const close = () => { setMode('view'); setDraft(null); onClose(); };
  if (!w) return <Sheet open={false} onClose={close} title="Jednotka">{null}</Sheet>;

  const changed = w.original != null && JSON.stringify(w.original) !== JSON.stringify(w.workout);
  const moved = w.date !== w.originDate;
  const editable = w.status === 'scheduled' || w.status === 'skipped';
  const moveDays = Array.from({ length: 14 }, (_, i) => addDays(weekStartOf(w.date), i)).filter((d) => d !== w.date && d >= today);

  const move = async (toDate: string) => {
    const blocking = (dayOthers ?? []).some((o) => o.date === toDate && o.id !== w.id && o.workout.type !== 'rest' && o.status !== 'skipped');
    if (await runWithUndo({ operation: 'MOVE_WORKOUT', payload: { workoutId: w.id, toDate, ...(blocking ? { onConflict: 'swap' } : {}) }, reason: 'Ruční přesun' })) close();
  };

  return (
    <Sheet
      open
      onClose={close}
      title={mode === 'move' ? 'Přesunout na jiný den' : mode === 'edit' ? 'Upravit jednotku' : w.workout.title}
      footer={
        mode === 'edit' && draft ? (
          <>
            <Button onClick={() => setMode('view')}>Zrušit</Button>
            <Button variant="primary" className="flex-1" disabled={!isValidSpec(draft)} onClick={async () => { if (await runWithUndo({ operation: 'EDIT_WORKOUT', payload: { workoutId: w.id, workout: draft }, reason: 'Ruční úprava' })) setMode('view'); }}>Uložit</Button>
          </>
        ) : mode === 'move' ? (
          <Button onClick={() => setMode('view')}>Zpět</Button>
        ) : undefined
      }
    >
      {mode === 'view' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{formatDay(w.date, { weekday: true })}</Chip>
            {w.sourceWeek != null && <Chip>týden {w.sourceWeek}</Chip>}
            <LoadBadge load={w.workout.load} />
            <StatusMark w={w} />
            {w.locked && <Chip><Lock size={12} /> zamčeno</Chip>}
          </div>
          <WorkoutBody workout={w.workout} chart={chart} />
          {(moved || changed) && (
            <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">
              {moved && `Původně ${formatDay(w.originDate, { weekday: true })}. `}
              {changed && `Obsah se liší od plánu (${w.original!.title}${w.original!.distanceM ? `, ${formatKm(w.original!.distanceM)}` : w.original!.durationSec ? `, ${formatShortDuration(w.original!.durationSec)}` : ''}).`}
            </p>
          )}
          {w.original == null && <p className="text-[14px] text-muted">Přidáno ručně, mimo původní plán.</p>}
          {(matched?.length ?? 0) > 0 && (
            <div className="text-[14px]">
              <p className="font-medium text-muted">Spárované aktivity</p>
              {matched!.map((a) => <p key={a!.id} className="num">{formatDay(a!.localDate)} · {formatKm(a!.distanceM)}</p>)}
            </div>
          )}
          {editable && (
            <div className="grid grid-cols-2 gap-2">
              {w.status === 'scheduled' && <Button disabled={w.locked} onClick={() => setMode('move')}>Přesunout</Button>}
              <Button disabled={w.locked} onClick={() => { setDraft(structuredClone(w.workout)); setMode('edit'); }}>Upravit</Button>
              {w.status === 'scheduled' && w.workout.type !== 'rest' && <Button onClick={async () => { if (await runWithUndo({ operation: 'SKIP_WORKOUT', payload: { workoutId: w.id }, reason: 'Ruční vynechání' })) close(); }}>Vynechat</Button>}
              <Button onClick={() => runWithUndo({ operation: 'SET_LOCK', payload: { workoutId: w.id, locked: !w.locked } })}>{w.locked ? 'Odemknout' : 'Zamknout'}</Button>
              {(changed || moved || w.status === 'skipped') && w.original && <Button className="col-span-2" disabled={w.locked} onClick={() => runWithUndo({ operation: 'RESTORE_ORIGINAL', payload: { workoutId: w.id }, reason: 'Návrat k plánu' })}>Obnovit původní předpis</Button>}
            </div>
          )}
          <Link href={`/trener/?jednotka=${w.id}`} className="flex min-h-12 items-center justify-center rounded-full bg-accent-soft font-semibold text-text">Probrat s trenérem</Link>
          {(history?.length ?? 0) > 0 && (
            <details className="text-[14px]">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-muted">Historie změn ({history!.length})</summary>
              <ul className="space-y-2">
                {history!.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-[8px] bg-surface-2 px-3 py-2">
                    <span>
                      <span className="block">{OPERATION_LABEL[r.operation] ?? r.operation}{r.reason ? ` · ${r.reason}` : ''}</span>
                      <span className="num text-[12px] text-muted">{new Date(r.at).toLocaleString('cs-CZ')} · {r.author === 'user' ? 'ty' : r.author === 'coach' ? 'návrh trenéra' : 'aplikace'}{r.revertedById ? ' · vráceno' : ''}</span>
                    </span>
                    {!r.revertedById && r.operation !== 'REVERT' && r.author !== 'system' && (
                      <button type="button" className="min-h-11 px-2 font-medium text-accent underline" onClick={async () => { const u = await undoRevision(r.id); toast(u.ok ? 'Změna vrácena.' : u.message, { tone: u.ok ? 'info' : 'error' }); }}>Vrátit</button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {mode === 'move' && (
        <div className="space-y-2">
          <p className="text-[14px] text-muted">Když je cílový den obsazený, jednotky se prohodí.</p>
          {moveDays.map((d) => {
            const there = (dayOthers ?? []).filter((o) => o.date === d && o.status !== 'skipped');
            const label = there.find((o) => o.workout.type !== 'rest')?.workout.title ?? (there.length ? 'Volno' : 'nic');
            return (
              <button key={d} type="button" onClick={() => move(d)} className="flex min-h-12 w-full items-center justify-between rounded-[8px] border border-line px-3 text-left">
                <span className="font-medium">{formatDay(d, { weekday: true })}</span>
                <span className="text-[13px] text-muted">{label}</span>
              </button>
            );
          })}
        </div>
      )}
      {mode === 'edit' && draft && <WorkoutEditor value={draft} onChange={setDraft} />}
    </Sheet>
  );
}
