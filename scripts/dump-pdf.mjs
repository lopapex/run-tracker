// Vývojová pomůcka: vypíše textové položky PDF s geometrií. Použití: node scripts/dump-pdf.mjs <soubor.pdf> [strana]
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
const [file, only] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
console.log('pages', doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  if (only && Number(only) !== p) continue;
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log(`--- page ${p} ${Math.round(vp.width)}x${Math.round(vp.height)} items=${tc.items.length}`);
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    console.log(`${Math.round(it.transform[4])}\t${Math.round(vp.height - it.transform[5])}\t${Math.round(it.width)}\t${Math.round(it.height)}\t${it.str}`);
  }
}
