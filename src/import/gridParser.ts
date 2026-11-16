// Rekonstrukce týdenní tabulky „dny ve sloupcích“ z vykreslené stránky (§6.1).
// Záměrně jeden rozpoznaný formát; jiná struktura skončí hláškou, ne tichým převzetím (IMP-02, G4).
import type { Dow, Load, SourceRef, TemplateDay, TemplateWeek } from '@/domain/types';
import { parseCell, parseLeftCell, parseLoad, type CellLine } from './cellParser';

export interface Raster {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8ClampedArray;
}

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  /** Identifikátor řádku z OCR. */
  line: string;
}

/** `page` = automatické členění, `block` = jeden blok textu, `line` = jediný řádek. */
export type OcrFn = (image: Raster, mode: 'page' | 'block' | 'line') => Promise<OcrWord[]>;

/** Slova celé stránky dvěma způsoby členění; jedno samotné občas vynechá hlavičku týdne. */
export async function pageWords(image: Raster, ocr: OcrFn): Promise<OcrWord[]> {
  return [...(await ocr(image, 'page')), ...(await ocr(image, 'block'))];
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface ParsedPage {
  page: number;
  units: 'km' | 'mi' | null;
  weeks: TemplateWeek[];
  issues: string[];
}

const WEEKDAYS: Array<[RegExp, Dow]> = [
  [/^(MON(DAY)?|PONDELI|PO)$/, 0],
  [/^(TUE(SDAY)?|UTERY|UT)$/, 1],
  [/^(WED(NESDAY)?|STREDA|ST)$/, 2],
  [/^(THU(RSDAY)?|CTVRTEK|CT)$/, 3],
  [/^(FRI(DAY)?|PATEK|PA)$/, 4],
  [/^(SAT(URDAY)?|SOBOTA|SO)$/, 5],
  [/^(SUN(DAY)?|NEDELE|NE)$/, 6],
];
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const weekdayOf = (w: OcrWord): Dow | null => {
  const t = plain(w.text);
  if (t.length < 3) return null;
  return WEEKDAYS.find(([re]) => re.test(t))?.[1] ?? null;
};

export function crop(src: Raster, r: Rect): Raster {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const w = Math.max(1, Math.min(src.width - x0, Math.round(r.w)));
  const h = Math.max(1, Math.min(src.height - y0, Math.round(r.h)));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * src.width + x0) * 4;
    data.set(src.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/** Text na barevném podkladu → černý na bílém. Zvolí se ta polarita (tmavý/světlý text), která dává rozumný podíl „inkoustu“. */
export function textMask(src: Raster): Raster {
  const n = src.data.length / 4;
  let dark = 0;
  let light = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    if (Math.max(src.data[i], src.data[i + 1], src.data[i + 2]) < 110) dark += 1;
    else if (Math.min(src.data[i], src.data[i + 1], src.data[i + 2]) > 200) light += 1;
  }
  const ok = (c: number) => c / n > 0.01 && c / n < 0.4;
  const useDark = ok(dark) || !ok(light);
  const data = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const ink = useDark
      ? Math.max(src.data[i], src.data[i + 1], src.data[i + 2]) < 110
      : Math.min(src.data[i], src.data[i + 1], src.data[i + 2]) > 200;
    data[i] = data[i + 1] = data[i + 2] = ink ? 0 : 255;
    data[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data };
}

/** Rozdělí slovo na znaky podle svislých mezer v inkoustu. */
function columnBlobs(img: Raster, r: Rect): Array<{ x: number; w: number }> {
  const blobs: Array<{ x: number; w: number }> = [];
  let start = -1;
  const x0 = Math.max(0, Math.round(r.x) - 1);
  const x1 = Math.min(img.width - 1, Math.round(r.x + r.w) + 1);
  for (let x = x0; x <= x1 + 1; x++) {
    let ink = false;
    if (x <= x1)
      for (let y = Math.round(r.y); y <= Math.round(r.y + r.h) && !ink; y++) {
        const i = (Math.min(img.height - 1, Math.max(0, y)) * img.width + x) * 4;
        ink = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) < 140;
      }
    if (ink && start < 0) start = x;
    if (!ink && start >= 0) { blobs.push({ x: start, w: x - start }); start = -1; }
  }
  return blobs;
}

