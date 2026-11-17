// Export jednotky jako strukturovaný trénink pro hodinky Garmin (soubor FIT typu „workout“).
// Kóduje jen tři zprávy z profilu FIT: file_id, workout a workout_step.
import { INTENSITY_LABEL } from '../domain/format';
import type { Block, PaceChart, Segment, WorkoutSpec } from '../domain/types';

export interface FitStep {
  name: string;
  /** 0 = čas (ms), 1 = vzdálenost (cm), 5 = bez omezení (do stisku Lap), 6 = opakuj od kroku */
  durationType: 0 | 1 | 5 | 6;
  durationValue: number;
  /** 0 = rychlost, 2 = bez cíle; u opakování se nepoužívá */
  targetType: 0 | 2;
  /** U opakování počet opakování. */
  targetValue: number;
  /** Rozsah rychlosti v mm/s. */
  speedLow?: number;
  speedHigh?: number;
  /** 0 aktivní, 1 odpočinek, 2 rozklus, 3 výklus, 4 zotavení */
  intensity: 0 | 1 | 2 | 3 | 4;
}

const ROLE_INTENSITY: Record<Segment['role'], FitStep['intensity']> = { warmup: 2, cooldown: 3, recovery: 4, work: 0, steady: 0 };
const ROLE_NAME: Record<Segment['role'], string> = { warmup: 'Rozklus', cooldown: 'Vyklus', recovery: 'Pauza', work: 'Usek', steady: 'Beh' };
// Hodinky umí v názvech spolehlivě jen ASCII.
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').slice(0, 15);

function step(s: Segment, chart: PaceChart, name?: string): FitStep {
  const range = chart[s.intensity as keyof PaceChart];
  const fast = range ? Math.min(range.fromSec, range.toSec) : 0;
  const slow = range ? Math.max(range.fromSec, range.toSec) : 0;
  return {
    name: ascii(name ?? `${ROLE_NAME[s.role]} ${INTENSITY_LABEL[s.intensity]}`),
    durationType: s.durationSec != null ? 0 : s.distanceM != null ? 1 : 5,
    durationValue: s.durationSec != null ? Math.round(s.durationSec * 1000) : s.distanceM != null ? Math.round(s.distanceM * 100) : 0,
    targetType: range ? 0 : 2,
    targetValue: 0,
    // tempo v s/km → rychlost v mm/s; pomalejší tempo je dolní mez rychlosti
    speedLow: range ? Math.round(1_000_000 / slow) : undefined,
    speedHigh: range ? Math.round(1_000_000 / fast) : undefined,
    intensity: s.intensity === 'walk' ? 1 : ROLE_INTENSITY[s.role],
  };
}

const repeat = (fromIndex: number, count: number): FitStep => ({ name: '', durationType: 6, durationValue: fromIndex, targetType: 2, targetValue: count, intensity: 0 });

/** Převede předpis na kroky tak, jak je hodinky odkrokují. */
export function workoutSteps(w: WorkoutSpec, chart: PaceChart): FitStep[] {
  const steps: FitStep[] = [];
  const add = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.kind === 'segment') steps.push(step(b, chart));
      else if (b.kind === 'repeat') {
        const first = steps.length;
        for (const part of [b.work, ...(b.more ?? [])]) steps.push(step(part, chart));
        if (b.recovery) steps.push(step(b.recovery, chart));
        if (b.count > 1) steps.push(repeat(first, b.count));
      } else if (b.kind === 'strides') {
        const first = steps.length;
        steps.push(step({ role: 'work', durationSec: b.durationSec, intensity: 'strides' }, chart, 'Rovinka'));
        steps.push(step({ role: 'recovery', durationSec: 60, intensity: 'easy' }, {}, 'Volne'));
        if (b.count > 1) steps.push(repeat(first, b.count));
      }
    }
  };
  add(w.blocks);
  if (!steps.length) {
    const intensity = w.type === 'easy' || w.type === 'long' ? 'easy' : 'free';
    steps.push(step({ role: 'steady', distanceM: w.distanceM, durationSec: w.distanceM == null ? w.durationSec : undefined, intensity }, chart, w.title));
  }
  return steps;
}

