'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { DEFAULT_PROFILE, runScheduleCommand, undoRevision } from '@/db/repo';
import { todayIso } from '@/domain/dates';
import type { Activity, AthleteProfile, CheckIn, PlanActivation, PlanTemplate, ScheduledWorkout, WorkoutMatch } from '@/domain/types';
import { toast } from './primitives';

/** `undefined` = ještě se načítá. */
export function useProfile(): AthleteProfile | undefined {
  return useLiveQuery(async () => (await db().profile.get('me')) ?? DEFAULT_PROFILE, []);
}

export function useToday(profile: AthleteProfile | undefined): string {
  const [today, setToday] = useState(() => todayIso(profile?.timezone));
  useEffect(() => {
    const tick = () => setToday(todayIso(profile?.timezone));
    tick();
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [profile?.timezone]);
  return today;
}

export interface PlanView {
  activation: PlanActivation | null;
  template: PlanTemplate | null;
  /** Jednotky aktivního plánu a archivovaných plánů do dne jejich ukončení. */
  workouts: ScheduledWorkout[];
  archived: PlanActivation[];
}

export function usePlan(): PlanView | undefined {
  return useLiveQuery(async () => {
    const activations = await db().activations.toArray();
    const activation = activations.find((a) => a.status === 'active') ?? null;
    const archived = activations.filter((a) => a.status === 'archived');
    const workouts: ScheduledWorkout[] = [];
    for (const a of activations) {
      const ws = await db().workouts.where('activationId').equals(a.id).toArray();
      workouts.push(...(a.status === 'active' ? ws : ws.filter((w) => a.endedOn != null && w.date <= a.endedOn)));
    }
    const template = activation ? ((await db().templates.get(activation.templateId)) ?? null) : null;
    return { activation, template, workouts, archived };
  }, []);
}

export interface ActivityView {
  activities: Activity[];
  matches: WorkoutMatch[];
  checkIns: CheckIn[];
}

export function useActivities(): ActivityView | undefined {
  return useLiveQuery(async () => ({
    activities: await db().activities.orderBy('localDate').reverse().toArray(),
    matches: await db().matches.toArray(),
    checkIns: await db().checkIns.toArray(),
  }), []);
}

/** Přímá ruční úprava: provést hned a nabídnout vrácení (INV-05). */
export async function runWithUndo(command: { operation: string; payload: unknown; reason?: string }): Promise<boolean> {
  const r = await runScheduleCommand(command, 'user');
  if (!r.ok) {
    toast(r.message, { tone: 'error' });
    return false;
  }
  const text = [...r.summary, ...r.warnings].join(' ');
  toast(text, {
    action: {
      label: 'Vrátit',
      run: async () => {
        const u = await undoRevision(r.revision.id);
        toast(u.ok ? 'Změna vrácena.' : u.message, { tone: u.ok ? 'info' : 'error' });
      },
    },
  });
  return true;
}
