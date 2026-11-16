// Normalizace aktivit a deterministické metriky (§7.1, §7.3). Žádná hodnota se nedopočítává odhadem (INV-12).
import { diffDays, localDateOf } from './dates';
import { formatKm, formatPace, paceOf } from './format';
import { newId } from './schedule';
import type { Activity, CheckIn, Lap, PaceChart, ScheduledWorkout } from './types';

export interface TrackPoint {
  t: number; // ms epoch
  lat?: number;
  lon?: number;
  ele?: number;
  hr?: number;
  cad?: number;
  /** Kumulativní vzdálenost ze zařízení, metry. */
  dist?: number;
}

export interface ParsedActivity {
  name?: string;
  sport: 'run' | 'other';
  points: TrackPoint[];
  deviceLaps: Array<{ distanceM: number; durationSec: number; avgHr?: number }>;
  totals?: { distanceM?: number; movingSec?: number; elapsedSec?: number; elevGainM?: number; avgHr?: number; maxHr?: number };
}

const num = (s: string | undefined | null): number | undefined => {
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const tag = (xml: string, name: string): string | undefined => new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)<`, 'i').exec(xml)?.[1]?.trim();

function haversine(a: TrackPoint, b: TrackPoint): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * rad;
  const dLon = (b.lon! - a.lon!) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * rad) * Math.cos(b.lat! * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseGpx(xml: string): ParsedActivity {
  const points: TrackPoint[] = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const time = tag(m[2], 'time');
    if (!time) continue;
    points.push({
      t: Date.parse(time),
      lat: num(/lat="([^"]+)"/.exec(m[1])?.[1]),
      lon: num(/lon="([^"]+)"/.exec(m[1])?.[1]),
      ele: num(tag(m[2], 'ele')),
      hr: num(tag(m[2], 'hr')),
      cad: num(tag(m[2], 'cad')),
    });
  }
  const type = (tag(xml, 'type') ?? '').toLowerCase();
  const trk = /<trk>([\s\S]*?)<trkseg/i.exec(xml)?.[1] ?? '';
  return { name: tag(trk, 'name'), sport: type && !/run|běh|9/.test(type) ? 'other' : 'run', points, deviceLaps: [] };
}

export function parseTcx(xml: string): ParsedActivity {
  const points: TrackPoint[] = [];
  const deviceLaps: ParsedActivity['deviceLaps'] = [];
  const lapRe = /<Lap\b[^>]*>([\s\S]*?)<\/Lap>/gi;
  for (let l = lapRe.exec(xml); l; l = lapRe.exec(xml)) {
    const head = l[1].split(/<Track>/i)[0];
    const distanceM = num(tag(head, 'DistanceMeters'));
    const durationSec = num(tag(head, 'TotalTimeSeconds'));
    const avgHr = num(/<AverageHeartRateBpm[^>]*>\s*<Value>([^<]+)</i.exec(head)?.[1]);
    if (distanceM != null && durationSec != null) deviceLaps.push({ distanceM, durationSec, avgHr });
    const tpRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;
    for (let m = tpRe.exec(l[1]); m; m = tpRe.exec(l[1])) {
      const time = tag(m[1], 'Time');
      if (!time) continue;
      points.push({
        t: Date.parse(time),
        lat: num(tag(m[1], 'LatitudeDegrees')),
        lon: num(tag(m[1], 'LongitudeDegrees')),
        ele: num(tag(m[1], 'AltitudeMeters')),
        dist: num(tag(m[1], 'DistanceMeters')),
        hr: num(/<HeartRateBpm[^>]*>\s*<Value>([^<]+)</i.exec(m[1])?.[1]),
        cad: num(tag(m[1], 'Cadence')) ?? num(tag(m[1], 'RunCadence')),
      });
    }
  }
  const sport = /<Activity\s+Sport="([^"]+)"/i.exec(xml)?.[1]?.toLowerCase() ?? 'running';
  return { sport: sport.startsWith('run') ? 'run' : 'other', points, deviceLaps };
}

/** Výstup `fit-file-parser` (režim list) → společný tvar. */
export function fromFitData(data: Record<string, unknown>): ParsedActivity {
  const records = (data.records as Array<Record<string, unknown>> | undefined) ?? [];
  const laps = (data.laps as Array<Record<string, unknown>> | undefined) ?? [];
  const session = ((data.sessions as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const points: TrackPoint[] = records
    .filter((r) => r.timestamp)
    .map((r) => ({
      t: new Date(r.timestamp as string).getTime(),
      lat: n(r.position_lat),
      lon: n(r.position_long),
      ele: n(r.enhanced_altitude) ?? n(r.altitude),
      hr: n(r.heart_rate),
      cad: n(r.cadence),
      dist: n(r.distance),
    }));
  const sport = String(session.sport ?? 'running').toLowerCase();
  return {
    sport: sport.includes('run') ? 'run' : 'other',
    points,
    deviceLaps: laps
      .map((l) => ({ distanceM: n(l.total_distance) ?? 0, durationSec: n(l.total_timer_time) ?? n(l.total_elapsed_time) ?? 0, avgHr: n(l.avg_heart_rate) }))
      .filter((l) => l.distanceM > 0 && l.durationSec > 0),
    totals: {
      distanceM: n(session.total_distance),
      movingSec: n(session.total_timer_time),
      elapsedSec: n(session.total_elapsed_time),
      elevGainM: n(session.total_ascent),
      avgHr: n(session.avg_heart_rate),
      maxHr: n(session.max_heart_rate),
    },
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function buildActivity(
  parsed: ParsedActivity,
  meta: { source: Activity['source']; checksum?: string; fileName?: string; timezone?: string; now: string },
): Activity | { error: string } {
  const pts = parsed.points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (pts.length < 2 && !parsed.totals?.distanceM) return { error: 'V souboru není žádný záznam trasy ani souhrn.' };

  const hasGps = pts.some((p) => p.lat != null && p.lon != null);
  const hasDist = pts.some((p) => p.dist != null);
  // Kumulativní vzdálenost: ze zařízení, jinak z GPS.
  const cum: number[] = [];
  let acc = 0;
  let moving = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      let d = 0;
      if (hasDist && pts[i].dist != null && pts[i - 1].dist != null) d = Math.max(0, pts[i].dist! - pts[i - 1].dist!);
      else if (pts[i].lat != null && pts[i - 1].lat != null) d = haversine(pts[i - 1], pts[i]);
      acc += d;
      // Pohyb: úsek kratší než 10 s s rychlostí nad 0,5 m/s.
      if (dt > 0 && dt <= 10 && d / dt > 0.5) moving += dt;
      else if (dt > 0 && dt <= 10 && !hasGps && !hasDist) moving += dt;
    }
    cum.push(acc);
  }

  const elapsedSec = parsed.totals?.elapsedSec ?? (pts.length ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0);
  const distanceM = parsed.totals?.distanceM ?? acc;
  const movingSec = parsed.totals?.movingSec ?? (moving > 0 ? moving : elapsedSec);
  if (!(distanceM > 0) || !(movingSec > 0)) return { error: 'Ze souboru nejde určit vzdálenost nebo čas.' };

  const hrs = pts.map((p) => p.hr).filter((h): h is number => h != null && h > 30);
  const eles = pts.map((p) => p.ele).filter((e): e is number => e != null);
  let gain: number | undefined;
  if (eles.length > 10) {
    // Práh 3 m tlumí šum výškoměru.
    gain = 0;
    let ref = eles[0];
    for (const e of eles) {
      if (e - ref >= 3) { gain += e - ref; ref = e; }
      else if (ref - e >= 3) ref = e;
    }
  }

  let laps: Lap[] = parsed.deviceLaps.map((l, i) => ({ index: i + 1, distanceM: l.distanceM, durationSec: l.durationSec, avgHr: l.avgHr, kind: 'device' as const }));
  if (laps.length <= 1 && pts.length > 10 && acc > 1000) {
    laps = [];
    let startIdx = 0;
    for (let k = 1; k * 1000 <= acc + 1; k++) {
      const endIdx = cum.findIndex((c) => c >= k * 1000);
      if (endIdx < 0) break;
      const slice = pts.slice(startIdx, endIdx + 1);
      laps.push({
        index: k,
        distanceM: 1000,
        durationSec: (pts[endIdx].t - pts[startIdx].t) / 1000,
        avgHr: avg(slice.map((p) => p.hr).filter((h): h is number => h != null)),
        kind: 'auto_km',
      });
      startIdx = endIdx;
    }
    // Zbytek za posledním celým kilometrem je vlastní kratší kolo, nezahazuje se.
    const rest = acc - laps.length * 1000;
    if (rest > 50 && startIdx < pts.length - 1) {
      const slice = pts.slice(startIdx);
      laps.push({
        index: laps.length + 1,
        distanceM: Math.round(rest),
        durationSec: (pts[pts.length - 1].t - pts[startIdx].t) / 1000,
        avgHr: avg(slice.map((p) => p.hr).filter((h): h is number => h != null)),
        kind: 'auto_km',
      });
    }
  }

  const missing: Activity['missing'] = [];
  if (hrs.length === 0 && parsed.totals?.avgHr == null) missing.push('hr');
  if (laps.length === 0) missing.push('laps');
  if (gain == null && parsed.totals?.elevGainM == null) missing.push('elevation');
  if (!hasGps) missing.push('gps');

  const startUtc = new Date(pts[0]?.t ?? Date.parse(meta.now)).toISOString();
  const cads = pts.map((p) => p.cad).filter((c): c is number => c != null && c > 0);
  return {
    id: newId(),
    source: meta.source,
    provenance: 'USER_FILE_UPLOAD',
    checksum: meta.checksum,
    fileName: meta.fileName,
    name: parsed.name || 'Běh',
    sport: parsed.sport,
    startUtc,
    localDate: localDateOf(startUtc, meta.timezone),
    distanceM: Math.round(distanceM),
    movingSec: Math.round(movingSec),
    elapsedSec: Math.round(elapsedSec),
    elevGainM: parsed.totals?.elevGainM ?? (gain != null ? Math.round(gain) : undefined),
    avgHr: parsed.totals?.avgHr ?? (hrs.length ? Math.round(avg(hrs)!) : undefined),
    maxHr: parsed.totals?.maxHr ?? (hrs.length ? Math.max(...hrs) : undefined),
    avgCadence: cads.length ? Math.round(avg(cads)!) : undefined,
    laps,
    missing,
    createdAt: meta.now,
  };
}

// ---------- Párování (§7.2) ----------

export interface MatchCandidate {
  workout: ScheduledWorkout;
  /** Proč je kandidátem; bez vymyšlených procent shody. */
  reasons: string[];
  strong: boolean;
}

export function matchCandidates(activity: Activity, workouts: ScheduledWorkout[], alreadyMatchedWorkoutIds: Set<string>): MatchCandidate[] {
  if (activity.sport !== 'run') return [];
  const out: MatchCandidate[] = [];
  for (const w of workouts) {
    if (w.workout.type === 'rest' || w.workout.type === 'strength' || w.status === 'skipped') continue;
    const dd = Math.abs(diffDays(w.date, activity.localDate));
    if (dd > 1) continue;
    const reasons: string[] = [dd === 0 ? 'stejný den' : 'sousední den'];
    let distOk = true;
    if (w.workout.distanceM) {
      const ratio = activity.distanceM / w.workout.distanceM;
      distOk = ratio > 0.7 && ratio < 1.35;
      reasons.push(distOk ? `délka sedí (${formatKm(activity.distanceM)} / plán ${formatKm(w.workout.distanceM)})` : `délka se liší (${formatKm(activity.distanceM)} / plán ${formatKm(w.workout.distanceM)})`);
    } else reasons.push('plán neuvádí délku');
    if (alreadyMatchedWorkoutIds.has(w.id)) reasons.push('už má spárovanou aktivitu');
    out.push({ workout: w, reasons, strong: dd === 0 && distOk && !alreadyMatchedWorkoutIds.has(w.id) });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || Math.abs(diffDays(a.workout.date, activity.localDate)) - Math.abs(diffDays(b.workout.date, activity.localDate)));
}

/** Automaticky párovat jen při jednoznačnosti: právě jeden silný kandidát. */
export function autoMatch(candidates: MatchCandidate[]): ScheduledWorkout | undefined {
  const strong = candidates.filter((c) => c.strong);
  return strong.length === 1 ? strong[0].workout : undefined;
}

// ---------- Hodnocení vstupů (§7.4) ----------

export interface Evaluation {
  headline: string;
  facts: string[];
  gaps: string[];
}

export function evaluate(activity: Activity, planned: ScheduledWorkout | undefined, chart: PaceChart | undefined, checkIn?: CheckIn): Evaluation {
  const facts: string[] = [];
  const gaps: string[] = [];
  const pace = paceOf(activity.distanceM, activity.movingSec);
  let headline = `${formatKm(activity.distanceM)} tempem ${formatPace(pace)}/km`;

  if (planned) {
    const w = planned.workout;
    if (w.distanceM) {
      const ratio = activity.distanceM / w.distanceM;
      if (ratio >= 0.93 && ratio <= 1.1) facts.push(`Délka odpovídá plánu (${formatKm(w.distanceM)}).`);
      else if (ratio < 0.93) facts.push(`Kratší než plán o ${formatKm(w.distanceM - activity.distanceM)}.`);
      else facts.push(`Delší než plán o ${formatKm(activity.distanceM - w.distanceM)}.`);
    }
    const hasFastBlock = w.blocks.some((b) => (b.kind === 'repeat' || (b.kind === 'segment' && b.role === 'work')));
    if (hasFastBlock) {
      // Intervaly a tempové bloky se nehodnotí z celkového průměru.
      const device = activity.laps.filter((l) => l.kind === 'device');
      if (device.length > 1) {
        const fastest = [...device].sort((a, b) => a.durationSec / a.distanceM - b.durationSec / b.distanceM)[0];
        facts.push(`Jednotka má rychlé úseky; nejrychlejší kolo ${formatPace(paceOf(fastest.distanceM, fastest.durationSec))}/km. Průměr celého běhu o nich nic neříká.`);
      } else gaps.push('Chybí kola z hodinek, rychlé úseky nejde vyhodnotit zvlášť.');
    } else if ((w.type === 'easy' || w.type === 'long') && chart?.easy && pace) {
      if (pace < chart.easy.fromSec - 5) facts.push(`Tempo bylo rychlejší než tvoje volné pásmo (${formatPace(chart.easy.fromSec)}–${formatPace(chart.easy.toSec)}/km).`);
      else if (pace > chart.easy.toSec + 15) facts.push(`Tempo bylo pomalejší než volné pásmo; u volného běhu to nevadí, zvlášť v kopcích.`);
      else facts.push('Tempo sedí do volného pásma.');
    }
    headline = `${w.title}: ${headline}`;
  } else gaps.push('Aktivita není spárovaná s jednotkou plánu.');

  const auto = activity.laps.filter((l) => l.kind === 'auto_km');
  if (auto.length >= 6) {
    const half = Math.floor(auto.length / 2);
    const p1 = avgPace(auto.slice(0, half));
    const p2 = avgPace(auto.slice(half));
    if (p1 && p2 && Math.abs(p2 - p1) >= 8) facts.push(p2 < p1 ? `Druhá půlka byla rychlejší o ${Math.round(p1 - p2)} s/km.` : `Druhá půlka byla pomalejší o ${Math.round(p2 - p1)} s/km.`);
  }
  if (activity.elevGainM != null && activity.distanceM > 0 && activity.elevGainM / (activity.distanceM / 1000) > 15) {
    facts.push(`Kopcovitá trasa (${Math.round(activity.elevGainM)} m nastoupáno); tempo i tep to zkresluje.`);
  }
  if (checkIn) {
    if (checkIn.pain !== 'none') facts.push(checkIn.pain === 'significant' ? 'Hlásíš výraznou bolest. Další zátěž uprav a pokud nepoleví, nech se vyšetřit.' : 'Hlásíš mírnou bolest; sleduj, jestli se nezhoršuje.');
    else if (checkIn.feel <= 2) facts.push('Běh ti přišel těžký. Jeden takový den nic neznamená, sleduj další dny.');
  } else gaps.push('Chybí tvůj pocit z běhu.');
  if (activity.missing.includes('hr')) gaps.push('Záznam nemá tep.');
  if (activity.missing.includes('elevation')) gaps.push('Záznam nemá převýšení.');

  return { headline, facts: facts.slice(0, 3), gaps };
}

function avgPace(laps: Lap[]): number | undefined {
  const d = laps.reduce((a, l) => a + l.distanceM, 0);
  const t = laps.reduce((a, l) => a + l.durationSec, 0);
  return paceOf(d, t);
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
