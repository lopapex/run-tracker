// Datový model konektoru, uložený jako JSON workspace v Netlify Blobs.
// Interně: metry, sekundy, tempo v s/km (§6.3).

export type Id = string;
/** Kalendářní den `YYYY-MM-DD` v časové zóně uživatele. */
export type IsoDate = string;
/** 0 = pondělí … 6 = neděle. */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

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
  origin: 'import' | 'manual';
  createdAt: string;
  verifiedAt: string;
  units: 'km' | 'mi';
  paceChart?: PaceChart;
  /** Tabulka temp po cílových časech, jak ji uvádí dokument (např. 1h25 / 1h30 / 1h35); tempa se mezi řádky dopočítají. */
  paceTable?: PaceTableRow[];
  weeks: TemplateWeek[];
}

export interface PaceTableRow {
  /** Cílový čas závodu v sekundách. */
  goalSec: number;
  paces: PaceChart;
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
  /** Nejdelší běh posledních týdnů (km): dlouhý běh od něj roste postupně, ne skokem na podíl z objemu. */
  longestRunKm?: number;
  /** Co generátor nevěděl a odkud vzal hodnoty. */
  assumptions: string[];
}

// ---------- Profil ----------

export interface AthleteProfile {
  id: 'me';
  /** Volné poznámky trenéra o běžci (zranění, preference, cíle); přenáší se mezi plány i hostiteli. */
  coachNotes?: string;
  locale: 'cs';
  units: 'km';
  timezone: string;
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
  paceSource?: 'plan' | 'profile';
  /** Odkud se tempa počítají z cílového času, když plán má tabulku temp: z tabulky, nebo podle VDOT. */
  paceMethod?: 'table' | 'vdot';
  /** Uživatel má v Claude konektor Strava: appka podle toho ukáže tlačítka Stravy. Nevyplněno = zatím nevíme. */
  strava?: boolean;
}
