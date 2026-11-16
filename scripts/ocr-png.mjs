// Vývojová pomůcka: OCR obrázku do JSON slov s geometrií. Použití: node scripts/ocr-png.mjs <png> <out.json>
import { createWorker } from 'tesseract.js';
import { writeFileSync } from 'node:fs';
const [img, out] = process.argv.slice(2);
const worker = await createWorker('eng');
const { data } = await worker.recognize(img, {}, { tsv: true });
await worker.terminate();
const words = data.tsv.split('\n').map((l) => l.split('\t')).filter((c) => c[0] === '5' && c[11]?.trim())
  .map((c) => ({ x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], text: c[11].trim() }));
writeFileSync(out, JSON.stringify(words));
console.log(words.length, 'words');
