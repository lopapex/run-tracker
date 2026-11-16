'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { db } from '@/db/db';
import { publishTemplate, saveProfile } from '@/db/repo';
import { sha256Hex } from '@/domain/activities';
import { DOW_LONG } from '@/domain/dates';
import { formatKm, workoutSummary, formatDistanceRange, formatPace, INTENSITY_LABEL } from '@/domain/format';
import { plannedDistance } from '@/domain/distance';
import { newId } from '@/domain/schedule';
import type { PlanTemplate, TemplateDay, TemplateWeek, WorkoutSpec } from '@/domain/types';
import type { ImportOutput } from '@/import/browser';
import { weekSumCheck } from '@/import/gridParser';
import { usePlan, useProfile } from '@/ui/hooks';
import { ActivateSheet } from '@/ui/PlanSetup';
import { Button, Card, Chip, cx, Field, inputClass, Sheet, toast } from '@/ui/primitives';
import { isValidSpec, WorkoutEditor } from '@/ui/Workout';

type Stage = 'pick' | 'reading' | 'review';

/** Výřez originálu k buňce: kontrola proti zdroji bez přepínání do jiného okna (§6.2). */
function SourceCrop({ day, previews }: { day: TemplateDay; previews: ImportOutput['previews'] }) {
  const p = day.source.page != null ? previews.get(day.source.page) : undefined;
  if (!p || !day.source.bbox || !p.url) return null;
  const [x, y, w, h] = day.source.bbox;
  const scale = Math.min(1.4, 300 / w);
  return (
    <div className="mx-auto overflow-hidden rounded-[8px] border border-line" style={{ width: w * scale, height: h * scale }} role="img" aria-label="Výřez z originálu">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.url} alt="" style={{ width: p.width * scale, height: p.height * scale, maxWidth: 'none', transform: `translate(${-x * scale}px, ${-y * scale}px)` }} />
    </div>
  );
}

