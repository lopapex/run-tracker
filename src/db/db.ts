import Dexie, { type Table } from 'dexie';
import type { StravaActivity, StravaConnection } from '@/strava/types';
import type {
  Activity,
  AiUsageEvent,
  AthleteProfile,
  AuditEvent,
  CheckIn,
  CoachMessage,
  PlanActivation,
  PlanDocument,
  PlanDraft,
  PlanDraftRevision,
  PlanTemplate,
  ScheduledWorkout,
  ScheduleRevision,
  WorkoutMatch,
} from '@/domain/types';

/** Lokální úložiště (§12). Do M5 je jediným zdrojem pravdy; vše patří jednomu hostovskému workspace. */
export class RunDb extends Dexie {
  profile!: Table<AthleteProfile, string>;
  documents!: Table<PlanDocument, string>;
  templates!: Table<PlanTemplate, string>;
  activations!: Table<PlanActivation, string>;
  workouts!: Table<ScheduledWorkout, string>;
  revisions!: Table<ScheduleRevision, string>;
  drafts!: Table<PlanDraft, string>;
  draftRevisions!: Table<PlanDraftRevision, string>;
  activities!: Table<Activity, string>;
  matches!: Table<WorkoutMatch, string>;
  checkIns!: Table<CheckIn, string>;
  messages!: Table<CoachMessage, string>;
  usage!: Table<AiUsageEvent, string>;
  audit!: Table<AuditEvent, string>;
  connections!: Table<StravaConnection, string>;
  stravaActivities!: Table<StravaActivity, number>;
  syncMeta!: Table<{id: 'cloud'; remoteVersion: number; baseHash: string; at: string}, string>;

  constructor(name = 'run-tracker') {
    super(name);
    this.version(1).stores({
      profile: 'id',
      documents: 'id, checksum',
      templates: 'id, createdAt',
      activations: 'id, status, templateId',
      workouts: 'id, activationId, date, [activationId+date]',
      revisions: 'id, activationId, [activationId+seq]',
      drafts: 'id, status, createdAt',
      draftRevisions: 'id, draftId, [draftId+seq]',
      activities: 'id, localDate, checksum',
      matches: 'id, activityId, workoutId',
      checkIns: 'id, date, activityId, workoutId',
      messages: 'id, [threadId+seq]',
      usage: 'requestId, startedAt',
      audit: 'id, at',
    });
    // Data ze Stravy jsou oddělená dočasná cache s expirací (§10.1), ne součást trvalého archivu.
    this.version(2).stores({ connections: 'id', stravaActivities: 'id, localDate, expiresAt' });
    this.version(3).stores({ syncMeta: 'id' });
  }
}

let instance: RunDb | undefined;
let workspace = 'run-tracker';
export function configureWorkspace(userId: string | null): void {
  const name = userId ? `run-tracker-user-${userId}` : 'run-tracker';
  if (workspace !== name) { instance?.close(); instance = undefined; workspace = name; }
}
export function db(): RunDb {
  instance ??= new RunDb(workspace);
  return instance;
}
export function sessionKey(name: string): string { return `rt:${workspace}:${name}`; }

export const ALL_TABLES = [
  'profile', 'documents', 'templates', 'activations', 'workouts', 'revisions', 'drafts',
  'draftRevisions', 'activities', 'matches', 'checkIns', 'messages', 'usage', 'audit', 'connections', 'stravaActivities', 'syncMeta',
] as const;
