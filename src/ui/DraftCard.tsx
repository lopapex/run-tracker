'use client';

import { Lock, LockOpen } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useState } from 'react';
import { db } from '@/db/db';
import { activateDraft, updateDraft } from '@/db/repo';
import { addDays, DOW_SHORT, formatDay, formatWeekRange, weekStartOf } from '@/domain/dates';
import { INTENT_LABEL, validateDraftRevision, type DraftChange } from '@/domain/drafts';
import { formatKm, weekTotalM, workoutSummary } from '@/domain/format';
import type { Dow, PlanDraftRevision, WorkoutSpec } from '@/domain/types';
import { Button, Chip, cx, DayToggles, Segmented, Sheet, toast } from './primitives';
import { isValidSpec, WorkoutEditor } from './Workout';

/**
 * Karta draftu (§5.5). Ukazuje vždy aktuální verzi téhož objektu; `pinnedRevisionId`
 * je verze, u které karta v chatu vznikla. Starší verze jde prohlížet a obnovit, ne aktivovat.
 */
export function DraftCard({ draftId, pinnedRevisionId, compact, onActivated }: { draftId: string; pinnedRevisionId?: string; compact?: boolean; onActivated?: (firstWeek: string) => void }) {
  const data = useLiveQuery(async () => {
    const draft = await db().drafts.get(draftId);
    if (!draft) return null;
    const revisions = (await db().draftRevisions.where('draftId').equals(draftId).toArray()).sort((a, b) => a.seq - b.seq);
    return { draft, revisions };
  }, [draftId]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [day, setDay] = useState<{ week: number; dow: Dow } | null>(null);
  const [spec, setSpec] = useState<WorkoutSpec | null>(null);
  const [params, setParams] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (data === undefined) return null;
  if (data === null) return <p className="text-[14px] text-muted">Návrh už neexistuje.</p>;
  const { draft, revisions } = data;
  const current = revisions.find((r) => r.id === draft.currentRevisionId)!;
  const shown = revisions.find((r) => r.id === viewId) ?? current;
  const isCurrent = shown.id === current.id;
  const accepted = draft.status === 'accepted';
  const editable = isCurrent && !accepted;
  const problems = validateDraftRevision(current);

  const change = async (changes: DraftChange[], reason: string) => {
    const r = await updateDraft(draftId, changes, 'user', reason, current.id);
    if (!r.ok) toast(r.message, { tone: 'error' });
    return r.ok;
  };

  return (
    <div className="space-y-3 rounded-[16px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">{draft.title}</h3>
        <Chip tone={accepted ? 'accent' : 'neutral'}>{accepted ? 'použito jako plán' : `verze ${shown.seq}${isCurrent ? '' : ` z ${current.seq}`}`}</Chip>
      </div>
      <p className="num text-[14px] text-muted">
        {INTENT_LABEL[shown.params.intent]} · od {formatDay(shown.params.startDate)} · {shown.params.runsPerWeek} běhů týdně · výchozí objem {shown.params.weeklyKm} km
      </p>
      {shown.params.assumptions.length > 0 && <p className="text-[13px] text-muted">Předpoklady: {shown.params.assumptions.join(' ')}</p>}
      {!isCurrent && (
        <div className="rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">
          Prohlížíš starší verzi. {!accepted && <button type="button" className="min-h-11 font-semibold underline" onClick={async () => { if (await change([{ op: 'restore_part', fromRevisionId: shown.id }], `Obnovena verze ${shown.seq}`)) setViewId(null); }}>Obnovit ji jako novou verzi</button>}
        </div>
      )}

      <ol className="space-y-3">
        {(compact && isCurrent ? shown.weeks.slice(0, 2) : shown.weeks).map((w) => {
          const total = weekTotalM(w.days.map((d) => d.workout));
          const ws = addDays(weekStartOf(shown.params.startDate), 7 * (w.index - 1));
          return (
            <li key={w.index}>
              <div className="num mb-1 flex items-baseline justify-between text-[13px] text-muted">
                <span className="font-medium text-text">Týden {w.index}{w.phase ? ` · ${w.phase}` : ''}</span>
                <span>{formatWeekRange(ws)} · {formatKm(total.totalM)}</span>
              </div>
              <ul className="grid grid-cols-7 gap-1">
                {w.days.map((d) => {
                  const rest = d.workout.type === 'rest';
                  return (
                    <li key={d.dow}>
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => { setSpec(structuredClone(d.workout)); setDay({ week: w.index, dow: d.dow }); }}
                        aria-label={`${DOW_SHORT[d.dow]}: ${d.workout.title}${rest ? '' : `, ${workoutSummary(d.workout)}`}${d.locked ? ', zamčeno' : ''}`}
                        className={cx('relative flex min-h-14 w-full flex-col items-center justify-center rounded-[8px] px-0.5 text-center', rest ? 'bg-surface-2 text-muted' : d.workout.load === 'high' ? 'bg-danger-soft' : d.workout.load === 'medium' ? 'bg-warn-soft' : 'bg-accent-soft')}
                      >
                        <span className="text-[11px] text-muted">{DOW_SHORT[d.dow]}</span>
                        <span className="num text-[13px] font-semibold">{rest ? '–' : d.workout.distanceM != null ? Math.round(d.workout.distanceM / 1000) : '•'}</span>
                        {d.locked && <Lock size={10} className="absolute right-1 top-1" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {editable && !compact && (
                <div className="mt-1 flex gap-3 text-[13px]">
                  <button type="button" className="min-h-11 text-accent underline" onClick={() => change([{ op: 'scale_week', week: w.index, factor: 0.8 }], `Týden ${w.index} lehčí`)}>Lehčí o 20 %</button>
                  <button type="button" className="min-h-11 text-accent underline" onClick={() => change([{ op: 'scale_week', week: w.index, factor: 1.1 }], `Týden ${w.index} těžší`)}>Těžší o 10 %</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {compact && isCurrent && shown.weeks.length > 2 && <p className="text-[13px] text-muted">… a dalších {shown.weeks.length - 2} týdnů.</p>}
      <p className="text-[12px] text-muted">Čísla jsou km. Zelená nízká, žlutá střední, červená vysoká zátěž.</p>

      {pinnedRevisionId && pinnedRevisionId !== current.id && isCurrent && <p className="text-[13px] text-muted">Návrh se od téhle zprávy změnil; vidíš aktuální verzi.</p>}

      {compact ? (
        <Link href={`/plan/?navrh=${draft.id}`} className="flex min-h-11 items-center justify-center rounded-[8px] bg-surface-2 font-medium">Otevřít návrh</Link>
      ) : (
        <>
          {revisions.length > 1 && (
            <details className="text-[14px]">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-muted">Verze návrhu ({revisions.length})</summary>
              <ul className="space-y-1">
                {[...revisions].reverse().map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setViewId(r.id === current.id ? null : r.id)} className={cx('flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] px-3 text-left', r.id === shown.id ? 'bg-accent-soft' : 'bg-surface-2')}>
                      <span>v{r.seq} · {r.reason}</span>
                      <span className="text-[12px] text-muted">{r.author === 'user' ? 'ty' : 'trenér'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {editable && (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => setParams(true)}>Změnit zadání</Button>
              <Button variant="primary" className="flex-1" disabled={problems.length > 0} onClick={() => setConfirm(true)}>Použít</Button>
            </div>
          )}
          {problems.length > 0 && <p className="text-[14px] text-danger">{problems[0]}</p>}
        </>
      )}

      <Sheet
        open={day != null && spec != null}
        onClose={() => setDay(null)}
        title={day ? `Týden ${day.week}, ${DOW_SHORT[day.dow]}` : ''}
        footer={
          day && spec ? (
            <>
              {(() => {
                const locked = current.weeks.find((w) => w.index === day.week)?.days.find((d) => d.dow === day.dow)?.locked;
                return (
                  <Button onClick={async () => { await change([{ op: 'lock_day', week: day.week, dow: day.dow, locked: !locked }], locked ? 'Odemčení dne' : 'Zamčení dne'); }}>
                    {locked ? <><LockOpen size={16} /> Odemknout</> : <><Lock size={16} /> Zamknout</>}
                  </Button>
                );
              })()}
              <Button variant="primary" className="flex-1" disabled={!isValidSpec(spec)} onClick={async () => { if (await change([{ op: 'set_day', week: day.week, dow: day.dow, workout: spec }], `Ruční úprava: týden ${day.week}, ${DOW_SHORT[day.dow]}`)) setDay(null); }}>Uložit</Button>
            </>
          ) : undefined
        }
      >
        {spec && <WorkoutEditor value={spec} onChange={setSpec} />}
      </Sheet>

      <ParamsSheet open={params} onClose={() => setParams(false)} rev={current} onApply={async (p) => { if (await change([{ op: 'set_params', params: p }], 'Změna zadání')) setParams(false); }} />

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Použít návrh jako plán"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Nechat být</Button>
            <Button variant="primary" className="flex-1" onClick={async () => { const r = await activateDraft(draft.id, current.id); setConfirm(false); toast(r.ok ? 'Návrh je teď tvůj plán.' : r.message, { tone: r.ok ? 'info' : 'error' }); if (r.ok) onActivated?.(r.activation.mapping[0].weekStart); }}>Použít verzi {current.seq}</Button>
          </>
        }
      >
        <div className="space-y-2 text-[15px]">
          <p>Použije se verze {current.seq}: {current.weeks.length} týdnů od {formatDay(weekStartOf(current.params.startDate), { weekday: true, year: true })}.</p>
          <p className="text-muted">Pokud máš aktivní plán, archivuje se k předchozímu dni; jeho historie zůstane.</p>
        </div>
      </Sheet>
    </div>
  );
}

function ParamsSheet({ open, onClose, rev, onApply }: { open: boolean; onClose: () => void; rev: PlanDraftRevision; onApply: (p: Partial<PlanDraftRevision['params']>) => void }) {
  const [runs, setRuns] = useState(rev.params.runsPerWeek);
  const [rest, setRest] = useState<number[]>(rev.params.restDows);
  const [km, setKm] = useState(String(rev.params.weeklyKm));
  const [longDow, setLongDow] = useState<number>(rev.params.longRunDow);
  const n = Number(km.replace(',', '.'));
  return (
    <Sheet open={open} onClose={onClose} title="Změnit zadání návrhu" footer={<Button variant="primary" className="flex-1" disabled={!(n >= 5) || rest.length > 6} onClick={() => onApply({ runsPerWeek: Math.min(runs, 7 - rest.length), restDows: rest as Dow[], weeklyKm: n, longRunDow: longDow as Dow })}>Přepočítat</Button>}>
      <div className="space-y-4">
        <p className="text-[14px] text-muted">Kostra se přepočítá, zamčené dny zůstanou.</p>
        <div><span className="mb-1 block text-[13px] font-medium text-muted">Běhů týdně</span><Segmented label="Běhů týdně" value={runs} onChange={setRuns} options={[3, 4, 5, 6, 7].map((x) => ({ value: x, label: String(x) }))} /></div>
        <div><span className="mb-1 block text-[13px] font-medium text-muted">Dny bez běhu</span><DayToggles label="Dny bez běhu" value={rest} onChange={setRest} /></div>
        <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted">Výchozí týdenní objem v km</span><input inputMode="decimal" className="min-h-11 w-full rounded-[8px] border border-line bg-surface px-3" value={km} onChange={(e) => setKm(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted">Den dlouhého běhu</span>
          <select className="min-h-11 w-full rounded-[8px] border border-line bg-surface px-3" value={longDow} onChange={(e) => setLongDow(Number(e.target.value))}>
            {['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'].map((d, i) => <option key={d} value={i} disabled={rest.includes(i)}>{d}</option>)}
          </select>
        </label>
      </div>
    </Sheet>
  );
}
