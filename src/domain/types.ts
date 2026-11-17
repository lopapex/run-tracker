// Logický datový model (§12). Platí pro IndexedDB i pozdější serverové tabulky.
// Interně: metry, sekundy, tempo v s/km (§6.3).

export type Id = string;
/** Kalendářní den `YYYY-MM-DD` v časové zóně uživatele. */
export type IsoDate = string;
/** 0 = pondělí … 6 = neděle. */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Provenance =
  | 'USER_ENTERED'
  | 'USER_FILE_UPLOAD'
  | 'PLAN_DOCUMENT'
  | 'STRAVA_API_RESTRICTED'
  | 'DERIVED_DETERMINISTIC'
  | 'AI_GENERATED';

// ---------- Jednotka ----------

export type IntensityRef =
  | 'easy'
  | 'steady'
  | 'mp'
  | 'hm_pace'
  | '10k_pace'
  | '5k_pace'
  | 'strides'
  | 'walk'
  | 'free';

export interface Segment {
  role: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'steady';
  durationSec?: number;
  distanceM?: number;
  intensity: IntensityRef;
  note?: string;
}

export type Block =
  | ({ kind: 'segment' } & Segment)
  | {
      kind: 'repeat';
      count: number;
      work: Segment;
      /** Další rychlé úseky téhož opakování, v pořadí za `work`. */
      more?: Segment[];
      recovery?: Segment;
      /** null = dokument to neříká; parser nesmí hádat (§6.3). */
      recoveryAfterLast: boolean | null;
    }
  | { kind: 'strides'; count: number; durationSec: number }
  | { kind: 'note'; text: string };

export type WorkoutType = 'easy' | 'long' | 'speed' | 'tempo' | 'race' | 'rest' | 'strength' | 'cross' | 'other';
export type Load = 'rest' | 'low' | 'medium' | 'high';

export interface WorkoutSpec {
  type: WorkoutType;
  title: string;
  distanceM?: number;
  durationSec?: number;
  load?: Load;
  blocks: Block[];
  /** Doplňkové posilování ve stejný den, minuty. */
  strengthMin?: number;
  /** Původní znění, pokud se význam nepodařilo plně strukturovat. */
  rawInstruction?: string;
  note?: string;
}

export interface SourceRef {
  method: 'ocr' | 'pdf_text' | 'manual' | 'generated';
  page?: number;
  /** x, y, šířka, výška v pixelech vykreslené stránky. */
  bbox?: [number, number, number, number];
  /** Confidence konkrétního nástroje (0–100); není kalibrovaná pravděpodobnost. */
  confidence?: number;
  review: 'unreviewed' | 'confirmed' | 'edited';
  issues: string[];
}

// ---------- Ověřený plán (neměnný, INV-01) ----------

export interface TemplateDay {
  dow: Dow;
  workout: WorkoutSpec;
  source: SourceRef;
  locked?: boolean;
}

export interface TemplateWeek {
  /** Stabilní číslo zdrojového týdne, 1-based. Nepřečíslovává se. */
  index: number;
  phase?: string;
  declaredTotalM?: number;
  /** Horní mez, pokud autor uvádí rozsah (např. 48–51 km). */
  declaredTotalMaxM?: number;
  note?: string;
  days: TemplateDay[];
}

export interface PaceRange {
  /** s/km */
  fromSec: number;
  toSec: number;
}
export type PaceChart = Partial<Record<Exclude<IntensityRef, 'strides' | 'walk' | 'free'>, PaceRange>>;

export interface PlanTemplate {
  id: Id;
  name: string;
  origin: 'import' | 'manual' | 'draft';
  documentId?: Id;
  draftRevisionId?: Id;
  createdAt: string;
  verifiedAt: string;
  units: 'km' | 'mi';
  goalLabel?: string;
  goalDistanceM?: number;
  paceChart?: PaceChart;
  weeks: TemplateWeek[];
}

export interface PlanDocument {
  id: Id;
  name: string;
  mime: string;
  size: number;
  checksum: string;
  createdAt: string;
  blob: Blob;
  provenance: 'PLAN_DOCUMENT';
  author?: string;
}

// ---------- Aktivace a rozpis ----------

export interface WeekMapping {
  weekStart: IsoDate;
  /** null = pauza (kalendářní týden bez zdrojového týdne). */
  sourceWeek: number | null;
}

export interface PlanActivation {
  id: Id;
  templateId: Id;
  createdAt: string;
  status: 'active' | 'archived';
  /** Poslední den platnosti po nahrazení jiným plánem. */
  endedOn?: IsoDate;
  mapping: WeekMapping[];
  /** Zdrojové týdny vědomě přeskočené; neoznačují se za absolvované. */
  skippedSourceWeeks: number[];
  revisionSeq: number;
}

export type ScheduledStatus = 'scheduled' | 'completed' | 'partial' | 'skipped';

export interface ScheduledWorkout {
  id: Id;
  activationId: Id;
  date: IsoDate;
  /** Datum podle mapování při aktivaci; liší se po přesunu. */
  originDate: IsoDate;
  sourceWeek: number | null;
  sourceDow: Dow | null;
  /** Předpis z ověřené verze; null u ručně přidané jednotky. */
  original: WorkoutSpec | null;
  workout: WorkoutSpec;
  status: ScheduledStatus;
  locked: boolean;
  skipReason?: string;
}

