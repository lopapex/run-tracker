import type { PaceChart } from '@/domain/types';
import type { OcrWord } from './gridParser';
export interface PaceOption { goalLabel: string; goalTimeSec: number; chart: PaceChart; page: number; units: 'km' | 'mi' }
/** Vyžaduje hlavičku jednotek a úplný řádek Goal / Easy / HM / 10k / 5k. */
export function parsePaceOptions(words: OcrWord[], page: number): PaceOption[] {
  const rows: OcrWord[][] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r[0].y - word.y) < Math.max(r[0].h, word.h) * .45);
    if (row) row.push(word); else rows.push([word]);
  }
  let units: 'km' | 'mi' | null = null;
  const result: PaceOption[] = [];
  for (const row of rows) {
    const text = row.sort((a, b) => a.x - b.x).map(w => w.text).join(' ').replace(/[|]/g, ' ').trim()
      .replace(/\b(\d)(\d{2})\s*[-–—]\s*(\d)(\d{2})\b/g, '$1:$2-$3:$4');
    if (/pac(e|ing)/i.test(text) && /min/i.test(text)) {
      units = /\bkm\b|kilomet/i.test(text) ? 'km' : /mile/i.test(text) ? 'mi' : null;
      continue;
    }
    if (!units) continue;
    const goal = /^\s*(\d)\s*h\s*(\d{2})\b/i.exec(text);
    if (!goal || Number(goal[2]) >= 60) continue;
    const ranges = [...text.matchAll(/(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–—]\s*(\d{1,2})\s*[:.]\s*(\d{2})/g)];
    if (ranges.length !== 4) continue;
    const chart: PaceChart = {};
    let valid = true;
    const keys = ['easy', 'hm_pace', '10k_pace', '5k_pace'] as const;
    ranges.forEach((r, i) => {
      const factor = units === 'mi' ? 1 / 1.609344 : 1;
      const fromSec = Math.round((Number(r[1]) * 60 + Number(r[2])) * factor);
      const toSec = Math.round((Number(r[3]) * 60 + Number(r[4])) * factor);
      if (Number(r[2]) >= 60 || Number(r[4]) >= 60 || fromSec < 120 || toSec > 900 || fromSec > toSec) valid = false;
      chart[keys[i]] = { fromSec, toSec };
    });
    if (valid) result.push({ goalLabel: `${goal[1]}:${goal[2]}`, goalTimeSec: Number(goal[1]) * 3600 + Number(goal[2]) * 60, chart, page, units });
  }
  return result;
}
