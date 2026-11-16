// Lokální importní pipeline v prohlížeči (§6.1): PDF.js vykreslí stránku, Tesseract.js čte text.
// Nic se nikam neodesílá. Stránky se zpracují po jedné a bitmapy se hned uvolňují.
import { inspectPage, mergePages, parsePlanPage, type ImportResult, type OcrFn, type OcrWord, type ParsedPage, type Raster } from './gridParser';
import { parsePaceOptions, type PaceOption } from './paceParser';

export interface ImportOutput {
  result: ImportResult;
  /** Náhledy zpracovaných stránek pro kontrolu proti originálu (číslo stránky → URL obrázku). */
  previews: Map<number, { url: string; width: number; height: number }>;
  pagesTotal: number;
  pagesRead: number[];
  paceOptions: PaceOption[];
}

const TARGET_WIDTH = 1800;
const VENDOR = '/vendor';

function toRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: id.data };
}

function toCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c;
}

async function previewOf(canvas: HTMLCanvasElement): Promise<{ url: string; width: number; height: number }> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  return { url: blob ? URL.createObjectURL(blob) : '', width: canvas.width, height: canvas.height };
}

async function createOcr(signal?: AbortSignal): Promise<{ ocr: OcrFn; close: () => Promise<void> }> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: `${VENDOR}/tesseract/worker.min.js`,
    corePath: `${VENDOR}/tesseract`,
    langPath: `${VENDOR}/tesseract/lang`,
  });
  const ocr: OcrFn = async (image, mode) => {
    if (signal?.aborted) throw new DOMException('Zrušeno','AbortError');
    await worker.setParameters({ tessedit_pageseg_mode: mode === 'page' ? PSM.AUTO : mode === 'block' ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE });
    const { data } = await worker.recognize(toCanvas(image), {}, { tsv: true });
    if (signal?.aborted) throw new DOMException('Zrušeno','AbortError');
    return (data.tsv ?? '')
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((c) => c[0] === '5' && c[11]?.trim())
      .map((c): OcrWord => ({ x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], text: c[11].trim(), line: `${c[2]}-${c[3]}-${c[4]}` }));
  };
  return { ocr, close: async () => void (await worker.terminate()) };
}

interface PageSource {
  page: number;
  /** Vykreslí stránku; volá se až ve chvíli, kdy je potřeba. */
  render: () => Promise<HTMLCanvasElement>;
  textWords: (scaleTo: HTMLCanvasElement) => Promise<OcrWord[]>;
  textItems: number;
}
interface SourceBundle { pages: PageSource[]; close: () => Promise<void> }

async function pdfSources(data: ArrayBuffer): Promise<SourceBundle> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const out: PageSource[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, TARGET_WIDTH / base.width);
    const text = await page.getTextContent();
    const items = text.items.filter((it) => 'str' in it && it.str.trim()) as Array<{ str: string; transform: number[]; width: number; height: number }>;
    out.push({
      page: p,
      textItems: items.length,
      render: async () => {
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d', { willReadFrequently: true })!, viewport: vp }).promise;
        return canvas;
      },
      textWords: async () =>
        items.flatMap((it, i) => {
          // Položka textové vrstvy může být víc slov; rozdělí se rovnoměrně podle délky.
          const words = it.str.trim().split(/\s+/);
          const total = it.str.trim().length || 1;
          let offset = 0;
          const y = (base.height - it.transform[5] - it.height) * scale;
          return words.map((w): OcrWord => {
            const x = (it.transform[4] + (it.width * offset) / total) * scale;
            offset += w.length + 1;
            return { text: w, x, y, w: ((it.width * w.length) / total) * scale, h: Math.max(8, it.height * scale), conf: 100, line: `t${i}` };
          });
        }),
    });
  }
  return { pages: out, close: async () => { await task.destroy(); } };
}

