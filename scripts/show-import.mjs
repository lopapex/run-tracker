// Vývojová pomůcka: čitelný výpis výsledku importu (JSON z REF_DUMP).
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log('units', r.units, 'alt', r.alternativeUnits, 'issues', r.issues);
const seg = (s) => `${s.durationSec ?? s.distanceM} ${s.intensity}`;
for (const w of r.weeks) {
  console.log(`W${w.index} ${w.phase} total=${w.declaredTotalM}${w.declaredTotalMaxM ? '-' + w.declaredTotalMaxM : ''} note=${(w.note || '').slice(0, 50)}`);
  for (const d of w.days) {
    const k = d.workout;
    const blocks = k.blocks.map((b) => (b.kind === 'repeat' ? `${b.count}x(${seg(b.work)}/${b.recovery ? seg(b.recovery) : '-'})` : b.kind === 'segment' ? `${b.role}:${seg(b)}` : b.kind === 'strides' ? `strides${b.count}x${b.durationSec}` : 'note')).join(', ');
    console.log('  ', d.dow, k.type, k.title, '|', k.distanceM ?? '-', k.load, '|', blocks, k.strengthMin ? `str${k.strengthMin}` : '', d.source.issues.length ? '!! ' + d.source.issues.join(' / ') : '', k.rawInstruction ? 'RAW:' + JSON.stringify(k.rawInstruction) : '');
  }
}
