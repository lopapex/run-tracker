// Ověření parseru na soukromém referenčním dokumentu (příloha A zadání, IMP-01).
// Dokument není v repu. Spuštění:
//   node scripts/render-pdf.mjs <plan.pdf> <složka> 3
//   REF_PAGES=<složka> npx vitest run src/import/reference.test.ts
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergePages, pageWords, parsePlanPage, weekSumCheck, type OcrFn, type OcrWord, type ParsedPage, type Raster } from './gridParser';

const dir = process.env.REF_PAGES;
const enabled = Boolean(dir && existsSync(dir));

describe.skipIf(!enabled)('referenční půlmaratonský plán', () => {
  it('přečte 12 týdnů v km bez zdvojení mílové varianty', async () => {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas');
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const ocr: OcrFn = async (image, mode) => {
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      const id = ctx.createImageData(image.width, image.height);
      id.data.set(image.data);
      ctx.putImageData(id, 0, 0);
      await worker.setParameters({ tessedit_pageseg_mode: mode === 'page' ? PSM.AUTO : mode === 'block' ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE });
      const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { tsv: true });
      return (data.tsv ?? '')
        .split('\n')
        .map((l) => l.split('\t'))
        .filter((c) => c[0] === '5' && c[11]?.trim())
        .map((c): OcrWord => ({ x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], text: c[11].trim(), line: `${c[2]}-${c[3]}-${c[4]}` }));
    };

    const files = readdirSync(dir!).filter((f) => /^page-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
    const pages: ParsedPage[] = [];
    for (const f of files) {
      const img = await loadImage(`${dir}/${f}`);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const image: Raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(ctx.getImageData(0, 0, img.width, img.height).data) };
      const words = await pageWords(image, ocr);
      pages.push(await parsePlanPage({ page: parseInt(f.slice(5)), image, words, ocr }));
    }
    await worker.terminate();

    const result = mergePages(pages);
    if (process.env.REF_DUMP) writeFileSync(process.env.REF_DUMP, JSON.stringify(result, null, 1));
    expect(result.units).toBe('km');
    expect(result.alternativeUnits).toEqual(['mi']);
    expect(result.weeks.map((w) => w.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.weeks.map((w) => (w.declaredTotalM ?? 0) / 1000)).toEqual([58, 64, 71, 58, 74, 77, 80, 64, 84, 87, 64, 48]);
    expect(new Set(result.weeks.map((w) => w.phase))).toEqual(new Set(['PREP', 'RECOVERY', 'BUILD', 'PEAK', 'TAPER', 'RACE']));
    const w6long = result.weeks[5].days.find((d) => d.workout.type === 'long');
    expect(w6long?.workout.distanceM).toBe(22_000);
    expect(result.weeks.every((w) => weekSumCheck(w).state !== 'mismatch')).toBe(true);
  }, 900_000);
});
