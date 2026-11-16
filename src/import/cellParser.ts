// Text jedné buňky plánu → strukturovaná jednotka (§6.3).
// Co parser nepozná, nechá v `rawInstruction` a nahlásí; nic nedomýšlí.
import type { Block, IntensityRef, Load, Segment, WorkoutSpec, WorkoutType } from '@/domain/types';

export interface CellLine {
  text: string;
  /** Svislá poloha a výška řádku; slouží k rozpoznání prázdného řádku mezi skupinami. */
  y: number;
  h: number;
}

export interface ParsedCell {
  workout: WorkoutSpec;
  issues: string[];
}

/** Opraví typické záměny OCR v číselných údajích („1Ok“, „Sk“, „lkm“). Nic nepřidává. */
export function normalizeLine(raw: string): string {
  let s = raw.replace(/[|\[\]{}]/g, ' ').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.,:;'`*_~-]+\s*/, '').replace(/\s*[.,:;'`_~]+$/, '');
  if (/^[*+]\s*$/.test(s)) return '+';
  s = s.replace(/(^|\s)(\+?)([0-9OolISB]{1,3})(k|km|x|m|s)(?=$|\s)/g, (all, pre: string, plus: string, digits: string, unit: string) => {
    const fixed = digits.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    return /^\d+$/.test(fixed) ? `${pre}${plus}${fixed}${unit}` : all;
  });
  return s;
}

const TITLE_TYPES: Array<[RegExp, WorkoutType]> = [
  [/rest|volno/i, 'rest'],
  [/race|závod|marathon(?!\s*pace)/i, 'race'],
  [/long/i, 'long'],
  [/speed|interval|track|hill/i, 'speed'],
  [/tempo|threshold|progression/i, 'tempo'],
  [/easy|recovery/i, 'easy'],
  [/strength/i, 'strength'],
  [/cross/i, 'cross'],
];

function intensityOf(text: string): IntensityRef | null {
  const t = text.toLowerCase();
  if (/walk/.test(t)) return 'walk';
  if (/\bhm\b|half/.test(t)) return 'hm_pace';
  if (/10\s*k/.test(t)) return '10k_pace';
  if (/5\s*k/.test(t)) return '5k_pace';
  if (/marathon|\bmp\b/.test(t)) return 'mp';
  if (/steady/.test(t)) return 'steady';
  if (/easy|jog|recovery/.test(t)) return 'easy';
  if (/stride/.test(t)) return 'strides';
  return null;
}

const AMOUNT = /^(\d+(?:[.,]\d+)?)\s*(mins?|minutes?|secs?|seconds?|s|km|k|m|miles?|mi)\b\s*(?:at\s+|@\s*)?(.*)$/i;

function amountOf(value: string, unit: string): Pick<Segment, 'durationSec' | 'distanceM'> | null {
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = unit.toLowerCase();
  if (u.startsWith('min')) return { durationSec: Math.round(n * 60) };
  if (u === 's' || u.startsWith('sec')) return { durationSec: Math.round(n) };
  if (u === 'k' || u === 'km') return { distanceM: Math.round(n * 1000) };
  if (u === 'm') return { distanceM: Math.round(n) };
  if (u.startsWith('mi')) return { distanceM: Math.round(n * 1609.344) };
  return null;
}

function parseSegment(line: string): Segment | null {
  const m = AMOUNT.exec(line);
  if (!m) return null;
  const amount = amountOf(m[1], m[2]);
  const intensity = intensityOf(m[3]);
  if (!amount || !intensity) return null;
  return { role: 'steady', ...amount, intensity };
}

/** Řádky rozdělí do skupin podle prázdného místa mezi nimi. */
function groupLines(lines: CellLine[]): string[][] {
  const groups: string[][] = [];
  let prev: CellLine | undefined;
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const text = normalizeLine(l.text);
    if (!text) continue;
    const gap = prev ? l.y - (prev.y + prev.h) : 0;
    if (!prev || gap > Math.max(prev.h, l.h) * 0.75) groups.push([text]);
    else groups[groups.length - 1].push(text);
    prev = l;
  }
  return groups;
}

export function parseCell(lines: CellLine[], load?: Load): ParsedCell {
  const issues: string[] = [];
  const groups = groupLines(lines);
  const flat = groups.flat();
  const raw = flat.join('\n');
  if (flat.length === 0) {
    return { workout: { type: 'other', title: 'Nečitelná buňka', blocks: [], load, rawInstruction: '' }, issues: ['Buňku se nepodařilo přečíst.'] };
  }

  // Název: úvodní řádky bez číslic.
  const titleLines: string[] = [];
  const body: string[][] = [];
  let inTitle = true;
  for (const g of groups) {
    const rest: string[] = [];
    for (const line of g) {
      if (inTitle && !/\d/.test(line) && !/^(\+|as)$/i.test(line) && titleLines.length < 3) titleLines.push(line);
      else { inTitle = false; rest.push(line); }
    }
    if (rest.length) body.push(rest);
    if (titleLines.length) inTitle = inTitle && rest.length === 0 && titleLines.join(' ').length < 12;
  }
  const title = titleLines.join(' ').replace(/\s+/g, ' ').replace(/[!.]+$/, '').trim() || 'Trénink';
  const type = TITLE_TYPES.find(([re]) => re.test(title))?.[1] ?? 'other';
  if (type === 'other') issues.push(`Neznámý typ jednotky „${title}“.`);

  const workout: WorkoutSpec = { type, title, blocks: [], rawInstruction: raw, load: load ?? (type === 'rest' ? 'rest' : undefined) };
  if (type === 'rest') return { workout, issues };

  const unknown: string[] = [];
  const blocks: Block[] = [];
  // Mezery v grafice PDF nerozdělují význam opakování. Pracovní úsek i pauza
  // mohou ležet v různých skupinách OCR; čteme je v jednom pořadí.
  for (const group of [body.flat()]) {
    // „Pace“ na samostatném řádku patří k předchozímu.
    const lines2: string[] = [];
    for (const l of group.flatMap(line => line.split(/\s*\+\s*|\s*;\s*/).filter(Boolean))) {
      if (/^pace$/i.test(l) && lines2.length) lines2[lines2.length - 1] += ' Pace';
      else {
        // Podporujeme i „6×400m at 5k Pace“ na jediném řádku.
        const inlineRepeat = /^(\d+)\s*[x×]\s*(\d.+)$/i.exec(l);
        if (inlineRepeat && !/strides?/i.test(l)) lines2.push(`${inlineRepeat[1]}x`, inlineRepeat[2]);
        else lines2.push(l.replace(/^(\d+)\s*×\s*$/, '$1x'));
      }
    }
    // Spojit zalomené segmenty ještě před hledáním opakování, aby je četl
    // správně i lookahead pracovního úseku a jeho regenerace.
    for (let j = 0; j < lines2.length - 1; j++) {
      if (!parseSegment(lines2[j]) && !parseSegment(lines2[j + 1]) && parseSegment(`${lines2[j]} ${lines2[j + 1]}`)) {
        lines2.splice(j, 2, `${lines2[j]} ${lines2[j + 1]}`);
      }
    }
    for (let j = 0; j < lines2.length; j++) {
      for (let count = 1; count <= 3; count++) {
        const strength = /^strength\s*training\s*(\d+)\s*mins?$/i.exec(lines2.slice(j, j + count).join(' '));
        if (strength) { workout.strengthMin = Number(strength[1]); lines2.splice(j, count); j--; break; }
      }
    }

    for (let i = 0; i < lines2.length; i++) {
      const line = lines2[i];
      if (/^(\+|as|and|&)$/i.test(line)) continue;
      if (/^all\s+easy$/i.test(line)) continue;
      const strides = /^\+?\s*(\d+)\s*x\s*(\d+)\s*s(?:ecs?)?\s*strides?/i.exec(line);
      if (strides) { blocks.push({ kind: 'strides', count: Number(strides[1]), durationSec: Number(strides[2]) }); continue; }
      const total = /^(\d+(?:[.,]\d+)?)\s*(k|km|miles?|mi)$/i.exec(line);
      if (total && workout.distanceM == null && blocks.length === 0) {
        workout.distanceM = amountOf(total[1], total[2])!.distanceM;
        continue;
      }
      const bare = /^(\d+)\s*(mins?|minutes?)$/i.exec(line);
      if (bare && workout.durationSec == null && blocks.length === 0) { workout.durationSec = Number(bare[1]) * 60; continue; }
      const rep = /^(\d+)\s*x$/i.exec(line);
      if (rep) {
        const work = lines2[i + 1] ? parseSegment(lines2[i + 1]) : null;
        if (!work) { unknown.push(line); continue; }
        // Opakování může mít víc rychlých úseků za sebou; pauza je až poslední volný úsek nebo chůze.
        const more: Segment[] = [];
        let recovery: Segment | undefined;
        let used = 1;
        for (let j = i + 2; j < lines2.length; j++) {
          const s2 = parseSegment(lines2[j]);
          if (!s2) break;
          used += 1;
          if (s2.intensity === 'walk' || s2.intensity === 'easy') { recovery = { ...s2, role: 'recovery' }; break; }
          more.push({ ...s2, role: 'work' });
        }
        blocks.push({
          kind: 'repeat',
          count: Number(rep[1]),
          work: { ...work, role: 'work' },
          more: more.length ? more : undefined,
          recovery,
          // Dokument neříká, jestli je pauza i po posledním úseku.
          recoveryAfterLast: null,
        });
        i += used;
        continue;
      }
      const seg = parseSegment(line);
      if (seg) { blocks.push({ kind: 'segment', ...seg }); continue; }
      unknown.push(line);
    }
  }

  // Role: volný úsek před prvním a za posledním rychlým blokem je rozklus a výklus.
  const fast = (b: Block) => b.kind === 'repeat' || (b.kind === 'segment' && b.intensity !== 'easy' && b.intensity !== 'walk');
  const firstFast = blocks.findIndex(fast);
  const lastFast = blocks.length - 1 - [...blocks].reverse().findIndex(fast);
  blocks.forEach((b, i) => {
    if (b.kind !== 'segment') return;
    if (fast(b)) b.role = 'work';
    else if (firstFast >= 0 && type !== 'long') b.role = i < firstFast ? 'warmup' : i > lastFast ? 'cooldown' : 'recovery';
  });
  workout.blocks = blocks;

  if (unknown.length) {
    workout.rawInstruction = raw;
    issues.push(`Nerozpoznaný text: ${unknown.map((u) => `„${u}“`).join(', ')}`);
  }
  if (workout.distanceM == null && workout.durationSec == null && blocks.length === 0 && !workout.strengthMin && type !== 'strength' && type !== 'race') {
    workout.rawInstruction = raw;
    issues.push('Jednotka nemá čitelnou délku ani obsah.');
  }
  if (type === 'long' && workout.distanceM != null) {
    const parts = blocks.reduce((a, b) => a + (b.kind === 'segment' ? (b.distanceM ?? 0) : 0), 0);
    if (parts > 0 && Math.abs(parts - workout.distanceM) > 500) issues.push('Součet úseků neodpovídá celkové délce běhu.');
  }
  return { workout, issues };
}

const LOADS: Load[] = ['rest', 'low', 'medium', 'high'];

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function parseLoad(text: string): Load | null {
  const t = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  const best = LOADS.map((l) => ({ l, d: editDistance(t, l) })).sort((a, b) => a.d - b.d)[0];
  return best.d <= (best.l.length > 4 ? 2 : 1) ? best.l : null;
}

export function parseLeftCell(text: string): { phase?: string; totalM?: number; totalMaxM?: number } {
  const t = text.replace(/[|]/g, ' ').replace(/\s+/g, ' ');
  const phase = /PHASE\s+([A-Za-z]{3,})/i.exec(t)?.[1];
  const total = /TOTAL\s+([0-9OolIS]{1,3})(?:\s*[-–]\s*([0-9OolIS]{1,3}))?\s*(k|km|mi|miles?)?/i.exec(t);
  const fix = (s: string) => Number(s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5'));
  const unit = total?.[3]?.toLowerCase().startsWith('mi') ? 1609.344 : 1000;
  return {
    phase: phase && !/^total$/i.test(phase) ? phase.toUpperCase() : undefined,
    totalM: total ? Math.round(fix(total[1]) * unit) : undefined,
    totalMaxM: total?.[2] ? Math.round(fix(total[2]) * unit) : undefined,
  };
}
