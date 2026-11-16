'use client';
import type { Block, Segment, IntensityRef } from '@/domain/types';
import { INTENSITY_LABEL } from '@/domain/format';
import { Button, Field, inputClass } from './primitives';

const roles: Record<Segment['role'], string> = { warmup: 'Rozklus', work: 'Práce', recovery: 'Pauza', cooldown: 'Výklus', steady: 'Souvislý úsek' };
const fresh = (): Segment => ({ role: 'work', durationSec: 60, intensity: 'easy' });
function SegmentEditor({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const unit = value.distanceM != null ? 'm' : 's';
  return <div className="grid grid-cols-2 gap-2">
    <Field label="Role"><select className={inputClass} value={value.role} onChange={e => onChange({ ...value, role: e.target.value as Segment['role'] })}>{Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    <Field label="Intenzita"><select className={inputClass} value={value.intensity} onChange={e => onChange({ ...value, intensity: e.target.value as IntensityRef })}>{Object.entries(INTENSITY_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    <Field label="Hodnota"><input className={inputClass} type="number" min="1" value={value.distanceM ?? value.durationSec ?? ''} onChange={e => onChange({ ...value, [unit === 'm' ? 'distanceM' : 'durationSec']: Number(e.target.value) })} /></Field>
    <Field label="Jednotka"><select className={inputClass} value={unit} onChange={e => onChange({ ...value, distanceM: e.target.value === 'm' ? 400 : undefined, durationSec: e.target.value === 's' ? 60 : undefined })}><option value="s">sekundy</option><option value="m">metry</option></select></Field>
  </div>;
}
export function BlockEditor({ value, onChange }: { value: Block[]; onChange: (b: Block[]) => void }) {
  const set = (index: number, block: Block) => onChange(value.map((b, i) => i === index ? block : b));
  return <div className="space-y-3">
    <p className="font-medium">Úseky v pořadí</p>
    {value.map((b, i) => <div key={i} className="space-y-2 rounded-[12px] border border-line p-3">
      <div className="flex items-center justify-between"><span className="text-[14px] font-medium">{i + 1}. {b.kind === 'repeat' ? 'Opakování' : b.kind === 'strides' ? 'Rovinky' : b.kind === 'note' ? 'Instrukce' : 'Úsek'}</span><button type="button" className="min-h-11 px-2 text-danger underline" onClick={() => onChange(value.filter((_, n) => n !== i))}>Odebrat</button></div>
      {b.kind === 'segment' && <SegmentEditor value={b} onChange={s => set(i, { kind: 'segment', ...s })} />}
      {b.kind === 'note' && <textarea aria-label="Instrukce" className={inputClass} value={b.text} onChange={e => set(i, { ...b, text: e.target.value })} />}
      {(b.kind === 'repeat' || b.kind === 'strides') && <Field label="Počet opakování"><input className={inputClass} type="number" min="1" step="1" value={b.count} onChange={e => set(i, { ...b, count: Number(e.target.value) })} /></Field>}
      {b.kind === 'strides' && <Field label="Délka rovinky v sekundách"><input className={inputClass} type="number" min="1" value={b.durationSec} onChange={e => set(i, { ...b, durationSec: Number(e.target.value) })} /></Field>}
      {b.kind === 'repeat' && <>
        <SegmentEditor value={b.work} onChange={work => set(i, { ...b, work })} />
        {(b.more ?? []).map((s, n) => <div key={n} className="space-y-1 border-t border-line pt-2"><SegmentEditor value={s} onChange={s2 => set(i, { ...b, more: b.more!.map((x, j) => j === n ? s2 : x) })} /><Button onClick={() => set(i, { ...b, more: b.more!.filter((_, j) => j !== n) })}>Odebrat část</Button></div>)}
        <Button onClick={() => set(i, { ...b, more: [...(b.more ?? []), fresh()] })}>Další část opakování</Button>
        {b.recovery ? <><p className="text-[14px] font-medium">Pauza</p><SegmentEditor value={b.recovery} onChange={recovery => set(i, { ...b, recovery })} /><Field label="Pauza po posledním opakování"><select className={inputClass} value={b.recoveryAfterLast == null ? 'unknown' : String(b.recoveryAfterLast)} onChange={e => set(i, { ...b, recoveryAfterLast: e.target.value === 'unknown' ? null : e.target.value === 'true' })}><option value="unknown">Dokument neříká</option><option value="false">Ne</option><option value="true">Ano</option></select></Field><Button onClick={() => set(i, { ...b, recovery: undefined })}>Odebrat pauzu</Button></> : <Button onClick={() => set(i, { ...b, recovery: { ...fresh(), role: 'recovery' } })}>Přidat pauzu</Button>}
      </>}
      <div className="flex gap-2"><Button disabled={i === 0} onClick={() => { const next = [...value]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next); }}>Nahoru</Button><Button disabled={i === value.length - 1} onClick={() => { const next = [...value]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onChange(next); }}>Dolů</Button></div>
    </div>)}
    <div className="flex flex-wrap gap-2"><Button onClick={() => onChange([...value, { kind: 'segment', ...fresh() }])}>+ Úsek</Button><Button onClick={() => onChange([...value, { kind: 'repeat', count: 4, work: fresh(), recoveryAfterLast: null }])}>+ Opakování</Button><Button onClick={() => onChange([...value, { kind: 'strides', count: 6, durationSec: 20 }])}>+ Rovinky</Button></div>
  </div>;
}
