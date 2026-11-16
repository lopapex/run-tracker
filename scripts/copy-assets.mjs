// Zkopíruje workery PDF.js a Tesseract.js a jazyková data do public/vendor,
// aby import fungoval bez cizích CDN a po prvním použití i offline (§13).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const out = 'public/vendor';
mkdirSync(`${out}/tesseract/lang`, { recursive: true });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${out}/pdf.worker.min.mjs`);
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/tesseract/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f) || /^tesseract-core-lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/tesseract/${f}`);
}
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/tesseract/lang/eng.traineddata.gz`);
console.log('vendor assets copied');