/**
 * Kontrola čísel typu „11k“ podle počtu a šířky znaků. Některé fonty mají úzkou jedničku,
 * kterou OCR slévá nebo vynechá („11k“ → „Tk“, „71k“ → „7k“). Opravené číslo se hlásí k ruční kontrole.
 */
export function repairNumericWord(img: Raster, abs: Rect, text: string): { text: string; state: 'same' | 'repaired' | 'unclear' } {
  const m = /^(\+?)([0-9TIlOS|]*)(km|k)$/.exec(text);
  if (!m) return { text, state: 'same' };
  const real = m[2].replace(/O/g, '0').replace(/S/g, '5').replace(/[^0-9]/g, '');
  const blobs = columnBlobs(img, abs);
  const digits = blobs.length - m[3].length - (m[1] ? 1 : 0);
  // Čistě přečtené číslo se nezpochybňuje jen proto, že se znaky dotýkají.
  if (real.length === m[2].length && real.length > 0 && digits <= real.length) return { text, state: 'same' };
  if (digits < 1 || digits > 3) return { text, state: 'unclear' };
  const digitBlobs = blobs.slice(m[1] ? 1 : 0, (m[1] ? 1 : 0) + digits);
  const unit = blobs.slice(-m[3].length).map((b) => b.w).sort((a, b) => a - b)[0];
  const narrow = digitBlobs.map((b) => b.w < unit * 0.62);
  const others = real.replace(/1/g, '');
  if (narrow.filter((x) => !x).length !== others.length) return { text, state: 'unclear' };
  let k = 0;
  return { text: `${m[1]}${narrow.map((x) => (x ? '1' : others[k++])).join('')}${m[3]}`, state: 'repaired' };
}

function pixel(r: Raster, x: number, y: number): [number, number, number] {
  const i = (Math.min(r.height - 1, Math.max(0, Math.round(y))) * r.width + Math.min(r.width - 1, Math.max(0, Math.round(x)))) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
}
const isColored = ([r, g, b]: [number, number, number]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 110 && max - min > 60;
};
const isLight = ([r, g, b]: [number, number, number]) => Math.min(r, g, b) > 170;

function hueOf(r: Raster, rect: Rect): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const [R, G, B] = pixel(r, rect.x + (rect.w * (i + 0.5)) / 40, rect.y + rect.h * 0.2);
    if (!isColored([R, G, B])) continue;
    const max = Math.max(R, G, B);
    const d = max - Math.min(R, G, B);
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    sx += Math.cos((h * Math.PI) / 3);
    sy += Math.sin((h * Math.PI) / 3);
    n += 1;
  }
  return n < 10 ? null : ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
}

interface Header {
  y: number;
  bottom: number;
  weekIndex: number | null;
  /** Střed sloupce pondělí a šířka sloupce. */
  origin: number;
  colW: number;
  leftX: number;
}

