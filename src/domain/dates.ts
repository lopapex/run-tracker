import type { Dow, IsoDate } from './types';

// Kalendářní dny počítáme v UTC poledni, aby je neposouval letní čas.
const toUtc = (d: IsoDate) => new Date(`${d}T12:00:00Z`);
const fromUtc = (d: Date): IsoDate => d.toISOString().slice(0, 10);

export function todayIso(timezone?: string, now: Date = new Date()): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts;
  } catch {
    return fromUtc(now);
  }
}

export function localDateOf(isoUtc: string, timezone?: string): IsoDate {
  return todayIso(timezone, new Date(isoUtc));
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + n);
  return fromUtc(t);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86_400_000);
}

export function dowOf(d: IsoDate): Dow {
  return ((toUtc(d).getUTCDay() + 6) % 7) as Dow;
}

export function weekStartOf(d: IsoDate): IsoDate {
  return addDays(d, -dowOf(d));
}

export const DOW_LONG = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'] as const;

export function formatDay(d: IsoDate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const t = toUtc(d);
  const base = `${t.getUTCDate()}. ${t.getUTCMonth() + 1}.`;
  const withYear = opts.year ? `${base} ${t.getUTCFullYear()}` : base;
  return opts.weekday ? `${DOW_LONG[dowOf(d)]} ${withYear}` : withYear;
}

export function isIsoDate(s: unknown): s is IsoDate {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s).getTime());
}
