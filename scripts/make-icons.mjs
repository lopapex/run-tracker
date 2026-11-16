// Jednorázově vygeneruje PNG ikony z public/icon.svg. Výsledek je v repu, při buildu se nespouští.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg');
const img = await loadImage(svg);
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12]]) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f7a45';
  if (pad) ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, size * pad, size * pad, size * (1 - 2 * pad), size * (1 - 2 * pad));
  writeFileSync(`public/${name}`, c.toBuffer('image/png'));
}