function findHeaders(words: OcrWord[]): Header[] {
  const days = words.map((w) => ({ w, dow: weekdayOf(w) })).filter((d): d is { w: OcrWord; dow: Dow } => d.dow != null);
  const rows: Array<{ y: number; items: typeof days }> = [];
  for (const d of days.sort((a, b) => a.w.y - b.w.y)) {
    const row = rows.find((r) => Math.abs(r.y - d.w.y) < d.w.h * 1.2);
    if (row) row.items.push(d);
    else rows.push({ y: d.w.y, items: [d] });
  }
  const headers: Header[] = [];
  for (const row of rows) {
    const distinct = new Map(row.items.map((d) => [d.dow, d.w]));
    if (distinct.size < 5) continue;
    // Střed sloupce = a + b·den; přímka proložená nalezenými dny.
    const pts = [...distinct].map(([dow, w]) => ({ x: dow as number, c: w.x + w.w / 2 }));
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const mc = pts.reduce((a, p) => a + p.c, 0) / pts.length;
    const colW = pts.reduce((a, p) => a + (p.x - mx) * (p.c - mc), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const origin = mc - colW * mx;
    if (!(colW > 20)) continue;
    const h = Math.max(...row.items.map((d) => d.w.h));
    const monLeft = origin - colW / 2;
    const label = words
      .filter((w) => Math.abs(w.y - row.y) < h * 1.2 && w.x + w.w < monLeft + colW * 0.1)
      .sort((a, b) => a.x - b.x);
    const digits = /(\d{1,2})/.exec(label.map((w) => w.text).join(' ').replace(/WEEK|TYDEN|TÝDEN/gi, ''))?.[1];
    headers.push({
      y: row.y,
      bottom: row.y + h,
      weekIndex: digits ? Number(digits) : null,
      origin,
      colW,
      leftX: label.length ? Math.max(0, Math.min(...label.map((w) => w.x)) - colW * 0.12) : Math.max(0, monLeft - colW * 0.65),
    });
  }
  return headers.sort((a, b) => a.y - b.y);
}

/** Najde vodorovný barevný pruh (řádek zátěže) mezi `from` a `to`. */
function findColorBand(img: Raster, h: Header, from: number, to: number): { top: number; bottom: number } | null {
  let start = -1;
  const minRun = Math.max(6, (h.bottom - h.y) * 0.5);
  for (let y = Math.round(from); y < to; y++) {
    let cols = 0;
    for (let d = 0; d < 7; d++) {
      let hit = 0;
      for (let k = 0; k < 9; k++) if (isColored(pixel(img, h.origin + d * h.colW + ((k - 4) / 9) * h.colW * 0.8, y))) hit += 1;
      if (hit >= 6) cols += 1;
    }
    if (cols >= 5) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start >= minRun) return { top: start, bottom: y };
      start = -1;
    }
  }
  return null;
}

function headerBottom(img: Raster, h: Header): number {
  for (let y = Math.round(h.bottom); y < h.bottom + (h.bottom - h.y) * 3; y++) {
    let light = 0;
    for (let d = 0; d < 7; d++) if (isLight(pixel(img, h.origin + d * h.colW - h.colW * 0.3, y))) light += 1;
    if (light >= 5) return y;
  }
  return h.bottom + (h.bottom - h.y) * 0.5;
}

function toLines(words: OcrWord[], offset: { x: number; y: number }): Array<CellLine & { conf: number }> {
  const groups = new Map<string, OcrWord[]>();
  for (const w of words) groups.set(w.line, [...(groups.get(w.line) ?? []), w]);
  return [...groups.values()].map((ws) => {
    ws.sort((a, b) => a.x - b.x);
    const top = Math.min(...ws.map((w) => w.y));
    return {
      text: ws.map((w) => w.text).join(' '),
      y: top + offset.y,
      h: Math.max(...ws.map((w) => w.y + w.h)) - top,
      conf: ws.reduce((a, w) => a + w.conf, 0) / ws.length,
    };
  });
}

function repairWords(image: Raster, rect: Rect, words: OcrWord[]): { repaired: string[]; unclear: string[] } {
  const repaired: string[] = [];
  const unclear: string[] = [];
  for (const w of words) {
    const fixed = repairNumericWord(image, { x: rect.x + w.x, y: rect.y + w.y, w: w.w, h: w.h }, w.text);
    if (fixed.state === 'repaired') { repaired.push(`${w.text} → ${fixed.text}`); w.text = fixed.text; }
    else if (fixed.state === 'unclear') unclear.push(w.text);
  }
  return { repaired, unclear };
}

function detectUnits(words: OcrWord[], firstHeaderY: number): 'km' | 'mi' | null {
  const top = plain(words.filter((w) => w.y < firstHeaderY).map((w) => w.text).join(''));
  if (top.includes('MILES')) return 'mi';
  if (/KM|KILOMET/.test(top)) return 'km';
  return null;
}