// ---------- Binární kódování FIT ----------

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
function crc16(bytes: number[], start = 0): number {
  let crc = start;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

type Field = { num: number; type: 'enum' | 'uint16' | 'uint32' | 'uint32z' | 'string'; size?: number; value: number | string };
const BASE = { enum: [0x00, 1], uint16: [0x84, 2], uint32: [0x86, 4], uint32z: [0x8c, 4], string: [0x07, 0] } as const;
const le = (value: number, size: number) => Array.from({ length: size }, (_, i) => (value >>> (8 * i)) & 0xff);

function message(local: number, global: number, fields: Field[], define: boolean): number[] {
  const out: number[] = [];
  const sizeOf = (f: Field) => (f.type === 'string' ? f.size! : BASE[f.type][1]);
  if (define) {
    out.push(0x40 | local, 0, 0, ...le(global, 2), fields.length);
    for (const f of fields) out.push(f.num, sizeOf(f), BASE[f.type][0]);
  }
  out.push(local);
  for (const f of fields) {
    if (f.type === 'string') {
      const text = [...String(f.value)].map((c) => c.charCodeAt(0)).slice(0, f.size! - 1);
      out.push(...text, ...new Array(f.size! - text.length).fill(0));
    } else out.push(...le(Number(f.value), sizeOf(f)));
  }
  return out;
}

const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000;
const NONE = 0xffffffff;

export function encodeWorkoutFit(name: string, steps: FitStep[], now: Date = new Date()): Uint8Array {
  const body: number[] = [];
  body.push(...message(0, 0, [
    { num: 0, type: 'enum', value: 5 }, // type: workout
    { num: 1, type: 'uint16', value: 255 }, // manufacturer: development
    { num: 2, type: 'uint16', value: 0 },
    { num: 3, type: 'uint32z', value: (Math.floor(now.getTime() / 1000) & 0x7fffffff) || 1 },
    { num: 4, type: 'uint32', value: Math.floor(now.getTime() / 1000) - FIT_EPOCH },
  ], true));
  body.push(...message(1, 26, [
    { num: 4, type: 'enum', value: 1 }, // sport: running
    { num: 6, type: 'uint16', value: steps.length },
    { num: 8, type: 'string', size: 24, value: ascii(name).padEnd(1, 'W') },
  ], true));
  steps.forEach((s, i) => {
    body.push(...message(2, 27, [
      { num: 254, type: 'uint16', value: i },
      { num: 0, type: 'string', size: 16, value: s.name },
      { num: 1, type: 'enum', value: s.durationType },
      { num: 2, type: 'uint32', value: s.durationType === 5 ? NONE : s.durationValue },
      { num: 3, type: 'enum', value: s.durationType === 6 ? 0xff : s.targetType },
      { num: 4, type: 'uint32', value: s.durationType === 6 ? s.targetValue : s.targetType === 0 ? 0 : NONE },
      { num: 5, type: 'uint32', value: s.speedLow ?? NONE },
      { num: 6, type: 'uint32', value: s.speedHigh ?? NONE },
      { num: 7, type: 'enum', value: s.durationType === 6 ? 0xff : s.intensity },
    ], i === 0));
  });
  const header = [14, 0x20, ...le(2132, 2), ...le(body.length, 4), 0x2e, 0x46, 0x49, 0x54];
  header.push(...le(crc16(header), 2));
  const file = [...header, ...body];
  return new Uint8Array([...file, ...le(crc16(file), 2)]);
}

/** Čitelný popis kroku pro náhled ve widgetu. */
export function describeStep(s: FitStep): string {
  if (s.durationType === 6) return `Opakuj ${s.targetValue}× od kroku ${s.durationValue + 1}`;
  const amount = s.durationType === 0 ? (s.durationValue % 60000 === 0 ? `${s.durationValue / 60000} min` : `${Math.round(s.durationValue / 1000)} s`) : s.durationType === 1 ? (s.durationValue >= 100000 ? `${String(s.durationValue / 100000).replace('.', ',')} km` : `${s.durationValue / 100} m`) : 'do stisku Lap';
  const pace = (mmPerSec: number) => { const sec = Math.round(1_000_000 / mmPerSec); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  return `${s.name || 'Krok'} · ${amount}${s.speedLow && s.speedHigh ? ` · ${pace(s.speedHigh)}–${pace(s.speedLow)} /km` : ''}`;
}
