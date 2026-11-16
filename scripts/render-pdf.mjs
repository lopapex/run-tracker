// Vývojová pomůcka: vykreslí strany PDF do PNG. Použití: node scripts/render-pdf.mjs <soubor.pdf> <výstupní složka> [scale]
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [file, outDir, scaleArg] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: Number(scaleArg ?? 2) });
  const cf = doc.canvasFactory;
  const { canvas, context } = cf.create(vp.width, vp.height);
  await page.render({ canvasContext: context, viewport: vp, canvas }).promise;
  writeFileSync(`${outDir}/page-${p}.png`, canvas.toBuffer('image/png'));
  console.log('page', p, vp.width, vp.height);
}