export default function ImportPage() {
  const router = useRouter();
  const profile = useProfile();
  const plan = usePlan();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [steps, setSteps] = useState<string[]>([]);
  const [output, setOutput] = useState<ImportOutput | null>(null);
  const [weeks, setWeeks] = useState<TemplateWeek[]>([]);
  const [name, setName] = useState('');
  const [docId, setDocId] = useState<string | undefined>();
  const [edit, setEdit] = useState<{ week: number; dow: number } | null>(null);
  const [spec, setSpec] = useState<WorkoutSpec | null>(null);
  const [toActivate, setToActivate] = useState<PlanTemplate | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [paceIndex, setPaceIndex] = useState<number | null>(null);
  const [paceConfirmed, setPaceConfirmed] = useState(false);
  const paceChart = paceIndex != null ? output?.paceOptions[paceIndex]?.chart : profile?.paceChart;

  const start = async (file: File) => {
    if (file.size > 40 * 1024 * 1024) { toast('Soubor je větší než 40 MB.', { tone: 'error' }); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { toast('Podporované jsou PDF, PNG, JPG a WebP.', { tone: 'error' }); return; }
    setStage('reading');
    setPaceIndex(null); setPaceConfirmed(false);
    setSteps([]);
    setDuplicate(null);
    const buffer = await file.arrayBuffer();
    const checksum = await sha256Hex(buffer);
    const existing = await db().documents.where('checksum').equals(checksum).first();
    if (existing) setDuplicate(existing.name);
    abortRef.current = new AbortController();
    try {
      const { importPlanFile } = await import('@/import/browser');
      const out = await importPlanFile(file, (label) => setSteps((s) => [...s.slice(-5), label]), abortRef.current.signal);
      const id = existing?.id ?? newId();
      // Originál zůstává uložený v zařízení jako soukromý vstup vlastníka (§6.4).
      if (!existing) await db().documents.add({ id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, checksum, createdAt: new Date().toISOString(), blob: new Blob([buffer], { type: file.type }), provenance: 'PLAN_DOCUMENT' });
      setDocId(id);
      setOutput(out);
      setWeeks(out.result.weeks);
      setSelectedWeek(out.result.weeks[0]?.index ?? null);
      setName(file.name.replace(/\.[^.]+$/, ''));
      setStage('review');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(`Import se nepovedl: ${(e as Error).message}`, { tone: 'error' });
      setStage('pick');
    }
  };

  const dayOf = (w: number, d: number) => weeks.find((x) => x.index === w)?.days.find((x) => x.dow === d);
  const patchDay = (w: number, d: number, patch: Partial<TemplateDay>) => setWeeks((ws) => ws.map((x) => (x.index !== w ? x : { ...x, days: x.days.map((y) => (y.dow !== d ? y : { ...y, ...patch })) })));
  const open = weeks.flatMap((w) => w.days.filter((d) => d.source.review === 'unreviewed' && d.source.issues.length > 0).map((d) => ({ week: w.index, dow: d.dow })));

  const publish = async () => {
    if (open.length || paceIndex != null && !paceConfirmed || weeks.some(w => w.days.some(d => !isValidSpec(d.workout)))) { toast('Nejdřív dokonči kontrolu jednotek a temp.', { tone: 'error' }); return; }
    const now = new Date().toISOString();
    const template: PlanTemplate = {
      id: newId(), name: name.trim() || 'Importovaný plán', origin: 'import', documentId: docId, createdAt: now, verifiedAt: now, units: output?.result.units ?? 'km',
      paceChart,
      weeks: weeks.map((w) => ({ ...w, days: w.days.map((d) => ({ ...d, source: { ...d.source, review: d.source.review === 'unreviewed' ? ('confirmed' as const) : d.source.review } })) })),
    };
    await publishTemplate(template);
    setToActivate(template);
  };

  if (!profile || !plan) return null;

  return (
    <div className="space-y-4">
      {stage === 'pick' && (
        <Card className="space-y-3">
          <h2 className="text-[17px] font-semibold">Plán z PDF nebo obrázku</h2>
          <p className="text-[15px] text-muted">Soubor se čte přímo v tomhle zařízení a nikam se neodesílá. Zatím umím týdenní tabulky se dny ve sloupcích; anglické názvy dnů a jednotek. Jiné rozložení zadej ručně.</p>
          <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
          <Button variant="primary" className="w-full" onClick={() => fileRef.current?.click()}>Vybrat soubor</Button>
          <Button variant="ghost" className="w-full" onClick={() => router.push('/plan/')}>Zpět na plán</Button>
        </Card>
      )}

      {stage === 'reading' && (
        <Card className="space-y-3" >
          <h2 className="text-[17px] font-semibold">Čtu plán</h2>
          <ol aria-live="polite" className="space-y-1 text-[15px]">
            {steps.map((s, i) => <li key={`${i}-${s}`} className={i === steps.length - 1 ? 'font-medium' : 'text-muted'}>{s}</li>)}
          </ol>
          <p className="text-[13px] text-muted">Čtení textu z obrázků trvá na telefonu i několik minut. Nech aplikaci otevřenou.</p>
          <Button onClick={() => abortRef.current?.abort()}>Zrušit</Button>
        </Card>
      )}

      {stage === 'review' && output && (
        <>
          <Card className="space-y-3">
            <h2 className="text-[17px] font-semibold">Kontrola importu</h2>
            {weeks.length === 0 ? (
              <>
                <p className="text-[15px] text-danger">{output.result.issues[output.result.issues.length - 1]}</p>
                <Button className="w-full" onClick={() => setStage('pick')}>Zkusit jiný soubor</Button>
              </>
            ) : (
              <>
                <p className="num text-[15px] text-muted">Přečteno {weeks.length} týdnů ze stran {output.pagesRead.join(', ')} (z {output.pagesTotal}). Jednotky: {output.result.units === 'km' ? 'kilometry' : 'míle'}.</p>
                {output.result.alternativeUnits.length > 0 && <p className="text-[14px] text-muted">Dokument má i variantu v mílích. Je to tentýž plán, nenačítal jsem ho podruhé.</p>}
                {duplicate && <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">Stejný soubor už tu je uložený („{duplicate}“). Nový ověřený plán vznikne jen když budeš pokračovat.</p>}
                {output.result.issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[14px] text-warn">{output.result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
                <p className={cx('text-[15px] font-medium', open.length ? 'text-warn' : 'text-done')}>{open.length ? `Zbývá zkontrolovat ${open.length} ${open.length === 1 ? 'buňku' : open.length < 5 ? 'buňky' : 'buněk'}.` : 'Žádné nejasnosti k vyřešení.'}</p>
                <Field label="Název plánu"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              </>
            )}
          </Card>

          {weeks.length > 0 && <Field label="Procházet týden"><select className={inputClass} value={selectedWeek ?? ''} onChange={e => setSelectedWeek(Number(e.target.value))}>{weeks.map(w => <option key={w.index} value={w.index}>Týden {w.index} · {w.days.filter(d => d.source.review === 'unreviewed' && d.source.issues.length > 0).length} nejasností</option>)}</select></Field>}
          {output.paceOptions.length > 0 && <Card className="space-y-3">
            <h3 className="font-semibold">Tempa z dokumentu</h3>
            <Field label="Vyber řádek podle cílového času"><select className={inputClass} value={paceIndex ?? ''} onChange={e => { setPaceIndex(e.target.value === '' ? null : Number(e.target.value)); setPaceConfirmed(false); }}><option value="">Použít moje tempa z profilu</option>{output.paceOptions.map((p, i) => <option key={i} value={i}>Cíl {p.goalLabel} · strana {p.page} · původně min/{p.units}</option>)}</select></Field>
            {paceIndex != null && <>
              <dl className="num space-y-1 text-[14px]">{Object.entries(output.paceOptions[paceIndex].chart).map(([k, v]) => <div key={k} className="flex justify-between"><dt>{INTENSITY_LABEL[k as keyof typeof INTENSITY_LABEL]}</dt><dd>{formatPace(v.fromSec)}–{formatPace(v.toSec)}/km</dd></div>)}</dl>
              <details><summary className="min-h-11 cursor-pointer py-2 text-[14px]">Porovnat s originálem</summary>{output.previews.get(output.paceOptions[paceIndex].page)?.url && <img src={output.previews.get(output.paceOptions[paceIndex].page)!.url} alt="Originální stránka s tabulkou temp" className="w-full" />}</details>
              <label className="flex min-h-11 items-center gap-2 text-[14px]"><input type="checkbox" checked={paceConfirmed} onChange={e => setPaceConfirmed(e.target.checked)} />Zvolený řádek a tempa odpovídají originálu</label>
            </>}
            <p className="text-[13px] text-muted">Z těchto rozsahů se vypočítá odhad kilometrů časových úseků. Intenzity bez přesného tempa zůstanou nevyčíslené.</p>
          </Card>}
          {weeks.filter(w => w.index === selectedWeek).map((w) => {
            const sum = weekSumCheck(w);
            return (
              <Card key={w.index} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">Týden {w.index}{w.phase ? ` · ${w.phase}` : ''}</h3>
                  <span className={cx('num text-[13px]', sum.state === 'mismatch' ? 'text-danger' : 'text-muted')}>
                    {sum.state === 'none' ? `součet ${formatKm(sum.sumM)}` : `autor uvádí ${formatKm(w.declaredTotalM)}${w.declaredTotalMaxM ? `–${formatKm(w.declaredTotalMaxM)}` : ''}, `}
                    {sum.state === 'ok' && 'součet sedí'}
                    {sum.state === 'mismatch' && `přečteno ${formatKm(sum.sumM)}`}
                    {sum.state === 'unverifiable' && `${sum.timeBased}× dle času, nejde ověřit`}
                  </span>
                </div>
                <p className="num text-[13px] text-muted">Dle zvolených temp: {formatDistanceRange(plannedDistance(w.days.map(d => d.workout), paceChart))}</p>
                <ul className="space-y-1">
                  {w.days.map((d) => {
                    const flagged = d.source.issues.length > 0 && d.source.review === 'unreviewed';
                    return (
                      <li key={d.dow}>
                        <button type="button" onClick={() => { setSpec(structuredClone(d.workout)); setEdit({ week: w.index, dow: d.dow }); }} className={cx('flex min-h-12 w-full items-center gap-2 rounded-[8px] border px-3 py-1.5 text-left', flagged ? 'border-warn bg-warn-soft' : 'border-line')}>
                          <span className="w-16 shrink-0 text-[13px] text-muted">{DOW_LONG[d.dow]}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{d.workout.title}</span>
                            {d.workout.type !== 'rest' && <span className="num block truncate text-[13px] text-muted">{workoutSummary(d.workout)}</span>}
                          </span>
                          {flagged && <WarningCircle size={20} className="shrink-0 text-warn" aria-label="ke kontrole" />}
                          {d.source.review === 'edited' && <Chip>upraveno</Chip>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}

          {weeks.length > 0 && (
            <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex gap-2 rounded-[12px] border border-line bg-surface p-2 shadow-lg">
              <Button onClick={() => setStage('pick')}>Zahodit</Button>
              <Button variant="primary" className="flex-1" disabled={open.length > 0 || paceIndex != null && !paceConfirmed} onClick={publish}>{open.length ? `Nejdřív zkontroluj ${open.length}` : paceIndex != null && !paceConfirmed ? 'Potvrď tempa z dokumentu' : 'Potvrdit a zařadit do kalendáře'}</Button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={edit != null && spec != null}
        onClose={() => setEdit(null)}
        title={edit ? `Týden ${edit.week}, ${DOW_LONG[edit.dow]}` : ''}
        footer={
          edit && spec ? (
            <>
              <Button disabled={!isValidSpec(dayOf(edit.week, edit.dow)!.workout)} onClick={() => { patchDay(edit.week, edit.dow, { source: { ...dayOf(edit.week, edit.dow)!.source, review: 'confirmed' } }); setEdit(null); }}>Sedí, potvrdit</Button>
              <Button variant="primary" className="flex-1" disabled={!isValidSpec(spec)} onClick={() => { patchDay(edit.week, edit.dow, { workout: spec, source: { ...dayOf(edit.week, edit.dow)!.source, review: 'edited' } }); setEdit(null); }}>Uložit opravu</Button>
            </>
          ) : undefined
        }
      >
        {edit && spec && output && (() => {
          const d = dayOf(edit.week, edit.dow)!;
          return (
            <div className="space-y-4">
              <SourceCrop day={d} previews={output.previews} />
              {d.source.issues.length > 0 && <ul className="list-disc space-y-1 rounded-[8px] bg-warn-soft py-2 pl-7 pr-3 text-[14px] text-warn">{d.source.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
              <p className="text-[13px] text-muted">{d.source.method === 'pdf_text' ? 'Přečteno přímo z textu PDF.' : `Přečteno z obrázku${d.source.confidence != null ? `, jistota čtení ${d.source.confidence} ze 100 (údaj nástroje, ne pravděpodobnost)` : ''}.`}</p>
              {spec.rawInstruction && <details><summary className="min-h-11 cursor-pointer py-2 text-[14px]">Původní přečtený text</summary><pre className="whitespace-pre-wrap text-[14px]">{spec.rawInstruction}</pre></details>}
              <WorkoutEditor value={spec} onChange={setSpec} />
            </div>
          );
        })()}
      </Sheet>

      <ActivateSheet template={toActivate} profile={profile} hasActive={plan.activation != null} onClose={() => { setToActivate(null); router.push('/plan/'); }} onDone={async () => { if(paceIndex != null) await saveProfile({paceSource:'plan'}); setToActivate(null); router.push('/plan/'); }} />
    </div>
  );
}
