export interface StravaConnection {
  id: 'strava';
  accessToken: string;
  refreshToken: string;
  /** Sekundy od epochy. */
  expiresAt: number;
  athleteId?: number;
  athleteName?: string;
  scope: string;
  connectedAt: string;
  lastSyncAt?: string;
}

/** Souhrn aktivity ze Stravy. Jen k zobrazení; nesmí do AI ani do trvalých odvozených dat (§10.1). */
export interface StravaActivity {
  id: number;
  name: string;
  sportType: string;
  isRun: boolean;
  startUtc: string;
  localDate: string;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM?: number;
  avgHr?: number;
  provenance: 'STRAVA_API_RESTRICTED';
  fetchedAt: string;
  /** Nejpozději sedm dní po stažení se záznam maže. */
  expiresAt: string;
}
