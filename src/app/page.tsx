'use client';

import { ArrowRight, CheckCircle, Lightning, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { addDays, DOW_LONG, dowOf, formatDay, weekDates, weekStartOf } from '@/domain/dates';
import { blockLines, formatDuration, formatPace, LOAD_LABEL, paceOf, formatDistanceRange, resolvePaceChart } from '@/domain/format';
import { plannedDistance, projectedDistance, sameRun } from '@/domain/distance';
import { dayWorkouts, progressWeek } from '@/domain/schedule';
import type { ScheduledWorkout } from '@/domain/types';
import { ActivitySheet, AddActivitySheet } from '@/ui/Activity';
import { useActivities, usePlan, useProfile, useToday } from '@/ui/hooks';
import { cx } from '@/ui/primitives';
import { StravaCard, StravaRun, useStrava, useStravaSync } from '@/ui/Strava';
import { LOAD_DOT, WorkoutRow, WorkoutSheet } from '@/ui/Workout';

const km = (m: number) => String(Math.round(m / 100) / 10).replace('.', ',');

/** Dnes (§4.1): dnešní jednotka jako startovní číslo, jedna hlavní akce, týden na dosah, poslední běh. */
export default function TodayPage() {
  const profile = useProfile();
  const today = useToday(profile);
  const plan = usePlan();
  const acts = useActivities();
  const strava = useStrava();
  const sync = useStravaSync(Boolean(strava?.connection), addDays(today, -13), today);
  const [open, setOpen] = useState<ScheduledWorkout | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!plan || !acts || !profile || !strava) return null;
  const chart = resolvePaceChart(profile, plan.template?.paceChart);
  const todays = dayWorkouts(plan.workouts, today);
  const main = todays.find((w) => w.workout.type !== 'rest') ?? todays[0];
  const isRest = main?.workout.type === 'rest';
  const next = [1, 2, 3].flatMap((i) => dayWorkouts(plan.workouts, addDays(today, i)));
  const mapping = plan.activation ? progressWeek(plan.activation, today) : undefined;
  const plannedOn = (d: string) => dayWorkouts(plan.workouts, d).find((w) => w.workout.type !== 'rest');

  const todayRuns = strava.runs.filter((r) => r.localDate === today);
  const todayActivity = acts.activities.find((a) => a.localDate === today);
  const doneToday = todayRuns.length > 0 || todayActivity != null || main?.status === 'completed';
  const last = acts.activities[0];
  const lastStrava = strava.runs.find((r) => r.localDate < today);
  const stravaIsLast = lastStrava != null && (!last || lastStrava.localDate >= last.localDate);

  // Týden na dosah: plán proti odběhanému, bez dvojího počítání téhož běhu.
  const ws = weekStartOf(today);
  const dates = weekDates(ws);
  const weekActs = acts.activities.filter((a) => a.localDate >= ws && a.localDate <= dates[6] && a.sport === 'run');
  const weekStrava = strava.runs.filter((r) => r.localDate >= ws && r.localDate <= dates[6] && !weekActs.some((a) => sameRun(a,r)));
  const weekDone = weekActs.reduce((s, a) => s + a.distanceM, 0) + weekStrava.reduce((s, r) => s + r.distanceM, 0);
  const weekWorkouts = dates.flatMap(d => dayWorkouts(plan.workouts, d));
  const estimate = plannedDistance(weekWorkouts.filter(w => w.status !== 'skipped').map(w => w.workout), chart);
  const meanEstimate = (estimate.minM + estimate.maxM) / 2;
  const ratio = meanEstimate > 0 ? Math.min(1, weekDone / meanEstimate) : 0;
  const projection = projectedDistance(weekWorkouts, [...weekActs, ...weekStrava], chart);

  return (
    <div className="space-y-5">
      {/* Startovní číslo dne */}
      <section className="bib lanes px-5 pb-5 pt-8">
        <p className="label text-volt">
          {DOW_LONG[dowOf(today)]} {formatDay(today)}
          {mapping ? (mapping.sourceWeek != null ? ` · týden ${mapping.sourceWeek}` : ' · pauza') : ''}
        </p>
        {!plan.activation ? (
          <>
            <h2 className="display mt-2 text-[44px]">Postav si plán</h2>
            <p className="bib-muted mt-2 text-[15px]">Naimportuj ho z PDF, zapiš týden ručně, nebo si nech navrhnout nový.</p>
            <Link href="/plan/" className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-volt px-5 font-semibold text-ink active:scale-[0.97]">Založit plán <ArrowRight size={18} weight="bold" /></Link>
          </>
        ) : !main ? (
          <>
            <h2 className="display mt-2 text-[44px]">Dnes nic v plánu</h2>
            <p className="bib-muted mt-2 text-[15px]">Dnešek je mimo rozsah plánu. Běh si můžeš zapsat i tak.</p>
          </>
        ) : isRest ? (
          <>
            <h2 className="display mt-2 text-[52px]">Volno</h2>
            <p className="bib-muted mt-2 text-[15px]">Nohy nahoru. Odpočinek je součást tréninku.</p>
          </>
        ) : (
          <>
            <div className="mt-2 flex items-end justify-between gap-3">
              <h2 className="display text-[40px]">{main.workout.title}</h2>
              {main.workout.distanceM != null && (
                <p className="shrink-0 text-right">
                  <span className="display block text-[64px] text-volt">{km(main.workout.distanceM)}</span>
                  <span className="label bib-muted -mt-1 block">km</span>
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              {main.workout.load && (
                <span className="bib-chip inline-flex items-center gap-1.5 px-2.5 py-1">
                  <span className={cx('size-2 rounded-full', LOAD_DOT[main.workout.load])} />
                  {LOAD_LABEL[main.workout.load]}
                </span>
              )}
              {main.workout.durationSec != null && main.workout.distanceM == null && <span className="bib-chip px-2.5 py-1">{formatDuration(main.workout.durationSec)}</span>}
              {main.workout.strengthMin && <span className="bib-chip px-2.5 py-1">+ posilování {main.workout.strengthMin} min</span>}
              {main.date !== main.originDate && <span className="bib-chip px-2.5 py-1">přesunuto z {formatDay(main.originDate, { weekday: true })}</span>}
              {main.status === 'skipped' && <span className="bib-chip px-2.5 py-1">vynecháno</span>}
            </div>
            {main.workout.blocks.length > 0 && (
              <ol className="num mt-3 space-y-1 text-[15px]">
                {blockLines(main.workout.blocks, chart).map((l, i) => (
                  <li key={i} className="flex gap-2"><span className="label w-5 shrink-0 pt-0.5 text-volt">{i + 1}</span><span>{l}</span></li>
                ))}
              </ol>
            )}
          </>
        )}

        {doneToday && main && !isRest && <p className="stamp pop mt-4 text-volt"><CheckCircle size={16} weight="fill" /> Odběháno</p>}

        {plan.activation && (
          <div className="mt-5 flex gap-2">
            {main && !isRest && !doneToday && main.status === 'scheduled' && (
              <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-volt px-4 font-semibold text-ink active:scale-[0.97]">
                <Lightning size={18} weight="fill" /> Mám odběháno
              </button>
            )}
            {todayActivity && !acts.checkIns.some((c) => c.activityId === todayActivity.id) && (
              <button type="button" onClick={() => setActivityId(todayActivity.id)} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-volt px-4 font-semibold text-ink active:scale-[0.97]">Jaké to bylo?</button>
            )}
            {main ? (
              <button type="button" onClick={() => setOpen(main)} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-white/25 px-4 font-medium text-white active:scale-[0.97]">Detail a změny</button>
            ) : (
              <Link href="/plan/" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-white/25 px-4 font-medium text-white active:scale-[0.97]">Otevřít plán</Link>
            )}
          </div>
        )}
      </section>

      {todayRuns.map((r) => <StravaRun key={r.id} run={r} planned={main} />)}

      {/* Týden */}
      {plan.activation && (estimate.maxM > 0 || estimate.unknown > 0) && (
        <Link href="/plan/" className="block rounded-[20px] border border-line bg-surface p-4 active:scale-[0.99]">
          <div className="flex items-end justify-between">
            <p className="label text-muted">Tento týden</p>
            <p className="num text-[13px] text-muted">{Math.round(ratio * 100)} %</p>
          </div>
          <p className="mt-1"><span className="display text-[38px]">{km(weekDone)}</span><span className="display text-[22px] text-muted"> km odběháno</span></p>
          <p className="num text-[14px] text-muted">Předpis {formatDistanceRange(estimate)} · výhled {formatDistanceRange(projection)}</p>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Odběháno z týdenního plánu">
            <div className="h-full rounded-full bg-load-low transition-[width] duration-300" style={{ width: `${ratio * 100}%` }} />
          </div>
        </Link>
      )}

      <StravaCard view={strava} syncing={sync.syncing} error={sync.error} onRefresh={sync.refresh} />

      {/* Poslední běh */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="display text-[24px]">Poslední běh</h2>
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-semibold active:scale-[0.97]" onClick={() => setAdding(true)}><Plus size={16} weight="bold" /> Přidat</button>
        </div>
        {stravaIsLast ? (
          <div className="space-y-1">
            <p className="label text-muted">{formatDay(lastStrava.localDate, { weekday: true })}</p>
            <StravaRun run={lastStrava} planned={plannedOn(lastStrava.localDate)} />
          </div>
        ) : last ? (
          <button type="button" onClick={() => setActivityId(last.id)} className="w-full rounded-[20px] border border-line bg-surface p-4 text-left active:scale-[0.99]">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{last.name}</span>
              <span className="label text-muted">{formatDay(last.localDate, { weekday: true })}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-4">
              <span><span className="display text-[34px]">{km(last.distanceM)}</span> <span className="label text-muted">km</span></span>
              <span><span className="display text-[34px]">{formatPace(paceOf(last.distanceM, last.movingSec))}</span> <span className="label text-muted">/km</span></span>
              <span className="num text-[14px] text-muted">{formatDuration(last.movingSec)}{last.avgHr ? ` · tep ${last.avgHr}` : ''}</span>
            </span>
            {!acts.checkIns.some((c) => c.activityId === last.id) && <span className="mt-2 inline-block text-[14px] font-semibold underline underline-offset-2">Doplnit pocit z běhu</span>}
          </button>
        ) : todayRuns.length > 0 ? null : (
          <p className="rounded-[20px] border border-dashed border-line px-4 py-5 text-center text-[15px] text-muted">Zatím žádný běh. První kilometry přidáš tlačítkem nahoře{strava.connection ? '' : ' nebo propojením Stravy'}.</p>
        )}
      </section>

      {next.length > 0 && (
        <section className="space-y-2">
          <div className="lane-rule" aria-hidden />
          <h2 className="display text-[24px]">Další dny</h2>
          {next.map((w) => <WorkoutRow key={w.id} w={w} today={today} onOpen={() => setOpen(w)} />)}
        </section>
      )}

      <WorkoutSheet workout={open} onClose={() => setOpen(null)} chart={chart} today={today} />
      <ActivitySheet activityId={activityId} onClose={() => setActivityId(null)} chart={chart} />
      <AddActivitySheet open={adding} onClose={() => setAdding(false)} onAdded={(a) => setActivityId(a.id)} />
    </div>
  );
}
