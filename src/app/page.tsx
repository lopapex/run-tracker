'use client';

import Link from 'next/link';
import { useState } from 'react';
import { addDays, formatDay } from '@/domain/dates';
import { formatDuration, formatKm, formatPace, paceOf } from '@/domain/format';
import { dayWorkouts, progressWeek } from '@/domain/schedule';
import type { ScheduledWorkout } from '@/domain/types';
import { ActivitySheet, AddActivitySheet } from '@/ui/Activity';
import { useActivities, usePlan, useProfile, useToday } from '@/ui/hooks';
import { Button, Card, Chip, EmptyState } from '@/ui/primitives';
import { StravaCard, StravaRun, useStrava, useStravaSync } from '@/ui/Strava';
import { LoadBadge, StatusMark, WorkoutBody, WorkoutRow, WorkoutSheet } from '@/ui/Workout';

/** Dnes (§4.1): dnešní jednotka, jedna hlavní akce, poslední běh, další tři dny. */
export default function TodayPage() {
  const profile = useProfile();
  const today = useToday(profile);
  const plan = usePlan();
  const acts = useActivities();
  const [open, setOpen] = useState<ScheduledWorkout | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const strava = useStrava();
  const sync = useStravaSync(Boolean(strava?.connection), addDays(today, -13), today);

  if (!plan || !acts || !profile || !strava) return null;
  const chart = profile.paceChart ?? plan.template?.paceChart;
  const todays = dayWorkouts(plan.workouts, today);
  const main = todays.find((w) => w.workout.type !== 'rest') ?? todays[0];
  const next = [1, 2, 3].flatMap((i) => dayWorkouts(plan.workouts, addDays(today, i)));
  const last = acts.activities[0];
  const lastCheckIn = last ? acts.checkIns.find((c) => c.activityId === last.id) : undefined;
  const mapping = plan.activation ? progressWeek(plan.activation, today) : undefined;
  const todayActivity = acts.activities.find((a) => a.localDate === today);
  const todayRuns = strava.runs.filter((r) => r.localDate === today);
  const lastStrava = strava.runs.find((r) => r.localDate < today);
  const stravaIsLast = lastStrava != null && (!last || lastStrava.localDate >= last.localDate);
  const plannedOn = (d: string) => dayWorkouts(plan.workouts, d).find((w) => w.workout.type !== 'rest');

  return (
    <div className="space-y-4">
      <p className="text-muted">{formatDay(today, { weekday: true })}{mapping ? (mapping.sourceWeek != null ? ` · týden ${mapping.sourceWeek} plánu` : ' · pauza') : ''}</p>

      {!plan.activation ? (
        <EmptyState title="Zatím nemáš plán">
          <p>Naimportuj ho z PDF, zapiš si týden ručně, nebo si nech navrhnout nový.</p>
          <Link href="/plan/" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-accent px-4 font-semibold text-accent-ink">Založit plán</Link>
        </EmptyState>
      ) : main ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-[20px] font-semibold">{main.workout.title}</h2>
            <StatusMark w={main} />
            <LoadBadge load={main.workout.load} />
          </div>
          {main.workout.type === 'rest' ? <p className="text-muted">Dnes je volno. Odpočinek je součást tréninku.</p> : <WorkoutBody workout={main.workout} chart={chart} />}
          {main.date !== main.originDate && <Chip tone="warn">přesunuto z {formatDay(main.originDate, { weekday: true })}</Chip>}
          {todayRuns.map((r) => <StravaRun key={r.id} run={r} planned={main} compact />)}
          <div className="flex gap-2">
            {todayRuns.length > 0 ? null : main.status === 'scheduled' && main.workout.type !== 'rest' ? (
              <Button variant="primary" className="flex-1" onClick={() => setAdding(true)}>Mám odběháno</Button>
            ) : todayActivity && !acts.checkIns.some((c) => c.activityId === todayActivity.id) ? (
              <Button variant="primary" className="flex-1" onClick={() => setActivityId(todayActivity.id)}>Jaké to bylo?</Button>
            ) : null}
            <Button className="flex-1" onClick={() => setOpen(main)}>Detail a změny</Button>
          </div>
        </Card>
      ) : (
        <Card><p className="text-muted">Na dnešek plán nic nemá. {mapping ? '' : 'Dnešek je mimo rozsah plánu.'}</p></Card>
      )}

      {(!plan.activation || !main) && todayRuns.map((r) => <StravaRun key={r.id} run={r} />)}
      <StravaCard view={strava} syncing={sync.syncing} error={sync.error} onRefresh={sync.refresh} />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Poslední běh</h2>
          <button type="button" className="min-h-11 px-1 font-medium text-accent underline" onClick={() => setAdding(true)}>Přidat aktivitu</button>
        </div>
        {stravaIsLast ? (
          <div className="space-y-1">
            <p className="text-[13px] text-muted">{formatDay(lastStrava.localDate, { weekday: true })}</p>
            <StravaRun run={lastStrava} planned={plannedOn(lastStrava.localDate)} />
          </div>
        ) : last ? (
          <button type="button" onClick={() => setActivityId(last.id)} className="w-full rounded-[16px] border border-line bg-surface p-4 text-left">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{last.name}</span>
              <span className="text-[13px] text-muted">{formatDay(last.localDate, { weekday: true })}</span>
            </span>
            <span className="num mt-1 block text-[15px] text-muted">{formatKm(last.distanceM, 2)} · {formatDuration(last.movingSec)} · {formatPace(paceOf(last.distanceM, last.movingSec))}/km{last.avgHr ? ` · tep ${last.avgHr}` : ''}</span>
            {!lastCheckIn && <span className="mt-2 inline-block text-[14px] font-medium text-accent">Doplnit pocit z běhu</span>}
          </button>
        ) : todayRuns.length > 0 ? null : (
          <Card><p className="text-[15px] text-muted">Zatím tu není žádný běh. Propoj Stravu, nahraj soubor z hodinek, nebo běh zapiš ručně.</p></Card>
        )}
      </section>

      {next.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Další dny</h2>
          {next.map((w) => <WorkoutRow key={w.id} w={w} today={today} onOpen={() => setOpen(w)} />)}
        </section>
      )}

      <WorkoutSheet workout={open} onClose={() => setOpen(null)} chart={chart} today={today} />
      <ActivitySheet activityId={activityId} onClose={() => setActivityId(null)} chart={chart} />
      <AddActivitySheet open={adding} onClose={() => setAdding(false)} onAdded={(a) => setActivityId(a.id)} />
    </div>
  );
}
