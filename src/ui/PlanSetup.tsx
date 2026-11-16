'use client';

import { useMemo, useState } from 'react';
import { activateTemplate, createDraft, publishTemplate } from '@/db/repo';
import { DOW_LONG, formatDay, formatWeekRange, todayIso } from '@/domain/dates';
import { INTENT_LABEL } from '@/domain/drafts';
import { formatKm, weekTotalM, workoutSummary } from '@/domain/format';
import { defaultStart, weeksUntil } from '@/domain/generator';
import { buildMapping, emptyWeek, newId, type MappingOptions } from '@/domain/schedule';
import type { AthleteProfile, Dow, PlanTemplate, TemplateWeek, TrainingIntent, WorkoutSpec } from '@/domain/types';
import { Button, DayToggles, Field, inputClass, Segmented, Sheet, toast } from './primitives';
import { isValidSpec, WorkoutEditor } from './Workout';

/** Mapování ověřeného plánu do kalendáře (§5.2) s náhledem dat každého týdne. */
export function ActivateSheet({ template, profile, onClose, onDone, hasActive }: { template: PlanTemplate | null; profile: AthleteProfile; onClose: () => void; onDone: () => void; hasActive: boolean }) {
  const today = todayIso(profile.timezone);
  const [mode, setMode] = useState<'start' | 'race' | 'current'>('start');
  const [date, setDate] = useState(today);
  const [raceDate, setRaceDate] = useState(profile.raceDate ?? '');
  const [currentWeek, setCurrentWeek] = useState(1);
  const [skip, setSkip] = useState<number[]>([]);

  const opts: MappingOptions | null = useMemo(() => {
    if (mode === 'race') return raceDate ? { mode: 'race', date: raceDate, skipWeeks: skip } : null;
    if (mode === 'current') return { mode: 'start', date: today, startFromWeek: currentWeek, skipWeeks: skip };
    return date ? { mode: 'start', date, skipWeeks: skip } : null;
  }, [mode, date, raceDate, currentWeek, skip, today]);
  const preview = template && opts ? buildMapping(template.weeks, opts) : null;

  if (!template) return <Sheet open={false} onClose={onClose} title="Zařadit plán">{null}</Sheet>;
  const goalMismatch = template.goalDistanceM && profile.raceDistanceM && Math.abs(template.goalDistanceM - profile.raceDistanceM) > 500;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Zařadit plán do kalendáře"
      footer={
        <Button
          variant="primary"
          className="flex-1"
          disabled={!opts || !preview || preview.mapping.length === 0}
          onClick={async () => {
            try {
              await activateTemplate(template.id, opts!);
              toast('Plán je aktivní.');
              onDone();
            } catch (e) {
              toast((e as Error).message, { tone: 'error' });
            }
          }}
        >
          Použít plán
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="font-medium">{template.name} · {template.weeks.length} {template.weeks.length === 1 ? 'týden' : template.weeks.length < 5 ? 'týdny' : 'týdnů'}</p>
        {goalMismatch && (
          <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">Plán míří na {formatKm(template.goalDistanceM)}, ale v profilu máš cíl {formatKm(profile.raceDistanceM)}. Můžeš pokračovat vědomě, nebo cíl v profilu upravit.</p>
        )}
        {hasActive && <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">Současný plán se archivuje. Jeho historie zůstane k prohlížení.</p>}
        <Segmented label="Způsob mapování" value={mode} onChange={setMode} options={[{ value: 'start', label: 'Od data' }, { value: 'race', label: 'K závodu' }, { value: 'current', label: 'Jsem v týdnu…' }]} />
        {mode === 'start' && <Field label="První týden plánu začne v týdnu, kam patří"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {mode === 'race' && <Field label="Datum závodu (poslední týden plánu)"><input type="date" className={inputClass} value={raceDate} onChange={(e) => setRaceDate(e.target.value)} /></Field>}
        {mode === 'current' && (
          <Field label="Tento týden je týden plánu číslo" hint="Dřívější týdny se přeskočí a neoznačí se za odběhnuté.">
            <select className={inputClass} value={currentWeek} onChange={(e) => setCurrentWeek(Number(e.target.value))}>
              {template.weeks.map((w) => <option key={w.index} value={w.index}>{w.index}{w.phase ? ` (${w.phase})` : ''}</option>)}
            </select>
          </Field>
        )}
        <div>
          <p className="mb-1 text-[13px] font-medium text-muted">Týdny v kalendáři (ťuknutím týden přeskočíš)</p>
          <ul className="space-y-1">
            {template.weeks.map((w) => {
              const m = preview?.mapping.find((x) => x.sourceWeek === w.index);
              const skipped = skip.includes(w.index);
              const before = !m && !skipped;
              return (
                <li key={w.index}>
                  <button type="button" aria-pressed={skipped} disabled={before} onClick={() => setSkip(skipped ? skip.filter((s) => s !== w.index) : [...skip, w.index])} className="num flex min-h-11 w-full items-center justify-between rounded-[8px] bg-surface-2 px-3 text-left text-[14px] disabled:opacity-50">
                    <span className={skipped || before ? 'line-through' : ''}>Týden {w.index}{w.phase ? ` · ${w.phase}` : ''}</span>
                    <span className="text-muted">{m ? formatWeekRange(m.weekStart) : 'přeskočen'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

/** Ruční týden (R-10, jednoduchá varianta): sedm dní, volitelně opakovaný víc týdnů. */
export function ManualWeekSheet({ open, onClose, profile, onPublished }: { open: boolean; onClose: () => void; profile: AthleteProfile; onPublished: (t: PlanTemplate) => void }) {
  const [week, setWeek] = useState<TemplateWeek>(() => emptyWeek(1, profile.restDows));
  const [repeat, setRepeat] = useState(1);
  const [name, setName] = useState('Můj týden');
  const [editing, setEditing] = useState<Dow | null>(null);
  const [draft, setDraft] = useState<WorkoutSpec | null>(null);
  const total = weekTotalM(week.days.map((d) => d.workout));

  const publish = async () => {
    const now = new Date().toISOString();
    const template: PlanTemplate = {
      id: newId(), name: name.trim() || 'Můj týden', origin: 'manual', createdAt: now, verifiedAt: now, units: 'km',
      weeks: Array.from({ length: repeat }, (_, i) => ({ ...structuredClone(week), index: i + 1 })),
    };
    await publishTemplate(template);
    onPublished(template);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing != null ? `Upravit: ${DOW_LONG[editing]}` : 'Ruční týden'}
      footer={
        editing != null && draft ? (
          <>
            <Button onClick={() => setEditing(null)}>Zrušit</Button>
            <Button variant="primary" className="flex-1" disabled={!isValidSpec(draft)} onClick={() => { setWeek({ ...week, days: week.days.map((d) => (d.dow === editing ? { ...d, workout: draft } : d)) }); setEditing(null); }}>Hotovo</Button>
          </>
        ) : (
          <Button variant="primary" className="flex-1" onClick={publish}>Pokračovat k datu</Button>
        )
      }
    >
      {editing != null && draft ? (
        <WorkoutEditor value={draft} onChange={setDraft} />
      ) : (
        <div className="space-y-4">
          <Field label="Název plánu"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <ul className="space-y-1">
            {week.days.map((d) => (
              <li key={d.dow}>
                <button type="button" onClick={() => { setDraft(structuredClone(d.workout)); setEditing(d.dow); }} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border border-line px-3 text-left">
                  <span className="w-20 shrink-0 text-[14px] text-muted">{DOW_LONG[d.dow]}</span>
                  <span className="flex-1 font-medium">{d.workout.title}</span>
                  <span className="num text-[13px] text-muted">{d.workout.type === 'rest' ? '' : workoutSummary(d.workout)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="num text-[14px] text-muted">Součet: {formatKm(total.totalM)}{total.unknown ? ` + ${total.unknown}× bez uvedené délky` : ''}</p>
          <div>
            <span className="mb-1 block text-[13px] font-medium text-muted">Opakovat kolik týdnů</span>
            <Segmented label="Počet týdnů" value={repeat} onChange={setRepeat} options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Zadání návrhu plánu (§5.4). Funguje i bez AI; kostru staví deterministický generátor. */
export function DraftFormSheet({ open, onClose, profile, onCreated }: { open: boolean; onClose: () => void; profile: AthleteProfile; onCreated: (draftId: string) => void }) {
  const today = todayIso(profile.timezone);
  const [intent, setIntent] = useState<TrainingIntent>(profile.intent ?? 'maintain');
  const [horizon, setHorizon] = useState<number | 'date'>(4);
  const [until, setUntil] = useState(profile.raceDate ?? '');
  const [startDate, setStartDate] = useState(defaultStart(today));
  const [weeklyKm, setWeeklyKm] = useState(profile.weeklyKm ? String(profile.weeklyKm) : '');
  const [runs, setRuns] = useState(profile.runsPerWeek ?? 4);
  const [rest, setRest] = useState<number[]>(profile.restDows);
  const [longDow, setLongDow] = useState<number>(profile.longRunDow);
  const [raceKm, setRaceKm] = useState(profile.raceDistanceM ? String(profile.raceDistanceM / 1000) : '');

  const km = Number(weeklyKm.replace(',', '.'));
  const weeks = horizon === 'date' ? (until && until >= startDate ? weeksUntil(startDate, until) : 0) : horizon;
  const valid = km >= 5 && weeks >= 1 && weeks <= 52 && rest.length < 7;

  const create = async () => {
    const rk = Number(raceKm.replace(',', '.'));
    const raceDate = intent === 'race' ? (horizon === 'date' ? until : profile.raceDate) : undefined;
    const r = await createDraft(
      {
        intent, weeks, startDate, weeklyKm: km, runsPerWeek: Math.min(runs, 7 - rest.length), restDows: rest, longRunDow: longDow,
        raceDate: raceDate || undefined, raceDistanceM: intent === 'race' && rk > 0 ? rk * 1000 : undefined,
        assumptions: ['Výchozí objem je údaj, který jsi zadal(a); z historie běhů se nepočítal.'],
      },
      `${INTENT_LABEL[intent]} · ${weeks} ${weeks === 1 ? 'týden' : weeks < 5 ? 'týdny' : 'týdnů'}`,
      'user',
      'Nový návrh z formuláře',
    );
    if (!r.ok) { toast(r.message, { tone: 'error' }); return; }
    onCreated(r.draft!.id);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Navrhnout plán" footer={<Button variant="primary" className="flex-1" disabled={!valid} onClick={create}>Vytvořit návrh</Button>}>
      <div className="space-y-4">
        <Segmented label="Záměr" value={intent} onChange={setIntent} options={[{ value: 'maintain', label: 'Udržování' }, { value: 'improve', label: 'Zlepšení' }, { value: 'race', label: 'Závod' }]} />
        <div>
          <span className="mb-1 block text-[13px] font-medium text-muted">Na jak dlouho</span>
          <Segmented label="Délka návrhu" value={horizon} onChange={setHorizon} options={[{ value: 1, label: '1 týden' }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 'date', label: 'Do data' }]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Začátek"><input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          {horizon === 'date' && <Field label={intent === 'race' ? 'Datum závodu' : 'Do data'} hint={weeks ? `${weeks} týdnů` : undefined}><input type="date" className={inputClass} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
        </div>
        {intent === 'race' && <Field label="Délka závodu v km"><input inputMode="decimal" className={inputClass} value={raceKm} onChange={(e) => setRaceKm(e.target.value)} placeholder="10" /></Field>}
        <Field label="Výchozí týdenní objem v km" hint="Návrh z něj vychází. Udržování ho nenavyšuje.">
          <input inputMode="decimal" className={inputClass} value={weeklyKm} onChange={(e) => setWeeklyKm(e.target.value)} placeholder="např. 40" />
        </Field>
        <div>
          <span className="mb-1 block text-[13px] font-medium text-muted">Běhů týdně</span>
          <Segmented label="Běhů týdně" value={runs} onChange={setRuns} options={[3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <div>
          <span className="mb-1 block text-[13px] font-medium text-muted">Dny bez běhu</span>
          <DayToggles label="Dny bez běhu" value={rest} onChange={setRest} />
        </div>
        <Field label="Den dlouhého běhu">
          <select className={inputClass} value={longDow} onChange={(e) => setLongDow(Number(e.target.value))}>
            {DOW_LONG.map((d, i) => <option key={d} value={i} disabled={rest.includes(i)}>{d}</option>)}
          </select>
        </Field>
        <p className="text-[13px] text-muted">Začátek {formatDay(startDate, { weekday: true })}. Návrh nic nemění, dokud ho nepoužiješ.</p>
      </div>
    </Sheet>
  );
}
