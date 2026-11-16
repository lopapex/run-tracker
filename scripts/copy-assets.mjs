// Zkopíruje workery PDF.js a Tesseract.js a jazyková data do public/vendor,
// aby import fungoval bez cizích CDN a po prvním použití i offline (§13).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const out = 'public/vendor';
mkdirSync(`${out}/tesseract/lang`, { recursive: true });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${out}/pdf.worker.min.mjs`);
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/tesseract/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f) || /^tesseract-core-lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/tesseract/${f}`);
}
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/tesseract/lang/eng.traineddata.gz`);
// Worker lokální AI se sestavuje zvlášť: jeden samostatný soubor, nezávislý na tom, jak bundler aplikace balí workery.
await build({
  entryPoints: ['src/ai/webllm.worker.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: `${out}/webllm.worker.js`,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
console.log('vendor assets copied');
