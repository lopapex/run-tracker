// Propojení se Stravou: jen čtení vlastních aktivit k zobrazení (R-08).
// Podmínky Stravy (API Policy) nedovolují dát tahle data AI ani z nich stavět trvalé indexy,
// proto: dočasná cache s expirací, žádný vstup do trenéra, žádný zápis do rozpisu.
import { db } from '@/db/db';
import type { IsoDate } from '@/domain/types';
import type { StravaActivity, StravaConnection } from './types';

const API = 'https://www.strava.com/api/v3';
const AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const FN = '/api/strava';
const CACHE_DAYS = 7;
const STATE_KEY = 'rt.stravaState';

export type StravaErrorCode = 'not_configured' | 'unreachable' | 'denied' | 'revoked' | 'rate_limited' | 'failed';

export class StravaError extends Error {
  code: StravaErrorCode;
  constructor(code: StravaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const stravaActivityUrl = (id: number) => `https://www.strava.com/activities/${id}`;

async function config(): Promise<{ clientId: string }> {
  let res: Response;
  try {
    res = await fetch(FN, { headers: { accept: 'application/json' } });
  } catch {
    throw new StravaError('unreachable', 'Jsi offline, propojení teď nejde spustit.');
  }
  const data = res.ok && res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!data?.configured) throw new StravaError('not_configured', 'Propojení se Stravou zatím není na serveru nastavené.');
  return { clientId: String(data.clientId) };
}

/** Přesměruje na souhlas ve Stravě. Žádá jen čtení aktivit. */
export async function beginConnect(): Promise<void> {
  const { clientId } = await config();
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${location.origin}/strava/`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read',
    state,
  });
  location.href = `${AUTHORIZE}?${q}`;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athlete?: { id: number; firstname?: string };
}

async function tokenCall(body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new StravaError('unreachable', 'Server propojení neodpovídá.');
  }
  if (res.status === 503) throw new StravaError('not_configured', 'Propojení se Stravou zatím není na serveru nastavené.');
  if (res.status === 429) throw new StravaError('rate_limited', 'Strava teď omezuje počet požadavků. Zkus to později.');
  if (!res.ok) throw new StravaError('revoked', 'Strava přístup odmítla. Propoj účet znovu.');
  return res.json();
}

export async function completeConnect(params: URLSearchParams): Promise<void> {
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (params.get('error')) throw new StravaError('denied', 'Propojení jsi ve Stravě nepovolil(a).');
  const code = params.get('code');
  if (!code || !expected || params.get('state') !== expected) throw new StravaError('failed', 'Odpověď ze Stravy nesedí k tomuto zařízení. Zkus propojení znovu.');
  // Kontrolují se skutečně udělená oprávnění, ne ta požadovaná (§10.2).
  const scope = params.get('scope') ?? '';
  if (!/activity:read/.test(scope)) throw new StravaError('denied', 'Bez oprávnění číst aktivity nemá propojení co zobrazit.');
  const t = await tokenCall({ action: 'exchange', code });
  const conn: StravaConnection = {
    id: 'strava',
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: t.expiresAt,
    athleteId: t.athlete?.id,
    athleteName: t.athlete?.firstname,
    scope,
    connectedAt: new Date().toISOString(),
  };
  await db().connections.put(conn);
}

let refreshing: Promise<string> | undefined;

/** Platný access token; obnova běží nejvýš jednou naráz, aby se refresh token nepřepsal dvakrát. */
async function accessToken(): Promise<string> {
  const conn = await db().connections.get('strava');
  if (!conn) throw new StravaError('revoked', 'Strava není propojená.');
  if (conn.expiresAt - 300 > Date.now() / 1000) return conn.accessToken;
  refreshing ??= (async () => {
    try {
      const t = await tokenCall({ action: 'refresh', refreshToken: conn.refreshToken });
      await db().connections.update('strava', { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
      return t.accessToken;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

async function api(path: string): Promise<unknown> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new StravaError('unreachable', 'Strava teď není dostupná.');
  }
  if (res.status === 401) {
    await removeLocal();
    throw new StravaError('revoked', 'Přístup ke Stravě byl zrušen. Propoj účet znovu.');
  }
  if (res.status === 429) throw new StravaError('rate_limited', 'Strava teď omezuje počet požadavků. Zkus to později.');
  if (!res.ok) throw new StravaError('failed', `Strava vrátila chybu ${res.status}.`);
  return res.json();
}

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

export function toStravaActivity(raw: Record<string, unknown>, now: Date): StravaActivity | null {
  const id = Number(raw.id);
  const local = String(raw.start_date_local ?? '');
  if (!id || local.length < 10) return null;
  const sportType = String(raw.sport_type ?? raw.type ?? '');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    id,
    name: String(raw.name ?? 'Aktivita'),
    sportType,
    isRun: RUN_TYPES.has(sportType),
    startUtc: String(raw.start_date ?? ''),
    // Strava posílá místní čas startu; den se bere z něj, ne z UTC.
    localDate: local.slice(0, 10),
    distanceM: n(raw.distance) ?? 0,
    movingSec: n(raw.moving_time) ?? 0,
    elapsedSec: n(raw.elapsed_time) ?? 0,
    elevGainM: n(raw.total_elevation_gain),
    avgHr: n(raw.average_heartrate),
    provenance: 'STRAVA_API_RESTRICTED',
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_DAYS * 86_400_000).toISOString(),
  };
}

export async function purgeExpired(): Promise<void> {
  await db().stravaActivities.where('expiresAt').below(new Date().toISOString()).delete();
}

/** Stáhne aktivity z daného rozmezí dnů (včetně) a obnoví jejich dočasnou cache. */
export async function syncRange(from: IsoDate, to: IsoDate): Promise<number> {
  await purgeExpired();
  const after = Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000) - 86_400;
  const before = Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000) + 86_400;
  const raw = (await api(`/athlete/activities?after=${after}&before=${before}&per_page=100`)) as Array<Record<string, unknown>>;
  const now = new Date();
  const items = raw.map((r) => toStravaActivity(r, now)).filter((a): a is StravaActivity => a != null && a.localDate >= from && a.localDate <= to);
  await db().transaction('rw', db().stravaActivities, db().connections, async () => {
    // Aktivita smazaná ve Stravě zmizí i tady; nic se nenahrazuje jinou.
    await db().stravaActivities.where('localDate').between(from, to, true, true).delete();
    await db().stravaActivities.bulkPut(items);
    await db().connections.update('strava', { lastSyncAt: now.toISOString() });
  });
  return items.length;
}

async function removeLocal(): Promise<void> {
  await db().transaction('rw', db().stravaActivities, db().connections, async () => {
    await db().stravaActivities.clear();
    await db().connections.delete('strava');
  });
}

/** Odpojení: zruší přístup u Stravy a smaže token i cache ze zařízení. */
export async function disconnect(): Promise<void> {
  const conn = await db().connections.get('strava');
  if (conn) {
    try {
      const token = await accessToken();
      await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    } catch {
      // I když Strava neodpoví, lokální přístup a data se smažou; zbytek jde zrušit v nastavení Stravy.
    }
  }
  await removeLocal();
}