/** Rychlá kontrola bez čtení buněk: kolik týdnů stránka má a v jakých jednotkách. */
export function inspectPage(words: OcrWord[]): { weeks: number; units: 'km' | 'mi' | null } {
  const headers = findHeaders(words);
  return { weeks: headers.length, units: headers.length ? detectUnits(words, headers[0].y) : null };
}

export interface ParsePageOptions {
  page: number;
  image: Raster;
  /** Slova z textové vrstvy nebo ze stránkového OCR. */
  words: OcrWord[];
  /** Původní text PDF, oddělený od OCR, aby se čísla zbytečně nečetla z obrázku. */
  textWords?: OcrWord[];
  ocr: OcrFn;
  onStep?: (label: string) => void;
}

export async function parsePlanPage({ page, image, words, textWords = [], ocr, onStep }: ParsePageOptions): Promise<ParsedPage> {
  const headers = findHeaders(words);
  const out: ParsedPage = { page, units: null, weeks: [], issues: [] };
  if (headers.length === 0) return out;
  out.units = detectUnits(words, headers[0].y);
  const DOW_NAMES = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1];
    const limit = next ? next.y - (h.bottom - h.y) * 0.4 : image.height;
    const top = headerBottom(image, h);
    const band = findColorBand(image, h, top + 10, limit);
    const cellsBottom = band ? band.top : next ? limit : Math.min(limit, top + (limit - top) * 0.6);
    const inset = Math.max(3, h.colW * 0.015);
    const monLeft = h.origin - h.colW / 2;
    const weekIssues: string[] = [];
    const label = h.weekIndex ?? `${i + 1}. na stránce`;
    if (!band) weekIssues.push('Řádek se zátěží nebyl nalezen.');

    // Zátěž: jeden pruh, slova se přiřadí sloupcům podle polohy.
    const loads: Array<Load | null> = Array(7).fill(null);
    const hues: Array<number | null> = Array(7).fill(null);
    if (band) {
      onStep?.(`Týden ${label}: zátěž`);
      const rect = { x: monLeft, y: band.top, w: h.colW * 7, h: band.bottom - band.top };
      const found = await ocr(textMask(crop(image, rect)), 'line');
      for (const w of found) {
        const d = Math.floor((w.x + w.w / 2) / h.colW);
        if (d >= 0 && d < 7) loads[d] = parseLoad(w.text) ?? loads[d];
      }
      for (let d = 0; d < 7; d++) hues[d] = hueOf(image, { x: monLeft + d * h.colW + inset, y: band.top, w: h.colW - 2 * inset, h: band.bottom - band.top });
      // Legenda z dokumentu samotného: barva přečtených buněk doplní nepřečtené.
      for (let d = 0; d < 7; d++) {
        if (loads[d] || hues[d] == null) continue;
        const twin = loads.findIndex((l, k) => l && hues[k] != null && Math.min(Math.abs(hues[k]! - hues[d]!), 360 - Math.abs(hues[k]! - hues[d]!)) < 12);
        if (twin >= 0) loads[d] = loads[twin];
      }
    }

    const days: TemplateDay[] = [];
    for (let d = 0; d < 7; d++) {
      onStep?.(`Týden ${label}: ${DOW_NAMES[d]}`);
      const rect = { x: monLeft + d * h.colW + inset, y: top + inset, w: h.colW - 2 * inset, h: cellsBottom - top - 2 * inset };
      const native = textWords.filter(w => w.x + w.w / 2 >= rect.x && w.x + w.w / 2 <= rect.x + rect.w && w.y + w.h / 2 >= rect.y && w.y + w.h / 2 <= rect.y + rect.h)
        .map(w => ({ ...w, x: w.x - rect.x, y: w.y - rect.y }));
      // PDF text items nejsou vždy celé řádky. Zarovnat podle skutečné svislé polohy.
      const rows: OcrWord[][] = [];
      for (const w of [...native].sort((a, b) => a.y - b.y)) {
        const row = rows.find(r => Math.abs(r[0].y - w.y) < Math.max(r[0].h, w.h) * 0.45);
        if (row) row.push(w); else rows.push([w]);
      }
      rows.forEach((row, n) => row.forEach(w => { w.line = `pdf${n}`; }));
      const nativeLines = toLines(native, rect);
      const nativeParsed = parseCell(nativeLines, loads[d] ?? undefined);
      const useNative = native.length > 0 && nativeParsed.issues.length === 0;
      const found = useNative ? native : (await ocr(crop(image, rect), 'block')).filter(w => w.text.trim());
      const numeric = useNative ? { repaired: [], unclear: [] } : repairWords(image, rect, found);
      const lines = useNative ? nativeLines : toLines(found, rect);
      const parsed = useNative ? nativeParsed : parseCell(lines, loads[d] ?? undefined);
      const conf = lines.length ? lines.reduce((a, l) => a + l.conf, 0) / lines.length : 0;
      const issues = [...parsed.issues];
      if (numeric.repaired.length) issues.push(`Číslo doplněné podle tvaru znaků, zkontroluj: ${numeric.repaired.join(', ')}.`);
      if (numeric.unclear.length) issues.push(`Nejisté číslo: ${numeric.unclear.join(', ')}.`);
      if (band && !loads[d]) issues.push('Zátěž se nepodařilo přečíst.');
      if (lines.some((l) => l.conf < 60) && issues.length === 0) issues.push('Nižší jistota čtení, zkontroluj proti originálu.');
      const source: SourceRef = {
        method: useNative ? 'pdf_text' : 'ocr',
        page,
        bbox: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)],
        confidence: Math.round(conf),
        review: 'unreviewed',
        issues,
      };
      days.push({ dow: d as Dow, workout: parsed.workout, source });
    }

    onStep?.(`Týden ${label}: fáze a poznámky`);
    const leftRect = { x: h.leftX, y: top + inset, w: monLeft - h.leftX - inset, h: cellsBottom - top - 2 * inset };
    const leftWords = await ocr(crop(image, leftRect), 'block');
    const leftFix = repairWords(image, leftRect, leftWords);
    const left = parseLeftCell(leftWords.map((w) => w.text).join(' '));
    if (leftFix.repaired.length) weekIssues.push(`Součet týdne doplněný podle tvaru znaků, zkontroluj: ${leftFix.repaired.join(', ')}.`);
    if (leftFix.unclear.length) weekIssues.push(`Nejistý součet týdne: ${leftFix.unclear.join(', ')}.`);
    let weekIndex = h.weekIndex;
    if (weekIndex == null) {
      // Číslo týdne se ze stránkového OCR často ztratí; výřez hlavičky ho čte spolehlivěji.
      const hr = { x: h.leftX, y: h.y - (h.bottom - h.y) * 0.5, w: monLeft - h.leftX, h: (h.bottom - h.y) * 2 };
      const digits = /(\d{1,2})/.exec((await ocr(textMask(crop(image, hr)), 'line')).map((w) => w.text).join(' '))?.[1];
      if (digits) weekIndex = Number(digits);
    }
    const expected = out.weeks.length ? out.weeks[out.weeks.length - 1].index + 1 : null;
    if (weekIndex == null) {
      weekIndex = expected ?? i + 1;
      weekIssues.push('Číslo týdne se nepodařilo přečíst, je odvozené z pořadí.');
    } else if (expected != null && weekIndex !== expected) {
      // Týdny na stránce jdou po sobě; osamocená odchylka je chyba čtení („11“ → „1“).
      weekIssues.push(`Číslo týdne přečteno jako ${weekIndex}, podle pořadí na stránce je to ${expected}.`);
      weekIndex = expected;
    }
    if (left.totalM == null) weekIssues.push('Deklarovaný součet týdne se nepodařilo přečíst.');

    let note: string | undefined;
    if (band) {
      // Poznámky končí u další hlavičky, nebo tam, kde pod tabulkou přestává souvislý text.
      let bottom = limit;
      if (!next) {
        const below = words.filter((w) => w.y > band.bottom && w.x > monLeft).sort((a, b) => a.y - b.y);
        let last = band.bottom;
        for (const w of below) {
          if (w.y - last > w.h * 3) break;
          last = Math.max(last, w.y + w.h);
        }
        bottom = last + inset * 2;
      }
      if (bottom - band.bottom > (h.bottom - h.y) * 1.2) {
        const noteRect = { x: monLeft + inset, y: band.bottom + inset, w: h.colW * 7 - 2 * inset, h: bottom - band.bottom - 2 * inset };
        const noteLines = toLines(await ocr(crop(image, noteRect), 'block'), { x: 0, y: 0 }).sort((a, b) => a.y - b.y);
        note = noteLines.map((l) => l.text.replace(/^\|\s*/, '')).join(' ').replace(/\s+/g, ' ').trim() || undefined;
      }
    }

    const week: TemplateWeek & { issues?: string[] } = { index: weekIndex, phase: left.phase, declaredTotalM: left.totalM, declaredTotalMaxM: left.totalMaxM, note, days };
    out.weeks.push(week);
    out.issues.push(...weekIssues.map((m) => `Týden ${weekIndex}: ${m}`));
  }
  return out;
}

