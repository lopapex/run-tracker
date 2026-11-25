// Prostor jednoho uživatele konektoru: jeden JSON dokument v úložišti.
// Neobsahuje žádná data aktivit ze Stravy; jen plán, rozpis, stav splnění a vlastní poznámky.
import type { AthleteProfile, IsoDate, PaceChart, PaceTableRow, PlanActivation, PlanTemplate, ScheduledWorkout, ScheduleRevision, TemplateWeek } from '../domain/types';

export const CONDITIONS = {
  cold: 'zima', heat: 'horko', wind: 'vítr', rain: 'déšť', hills: 'kopce', poor_sleep: 'špatný spánek', alcohol: 'alkohol den předem',
  dehydrated: 'málo tekutin', tired: 'únava', sick: 'nemoc', stress: 'stres', sore: 'bolavé nohy',
} as const;
export type Condition = keyof typeof CONDITIONS;

export interface WorkoutNote {
  workoutId: string;
  date: IsoDate;
  /** 1 = hodně těžké … 5 = výborné */
  feel?: 1 | 2 | 3 | 4 | 5;
  pain?: 'none' | 'mild' | 'significant';
  /** Okolnosti běhu (počasí, spánek, alkohol…), které vysvětlují odchylku od plánu. */
  conditions?: Condition[];
  note?: string;
  /** Odhad výkonnosti (VDOT) z hodnoceného běhu. Jediné číslo odvozené z běhu, které se ukládá; data běhu ne. */
  vdot?: number;
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
  paceTable?: PaceTableRow[];
  weeks: TemplateWeek[];
  updatedAt: string;
  /** Jak plán zařadit, když ho postavil generátor (závod, nebo začátek); appka to nabídne jedním klepnutím. */
  activate?: { mode: 'start' | 'race'; date: string };
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

/** Verze zápisu, kterou appka viděla: stav a čas posledního zápisu. Appka ji posílá s uložením,
 *  aby starší obrazovka téhož běhu nepřepsala novější zápis. */
export const checkinVersion = (status: string, note?: { at: string } | null) => `${status}|${note?.at ?? ''}`;

/** Signál únavy z posledních zápisů: dva ze tří posledních běhů těžké nebo s bolestí, nebo výrazná bolest v posledním týdnu.
 *  Je to podnět k rozhovoru, ne diagnóza; rozpis se sám nemění. */
export function fatigueOf(notes: WorkoutNote[], today: IsoDate): { kind: 'pain' | 'tired'; text: string } | null {
  const from = new Date(Date.parse(today + 'T00:00:00Z') - 10 * 86_400_000).toISOString().slice(0, 10);
  const recent = notes.filter((n) => n.date <= today && n.date >= from && (n.feel != null || n.pain != null)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86_400_000).toISOString().slice(0, 10);
  if (recent.some((n) => n.pain === 'significant' && n.date >= weekAgo)) return { kind: 'pain', text: 'V posledním týdnu výrazná bolest.' };
  const hurt = recent.filter((n) => n.pain === 'mild' || n.pain === 'significant').length;
  const hard = recent.filter((n) => n.feel != null && n.feel <= 2).length;
  if (hurt >= 2) return { kind: 'pain', text: `Bolest při ${hurt} z posledních ${recent.length} běhů.` };
  if (hard + hurt >= 2) return { kind: 'tired', text: `${hard + hurt} z posledních ${recent.length} běhů byly těžké nebo bolely.` };
  return null;
}

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
