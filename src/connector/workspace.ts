// Prostor jednoho uživatele konektoru: jeden JSON dokument v úložišti.
// Neobsahuje žádná data aktivit ze Stravy; jen plán, rozpis, stav splnění a vlastní poznámky.
import type { AthleteProfile, IsoDate, PaceChart, PlanActivation, PlanTemplate, ScheduledWorkout, ScheduleRevision, TemplateWeek } from '../domain/types';

export interface WorkoutNote {
  workoutId: string;
  date: IsoDate;
  /** 1 = hodně těžké … 5 = výborné */
  feel?: 1 | 2 | 3 | 4 | 5;
  pain?: 'none' | 'mild' | 'significant';
  note?: string;
  at: string;
}

/** Revize rozpisu rozšířená o zápis uživatele, aby undo vracelo stav i zápis najednou. */
export type ConnectorRevision = ScheduleRevision & {
  note?: { workoutId: string; before: WorkoutNote | null; after: WorkoutNote | null };
};

/** Rozpracovaný import: týdny se posílají po částech a plán vznikne až při aktivaci. */
export interface StagedImport {
  name: string;
  units: 'km' | 'mi';
  paceChart?: PaceChart;
  weeks: TemplateWeek[];
  updatedAt: string;
}

export interface Workspace {
  format: 'run-tracker-connector';
  version: 1;
  profile: AthleteProfile;
  templates: PlanTemplate[];
  activations: PlanActivation[];
  workouts: ScheduledWorkout[];
  revisions: ConnectorRevision[];
  notes: WorkoutNote[];
  staged?: StagedImport;
}

export const MAX_REVISIONS = 200;

export function emptyWorkspace(): Workspace {
  return {
    format: 'run-tracker-connector',
    version: 1,
    profile: { id: 'me', locale: 'cs', units: 'km', timezone: 'Europe/Prague', restDows: [], longRunDow: 6 },
    templates: [],
    activations: [],
    workouts: [],
    revisions: [],
    notes: [],
  };
}

export function isWorkspace(value: unknown): value is Workspace {
  const v = value as Partial<Workspace> | null;
  return !!v && v.format === 'run-tracker-connector' && v.version === 1 && Array.isArray(v.workouts) && Array.isArray(v.activations) && Array.isArray(v.templates) && Array.isArray(v.revisions) && Array.isArray(v.notes) && !!v.profile;
}