export interface ImportResult {
  weeks: TemplateWeek[];
  units: 'km' | 'mi';
  /** Jednotkové varianty téhož plánu, které se nepoužily (míle vs. km nejsou další týdny). */
  alternativeUnits: Array<'km' | 'mi'>;
  issues: string[];
}

/** Spojí stránky; míle a kilometry stejného plánu jsou alternativy, ne dvojnásobek týdnů (IMP-01). */
export function mergePages(pages: ParsedPage[], prefer: 'km' | 'mi' = 'km'): ImportResult {
  const withWeeks = pages.filter((p) => p.weeks.length > 0);
  const variants = new Set(withWeeks.map((p) => p.units ?? 'unknown'));
  const issues = pages.flatMap((p) => p.issues);
  let chosen = withWeeks;
  let units: 'km' | 'mi' = prefer;
  const alternativeUnits: Array<'km' | 'mi'> = [];
  if (variants.has('km') && variants.has('mi')) {
    chosen = withWeeks.filter((p) => p.units === prefer);
    alternativeUnits.push(prefer === 'km' ? 'mi' : 'km');
  } else if (variants.has('mi')) units = 'mi';
  else if (variants.has('km')) units = 'km';
  else if (withWeeks.length) issues.push('Jednotky plánu (km/míle) se nepodařilo určit; počítám s kilometry.');

  const byIndex = new Map<number, TemplateWeek>();
  for (const p of chosen)
    for (const w of p.weeks) {
      if (byIndex.has(w.index)) issues.push(`Týden ${w.index} je v dokumentu dvakrát; ponechán první výskyt.`);
      else byIndex.set(w.index, w);
    }
  const weeks = [...byIndex.values()].sort((a, b) => a.index - b.index);
  for (let i = 1; i < weeks.length; i++) if (weeks[i].index !== weeks[i - 1].index + 1) issues.push(`Mezi týdny ${weeks[i - 1].index} a ${weeks[i].index} něco chybí.`);
  return { weeks, units, alternativeUnits, issues };
}

/** Kontrola součtu proti údaji autora. Časem zadané jednotky součet neslibují, proto se nevynucuje. */
export function weekSumCheck(week: TemplateWeek): { state: 'ok' | 'mismatch' | 'unverifiable' | 'none'; sumM: number; timeBased: number } {
  let sumM = 0;
  let timeBased = 0;
  for (const d of week.days) {
    if (d.workout.type === 'rest' || d.workout.type === 'strength') continue;
    if (d.workout.distanceM != null) sumM += d.workout.distanceM;
    else timeBased += 1;
  }
  if (week.declaredTotalM == null) return { state: 'none', sumM, timeBased };
  if (timeBased > 0) return { state: sumM <= (week.declaredTotalMaxM ?? week.declaredTotalM) ? 'unverifiable' : 'mismatch', sumM, timeBased };
  const max = week.declaredTotalMaxM ?? week.declaredTotalM;
  return { state: sumM >= week.declaredTotalM - 2000 && sumM <= max + 2000 ? 'ok' : 'mismatch', sumM, timeBased };
}