export type Author = 'user' | 'coach' | 'system';

/** Vratná revize rozpisu (INV-06). `before`/`after` jsou snímky dotčených jednotek. */
export interface ScheduleRevision {
  id: Id;
  activationId: Id;
  seq: number;
  at: string;
  author: Author;
  operation: string;
  reason: string;
  commandId: Id;
  before: ScheduledWorkout[];
  after: ScheduledWorkout[];
  mappingBefore?: WeekMapping[];
  mappingAfter?: WeekMapping[];
  skippedBefore?: number[];
  skippedAfter?: number[];
  revertsId?: Id;
  revertedById?: Id;
}

// ---------- Draft ----------

export type TrainingIntent = 'maintain' | 'improve' | 'race';

export interface DraftParams {
  intent: TrainingIntent;
  weeks: number;
  startDate: IsoDate;
  weeklyKm: number;
  runsPerWeek: number;
  restDows: Dow[];
  longRunDow: Dow;
  raceDate?: IsoDate;
  raceDistanceM?: number;
  /** Co generátor nevěděl a odkud vzal hodnoty. */
  assumptions: string[];
}

export interface PlanDraft {
  id: Id;
  title: string;
  status: 'generating' | 'draft' | 'ready' | 'accepted' | 'archived' | 'failed';
  createdAt: string;
  currentRevisionId: Id;
  acceptedActivationId?: Id;
}

export interface PlanDraftRevision {
  id: Id;
  draftId: Id;
  seq: number;
  parentId: Id | null;
  at: string;
  author: Author;
  reason: string;
  params: DraftParams;
  weeks: TemplateWeek[];
}

// ---------- Profil ----------

export interface AthleteProfile {
  id: 'me';
  /** Volné poznámky trenéra o běžci (zranění, preference, cíle); přenáší se mezi plány i hostiteli. */
  coachNotes?: string;
  locale: 'cs';
  units: 'km';
  timezone: string;
  onboardedAt?: string;
  name?: string;
  intent?: TrainingIntent;
  weeklyKm?: number;
  runsPerWeek?: number;
  restDows: Dow[];
  longRunDow: Dow;
  raceDate?: IsoDate;
  raceDistanceM?: number;
  raceTargetSec?: number;
  paceChart?: PaceChart;
  aiModelId?: string;
  paceSource?: 'plan' | 'profile';
}

// ---------- Aktivity ----------

export interface Lap {
  index: number;
  distanceM: number;
  durationSec: number;
  avgHr?: number;
  elevGainM?: number;
  /** `device` = z hodinek, `auto_km` = spočítáno po kilometrech. */
  kind: 'device' | 'auto_km';
}

export interface Activity {
  id: Id;
  source: 'file_gpx' | 'file_tcx' | 'file_fit' | 'manual';
  provenance: Extract<Provenance, 'USER_ENTERED' | 'USER_FILE_UPLOAD'>;
  checksum?: string;
  fileName?: string;
  name: string;
  sport: 'run' | 'other';
  startUtc: string;
  /** Den v zóně uživatele, pro párování a týdenní součty. */
  localDate: IsoDate;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  laps: Lap[];
  /** Co v záznamu chybí; hodnocení to musí přiznat (INV-12). */
  missing: Array<'hr' | 'laps' | 'elevation' | 'gps'>;
  /** Odkaz, který zadal uživatel (např. na aktivitu ve Stravě). */
  externalUrl?: string;
  createdAt: string;
}

export interface WorkoutMatch {
  id: Id;
  activityId: Id;
  workoutId: Id;
  state: 'auto' | 'confirmed';
  at: string;
}

export interface CheckIn {
  id: Id;
  date: IsoDate;
  activityId?: Id;
  workoutId?: Id;
  /** 1 = hodně těžké … 5 = výborné */
  feel: 1 | 2 | 3 | 4 | 5;
  pain: 'none' | 'mild' | 'significant';
  painNote?: string;
  rpe?: number;
  note?: string;
  at: string;
}

// ---------- Chat a AI ----------

export interface ContextRef {
  kind: 'workout' | 'activity' | 'week' | 'draft';
  id: string;
  label: string;
}

export interface CoachProposal {
  commandJson: string;
  state: 'pending' | 'applied' | 'dismissed' | 'invalid' | 'stale';
  error?: string;
  summary?: string[];
  revisionId?: Id;
}

export interface CoachMessage {
  id: Id;
  threadId: Id;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: string;
  contextRefs?: ContextRef[];
  status?: 'streaming' | 'done' | 'stopped' | 'error';
  draftId?: Id;
  proposal?: CoachProposal;
  usageEventId?: Id;
}

export type MeasurementKind = 'reported' | 'tokenized' | 'estimated';

/** §9.4. Bez promptů a tréninkových dat. Chybějící hodnota je null, ne nula. */
export interface AiUsageEvent {
  requestId: Id;
  threadId?: Id;
  provider: 'webllm' | 'openai' | 'anthropic';
  model: string;
  mode: 'local' | 'cloud';
  status: 'completed' | 'stopped' | 'failed';
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  measurementKind: MeasurementKind | null;
  startedAt: string;
  durationMs: number;
  usageScope: 'app_request';
}

export interface AuditEvent {
  id: Id;
  at: string;
  author: Author;
  operation: string;
  targetId?: string;
  ok: boolean;
  detail?: string;
}
