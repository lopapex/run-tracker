'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { db } from '@/db/db';
import { archiveActivePlan } from '@/db/repo';
import { addDays, DOW_SHORT, formatDay, formatWeekRange, weekDates, weekStartOf } from '@/domain/dates';
import { formatKm, weekTotalM } from '@/domain/format';
import { dayWorkouts, planRange } from '@/domain/schedule';
import type { PlanTemplate, ScheduledWorkout } from '@/domain/types';
import { ActivitySheet, AddActivitySheet } from '@/ui/Activity';
import { DraftCard } from '@/ui/DraftCard';
import { runWithUndo, useActivities, usePlan, useProfile, useToday } from '@/ui/hooks';
import { ActivateSheet, DraftFormSheet, ManualWeekSheet } from '@/ui/PlanSetup';
import { Button, Chip, cx, EmptyState, Sheet, toast } from '@/ui/primitives';
import { StravaRun, useStrava, useStravaSync } from '@/ui/Strava';
import { LOAD_DOT, WorkoutEditor, WorkoutRow, WorkoutSheet, isValidSpec } from '@/ui/Workout';

const VIEW_KEY = 'rt.viewedWeek';

/** Plán (§4.3): týdenní agenda s plánem i realitou. Otevřený týden je nezávislý na pozici v plánu (INV-03). */
export default function PlanPage() {
  const profile = useProfile();
  const today = useToday(profile);
  const plan = usePlan();
  const acts = useActivities();
  const drafts = useLiveQuery(() => db().drafts.orderBy('createdAt').reverse().toArray(), []);
  const templates = useLiveQuery(() => db().templates.orderBy('createdAt').reverse().toArray(), []);

  const [viewed, setViewed] = useState<string | null>(null);
  const [open, setOpen] = useState<ScheduledWorkout | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState(false);
  const [draftForm, setDraftForm] = useState(false);
  const [toActivate, setToActivate] = useState<PlanTemplate | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [addDay, setAddDay] = useState<string | null>(null);
  const [newSpec, setNewSpec] = useState({ type: 'easy' as const, title: 'Volný běh', load: 'low' as const, blocks: [] });

  // Návrat z detailu, chatu nebo cizí stránky zachová otevřený týden (§4.3).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('navrh')) setOpenDraft(q.get('navrh'));
    setViewed(sessionStorage.getItem(VIEW_KEY) ?? null);
  }, []);
  const weekStart = viewed ?? weekStartOf(today);
  const strava = useStrava();
  // Starší týdny se ze Stravy načtou až při otevření; budoucí se neptají.
  const sync = useStravaSync(Boolean(strava?.connection) && weekStart <= today, weekStart, addDays(weekStart, 6));
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const go = (ws: string) => { setSlide(ws > weekStart ? 'next' : ws < weekStart ? 'prev' : null); setViewed(ws); sessionStorage.setItem(VIEW_KEY, ws); };
  // Přejetí palcem mezi týdny; šipky nahoře zůstávají jako viditelná alternativa (§4.3).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.8) go(addDays(weekStart, dx < 0 ? 7 : -7));
  };

  if (!plan || !acts || !profile || !drafts || !templates || !strava) return null;
  const chart = profile.paceChart ?? plan.template?.paceChart;
  const openDrafts = drafts.filter((d) => d.status === 'draft' || d.status === 'ready');

  const setup = (
    <div className="grid gap-2">
      <Link href="/import/" className="flex min-h-12 items-center justify-center rounded-full bg-accent px-4 font-semibold text-accent-ink">Importovat z PDF nebo obrázku</Link>
      <Button onClick={() => setManual(true)}>Zapsat týden ručně</Button>
      <Button onClick={() => setDraftForm(true)}>Navrhnout plán</Button>
    </div>
  );

  const sheets = (
    <>
      <ManualWeekSheet open={manual} onClose={() => setManual(false)} profile={profile} onPublished={(t) => { setManual(false); setToActivate(t); }} />
      <DraftFormSheet open={draftForm} onClose={() => setDraftForm(false)} profile={profile} onCreated={(id) => { setDraftForm(false); setOpenDraft(id); }} />
      <ActivateSheet template={toActivate} profile={profile} hasActive={plan.activation != null} onClose={() => setToActivate(null)} onDone={() => { setToActivate(null); go(weekStartOf(today)); }} />
      <Sheet open={openDraft != null} onClose={() => setOpenDraft(null)} title="Návrh plánu">{openDraft && <DraftCard draftId={openDraft} onActivated={(ws) => { setOpenDraft(null); go(ws); }} />}</Sheet>
    </>
  );

  if (!plan.activation && plan.workouts.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState title="Začni plánem">
          <p>Vyber, odkud plán vezmeš. Všechno jde později změnit.</p>
          {setup}
        </EmptyState>
        {openDrafts.length > 0 && (
          <section className="space-y-2">
            <h2 className="display text-[24px]">Rozpracované návrhy</h2>
            {openDrafts.map((d) => <DraftCard key={d.id} draftId={d.id} compact />)}
          </section>
        )}
        {templates.length > 0 && (
          <section className="space-y-2">
            <h2 className="display text-[24px]">Ověřené plány</h2>
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => setToActivate(t)} className="flex min-h-12 w-full items-center justify-between rounded-[12px] border border-line bg-surface px-3 text-left">
                <span className="font-medium">{t.name}</span>
                <span className="text-[13px] text-muted">{t.weeks.length} týdnů · zařadit</span>
              </button>
            ))}
          </section>
        )}
        {sheets}
      </div>
    );
  }

  const dates = weekDates(weekStart);
  const mapping = plan.activation?.mapping.find((m) => m.weekStart === weekStart);
  const range = plan.activation ? planRange(plan.activation) : undefined;
  const weekWorkouts = dates.flatMap((d) => dayWorkouts(plan.workouts, d));
  const planned = weekTotalM(weekWorkouts.filter((w) => w.status !== 'skipped').map((w) => w.workout));
  const weekActs = acts.activities.filter((a) => a.localDate >= weekStart && a.localDate <= dates[6] && a.sport === 'run');
  // Stejný běh nahraný souborem i načtený ze Stravy se nepočítá dvakrát.
  const weekStrava = strava.runs.filter((r) => r.localDate >= weekStart && r.localDate <= dates[6] && !weekActs.some((a) => a.localDate === r.localDate && Math.abs(a.distanceM - r.distanceM) < 300));
  const doneM = weekActs.reduce((s, a) => s + a.distanceM, 0) + weekStrava.reduce((s, r) => s + r.distanceM, 0);
  const isCurrent = weekStart === weekStartOf(today);
  const templateWeek = mapping?.sourceWeek != null ? plan.template?.weeks.find((w) => w.index === mapping.sourceWeek) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Předchozí týden" className="grid size-11 place-items-center rounded-full hover:bg-surface-2" onClick={() => go(addDays(weekStart, -7))}><CaretLeft size={20} /></button>
        <div className="flex-1 text-center">
          <p className="display text-[26px]">{formatWeekRange(weekStart)}</p>
          <p className="label text-muted">{mapping ? (mapping.sourceWeek != null ? `týden ${mapping.sourceWeek}${templateWeek?.phase ? ` · ${templateWeek.phase}` : ''}` : 'pauza') : 'mimo plán'}</p>
        </div>
        <button type="button" aria-label="Další týden" className="grid size-11 place-items-center rounded-full hover:bg-surface-2" onClick={() => go(addDays(weekStart, 7))}><CaretRight size={20} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!isCurrent && <Button variant="primary" onClick={() => go(weekStartOf(today))}>Aktuální týden</Button>}
        {plan.activation && plan.activation.mapping.length > 1 && (
          <select aria-label="Přejít na týden plánu" className="min-h-11 rounded-[8px] border border-line bg-surface px-2 text-[14px]" value={mapping ? weekStart : ''} onChange={(e) => e.target.value && go(e.target.value)}>
            <option value="">Týden plánu…</option>
            {plan.activation.mapping.map((m) => <option key={m.weekStart} value={m.weekStart}>{m.sourceWeek != null ? `Týden ${m.sourceWeek}` : 'Pauza'} · {formatDay(m.weekStart)}</option>)}
          </select>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setMenu(true)}>Možnosti</Button>
      </div>

      {/* Proužek dnů: barva = zátěž, tečka = odběháno. Ťuknutím otevřeš den. */}
      <div key={`strip-${weekStart}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="grid touch-pan-y grid-cols-7 gap-1.5">
        {dates.map((d, i) => {
          const w = dayWorkouts(plan.workouts, d).find((x) => x.workout.type !== 'rest');
          const ran = weekActs.some((a) => a.localDate === d) || weekStrava.some((r) => r.localDate === d) || w?.status === 'completed';
          return (
            <button key={d} type="button" disabled={!w} onClick={() => w && setOpen(w)} aria-label={`${formatDay(d, { weekday: true })}${w ? `: ${w.workout.title}` : ': volno'}${ran ? ', odběháno' : ''}`} className={cx('relative flex min-h-[4.5rem] flex-col items-center justify-center rounded-[14px] transition-transform active:scale-95', d === today ? 'bg-ink text-white' : 'bg-surface border border-line', !w && d !== today && 'border-dashed bg-transparent')}>
              <span className={cx('label text-[11px]', d === today ? 'text-volt' : 'text-muted')}>{DOW_SHORT[i]}</span>
              <span className="display text-[22px]">{Number(d.slice(8))}</span>
              <span className={cx('mt-0.5 h-1.5 w-6 rounded-full', w ? LOAD_DOT[w.workout.load ?? 'low'] : 'bg-transparent', w?.status === 'skipped' && 'opacity-30')} />
              {ran && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-done ring-2 ring-surface" />}
            </button>
          );
        })}
      </div>

      <div className="rounded-[20px] border border-line bg-surface p-4">
        <div className="flex items-end justify-between gap-3">
          <p><span className="display text-[34px]">{String(Math.round(doneM / 100) / 10).replace('.', ',')}</span><span className="display text-[20px] text-muted"> / {String(Math.round(planned.totalM / 100) / 10).replace('.', ',')} km</span></p>
          <p className="label text-muted">{planned.unknown ? `+ ${planned.unknown}× dle času` : 'odběháno / plán'}</p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-load-low transition-[width] duration-300" style={{ width: `${planned.totalM > 0 ? Math.min(100, (doneM / planned.totalM) * 100) : 0}%` }} />
        </div>
      </div>

      <ul key={weekStart} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className={`touch-pan-y space-y-2 ${slide === 'next' ? 'week-in-next' : slide === 'prev' ? 'week-in-prev' : ''}`}>
        {dates.map((d) => {
          const ws = dayWorkouts(plan.workouts, d);
          const dayActs = weekActs.filter((a) => a.localDate === d);
          return (
            <li key={d} className="space-y-1">
              {ws.map((w) => <WorkoutRow key={w.id} w={w} today={today} onOpen={() => setOpen(w)} />)}
              {ws.length === 0 && (
                <button type="button" onClick={() => plan.activation && setAddDay(d)} disabled={!plan.activation} className="flex min-h-12 w-full items-center gap-3 rounded-[12px] border border-dashed border-line px-3 text-left text-muted">
                  <span className="w-9 text-center text-[13px]">{formatDay(d)}</span>
                  <span className="text-[14px]">{plan.activation ? 'Přidat jednotku' : 'nic'}</span>
                </button>
              )}
              {weekStrava.filter((r) => r.localDate === d).map((r) => (
                <div key={r.id} className="ml-12"><StravaRun run={r} planned={ws.find((w) => w.workout.type !== 'rest')} compact /></div>
              ))}
              {dayActs.map((a) => (
                <button key={a.id} type="button" onClick={() => setActivityId(a.id)} className="num ml-12 flex min-h-11 w-[calc(100%-3rem)] items-center justify-between rounded-[12px] bg-accent-soft px-3 text-left text-[14px] font-medium text-text">
                  <span>Odběháno {formatKm(a.distanceM, 1)}</span>
                  <span>{acts.matches.some((m) => m.activityId === a.id) ? 'spárováno' : 'nespárováno'}</span>
                </button>
              ))}
            </li>
          );
        })}
      </ul>

      {strava.connection && (sync.error || sync.syncing || weekStrava.length > 0) && (
        <p className="text-[13px] text-muted">{sync.error ?? (sync.syncing ? 'Načítám běhy ze Stravy…' : 'Powered by Strava')}</p>
      )}

      {templateWeek?.note && (
        <details className="rounded-[12px] border border-line bg-surface px-4">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">Poznámka autora plánu k týdnu</summary>
          <p className="pb-3 text-[15px] text-muted">{templateWeek.note}</p>
        </details>
      )}

      {openDrafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="display text-[24px]">Rozpracované návrhy</h2>
          {openDrafts.map((d) => <DraftCard key={d.id} draftId={d.id} compact />)}
        </section>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Možnosti plánu">
        <div className="space-y-2">
          {range && <p className="num text-[14px] text-muted">{plan.template?.name} · {formatDay(range.first, { year: true })} – {formatDay(range.last, { year: true })}{plan.activation!.skippedSourceWeeks.length ? ` · přeskočené týdny: ${[...plan.activation!.skippedSourceWeeks].sort((a, b) => a - b).join(', ')}` : ''}</p>}
          <Button className="w-full" onClick={() => { setMenu(false); setAdding(true); }}>Přidat aktivitu</Button>
          {mapping && weekStart >= weekStartOf(today) && (
            <>
              <Button className="w-full" onClick={async () => { setMenu(false); await runWithUndo({ operation: 'REMAP_PLAN', payload: { mode: 'pause_week', weekStart }, reason: 'Pauza' }); }}>Vložit sem týden pauzy</Button>
              {mapping.sourceWeek != null && <Button className="w-full" onClick={async () => { setMenu(false); await runWithUndo({ operation: 'REMAP_PLAN', payload: { mode: 'skip_week', weekStart }, reason: 'Přeskočení týdne' }); }}>Přeskočit tento týden plánu</Button>}
            </>
          )}
          <div className="border-t border-line pt-2">
            <p className="mb-2 text-[13px] font-medium text-muted">Nový plán</p>
            {setup}
          </div>
          {templates.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="mb-2 text-[13px] font-medium text-muted">Ověřené plány</p>
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => { setMenu(false); setToActivate(t); }} className="flex min-h-11 w-full items-center justify-between rounded-[8px] px-2 text-left hover:bg-surface-2">
                  <span>{t.name}</span>
                  {plan.activation?.templateId === t.id ? <Chip tone="accent">aktivní</Chip> : <span className="text-[13px] text-muted">zařadit</span>}
                </button>
              ))}
            </div>
          )}
          {plan.activation && <Button variant="danger" className="w-full" onClick={async () => { await archiveActivePlan(); setMenu(false); toast('Plán je archivovaný. Historie zůstává k prohlížení.'); }}>Ukončit a archivovat plán</Button>}
        </div>
      </Sheet>

      <Sheet
        open={addDay != null}
        onClose={() => setAddDay(null)}
        title={addDay ? `Přidat jednotku: ${formatDay(addDay, { weekday: true })}` : ''}
        footer={<Button variant="primary" className="flex-1" disabled={!isValidSpec(newSpec)} onClick={async () => { if (await runWithUndo({ operation: 'ADD_WORKOUT', payload: { date: addDay, workout: newSpec }, reason: 'Ruční přidání' })) setAddDay(null); }}>Přidat</Button>}
      >
        <WorkoutEditor value={newSpec} onChange={(w) => setNewSpec(w as typeof newSpec)} />
      </Sheet>

      <WorkoutSheet workout={open} onClose={() => setOpen(null)} chart={chart} today={today} />
      <ActivitySheet activityId={activityId} onClose={() => setActivityId(null)} chart={chart} />
      <AddActivitySheet open={adding} onClose={() => setAdding(false)} onAdded={(a) => setActivityId(a.id)} />
      {sheets}
    </div>
  );
}