async function imageSource(file: Blob): Promise<SourceBundle> {
  const bitmap = await createImageBitmap(file);
  return { pages: [
    {
      page: 1,
      textItems: 0,
      render: async () => {
        const scale = Math.min(2, TARGET_WIDTH / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas;
      },
      textWords: async () => [],
    },
  ], close: async () => { bitmap.close(); } };
}

export async function importPlanFile(file: File, onStep: (label: string) => void, signal?: AbortSignal): Promise<ImportOutput> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  onStep('Otevírám soubor');
  const bundle = isPdf ? await pdfSources(await file.arrayBuffer()) : await imageSource(file);
  const sources = bundle.pages;
  onStep('Načítám čtení textu (OCR)');
  let reader: Awaited<ReturnType<typeof createOcr>>;
  try { reader = await createOcr(signal); } catch (error) { await bundle.close(); throw error; }
  const { ocr, close } = reader;
  const previews: ImportOutput['previews'] = new Map();
  const pagesRead: number[] = [];
  const paceOptions: PaceOption[] = [];
  let completed = false;

  try {
    // Průchod 1: najít stránky s týdenní tabulkou a jejich jednotky. Stránky se souvislým textem se přeskočí.
    const candidates: Array<{ src: PageSource; words: OcrWord[]; units: 'km' | 'mi' | null }> = [];
    for (const src of sources) {
      if (signal?.aborted) throw new DOMException('Zrušeno', 'AbortError');
      onStep(`Strana ${src.page} z ${sources.length}: hledám tabulku`);
      const canvas = await src.render();
      const image = toRaster(canvas);
      // Nejdřív textová vrstva; OCR celé stránky jen když v ní tabulka není (bývá vložená jako obrázek).
      let words = await src.textWords(canvas);
      if (inspectPage(words).weeks === 0) words = [...words, ...(await ocr(image, 'block'))];
      let probe = inspectPage(words);
      const paces = parsePaceOptions(words, src.page);
      if (paces.length) { paceOptions.push(...paces); previews.set(src.page, await previewOf(canvas)); }
      if (probe.weeks > 0 && probe.weeks < 6) {
        // Druhé členění stránky občas najde hlavičku týdne, kterou první vynechalo.
        words = [...words, ...(await ocr(image, 'page'))];
        probe = inspectPage(words);
      }
      canvas.width = canvas.height = 0;
      if (probe.weeks > 0) candidates.push({ src, words, units: probe.units });
    }

    // Míle a km jsou varianty téhož plánu; čte se jen jedna.
    const hasKm = candidates.some((c) => c.units === 'km');
    const hasMi = candidates.some((c) => c.units === 'mi');
    const chosen = hasKm && hasMi ? candidates.filter((c) => c.units === 'km') : candidates;

    const pages: ParsedPage[] = [];
    for (const c of chosen) {
      if (signal?.aborted) throw new DOMException('Zrušeno', 'AbortError');
      const canvas = await c.src.render();
      const image = toRaster(canvas);
      pages.push(await parsePlanPage({ page: c.src.page, image, words: c.words, textWords: await c.src.textWords(canvas), ocr, onStep: (l) => onStep(`Strana ${c.src.page}: ${l}`) }));
      previews.set(c.src.page, await previewOf(canvas));
      pagesRead.push(c.src.page);
      canvas.width = canvas.height = 0;
    }

    const result = mergePages(pages);
    if (hasKm && hasMi) result.alternativeUnits = ['mi'];
    if (result.weeks.length === 0) {
      result.issues.push('V souboru jsem nenašel týdenní tabulku se dny ve sloupcích. Jiné rozložení zatím neumím přečíst; týden můžeš zadat ručně.');
    }
    const byGoal = new Map<number, PaceOption>();
    for (const p of paceOptions) if (!byGoal.has(p.goalTimeSec) || p.units === 'km') byGoal.set(p.goalTimeSec, p);
    completed = true;
    return { result, previews, pagesTotal: sources.length, pagesRead, paceOptions: [...byGoal.values()].sort((a, b) => a.goalTimeSec - b.goalTimeSec) };
  } finally {
    try { await close(); } finally { await bundle.close(); }
    if (!completed) for (const p of previews.values()) URL.revokeObjectURL(p.url);
  }
}
