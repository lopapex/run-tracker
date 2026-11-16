// Po `next build`: sestaví service worker a vloží do něj seznam souborů statického exportu.
import { injectManifest } from '@serwist/build';
import { build } from 'esbuild';
import { copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Statický export ukládá data segmentů do složek (`__next.plan/__PAGE__.txt`), klient je ale žádá
// pod plochým názvem (`__next.plan.__PAGE__.txt`). Bez kopie končí přednačítání stránek chybou 404.
function flatten(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith('__next.')) {
      const walk = (sub, prefix) => {
        for (const f of readdirSync(sub)) {
          const p = join(sub, f);
          if (statSync(p).isDirectory()) walk(p, `${prefix}.${f}`);
          else copyFileSync(p, join(dir, `${prefix}.${f}`));
        }
      };
      walk(full, name);
    } else if (name !== '_next' && name !== 'vendor') flatten(full);
  }
}
flatten('out');

const tmp = '.next/sw.tmp.js';
await build({ entryPoints: ['src/sw.ts'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: tmp, define: { 'process.env.NODE_ENV': '"production"' } });
const { count, size, warnings } = await injectManifest({
  swSrc: tmp,
  swDest: 'out/sw.js',
  globDirectory: 'out',
  globPatterns: ['**/*.{html,js,css,woff2,svg,png,webmanifest,txt}'],
  // Velké soubory importu a lokální AI se do povinného prvního načtení nepočítají (§9.1).
  globIgnores: ['vendor/**', 'sw.js', '**/*.map'],
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  injectionPoint: 'self.__SW_MANIFEST',
});
rmSync(tmp);
for (const w of warnings) console.warn(w);
console.log(`service worker: ${count} souborů, ${(size / 1024).toFixed(0)} kB v precache`);
