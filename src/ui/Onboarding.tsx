'use client';

import { useState } from 'react';
import { saveProfile } from '@/db/repo';
import { INTENT_LABEL } from '@/domain/drafts';
import type { AthleteProfile, Dow, TrainingIntent } from '@/domain/types';
import { Button, DayToggles, Field, inputClass, Segmented } from './primitives';

/** První otevření (§4.2). Každý krok jde přeskočit a doplnit později v profilu. */
export function Onboarding({ profile }: { profile: AthleteProfile }) {
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<TrainingIntent | undefined>(profile.intent);
  const [weeklyKm, setWeeklyKm] = useState(profile.weeklyKm ? String(profile.weeklyKm) : '');
  const [runs, setRuns] = useState(profile.runsPerWeek ?? 4);
  const [rest, setRest] = useState<number[]>(profile.restDows);
  const [raceDate, setRaceDate] = useState(profile.raceDate ?? '');
  const [raceKm, setRaceKm] = useState(profile.raceDistanceM ? String(profile.raceDistanceM / 1000) : '');

  const finish = async (skip: boolean) => {
    const km = Number(weeklyKm.replace(',', '.'));
    const rk = Number(raceKm.replace(',', '.'));
    await saveProfile({
      onboardedAt: new Date().toISOString(),
      ...(skip
        ? {}
        : {
            intent,
            weeklyKm: km > 0 ? km : undefined,
            runsPerWeek: runs,
            restDows: rest as Dow[],
            raceDate: intent === 'race' && raceDate ? raceDate : undefined,
            raceDistanceM: intent === 'race' && rk > 0 ? rk * 1000 : undefined,
          }),
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <p className="text-[13px] font-medium text-muted">Krok {step + 1} ze 3</p>
      {step === 0 && (
        <div className="mt-3 flex-1 space-y-5">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Běžecký plán, který se přizpůsobí tvému týdnu</h1>
          <p className="text-muted">Naimportuj plán z PDF, zapiš si týden ručně, nebo si nech navrhnout nový. Všechno zůstává v tomhle zařízení, bez účtu.</p>
          <dl className="space-y-3 rounded-[16px] border border-line bg-surface p-4 text-[15px]">
            <div className="flex justify-between gap-4"><dt className="text-muted">Jazyk</dt><dd>čeština</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Jednotky</dt><dd>km, min/km</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Časová zóna</dt><dd>{profile.timezone}</dd></div>
          </dl>
        </div>
      )}
      {step === 1 && (
        <div className="mt-3 flex-1 space-y-5">
          <h1 className="text-[24px] font-semibold tracking-tight">O co ti teď jde?</h1>
          <div className="space-y-2">
            {(Object.keys(INTENT_LABEL) as TrainingIntent[]).map((k) => (
              <button key={k} type="button" aria-pressed={intent === k} onClick={() => setIntent(k)} className={`flex min-h-14 w-full items-center rounded-[12px] border px-4 text-left font-medium ${intent === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface'}`}>
                {INTENT_LABEL[k]}
              </button>
            ))}
          </div>
          {intent === 'race' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Datum závodu (volitelné)"><input type="date" className={inputClass} value={raceDate} onChange={(e) => setRaceDate(e.target.value)} /></Field>
              <Field label="Délka v km (volitelné)"><input inputMode="decimal" className={inputClass} value={raceKm} onChange={(e) => setRaceKm(e.target.value)} placeholder="21,1" /></Field>
            </div>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="mt-3 flex-1 space-y-5">
          <h1 className="text-[24px] font-semibold tracking-tight">Jak teď běháš?</h1>
          <Field label="Obvyklý týdenní objem v km" hint="Slouží jako výchozí bod návrhů. Když nevíš, nech prázdné.">
            <input inputMode="decimal" className={inputClass} value={weeklyKm} onChange={(e) => setWeeklyKm(e.target.value)} placeholder="např. 40" />
          </Field>
          <div>
            <span className="mb-1 block text-[13px] font-medium text-muted">Běhů týdně</span>
            <Segmented label="Běhů týdně" value={runs} onChange={setRuns} options={[3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} />
          </div>
          <div>
            <span className="mb-1 block text-[13px] font-medium text-muted">Dny, kdy běhat nemůžeš</span>
            <DayToggles label="Dny bez běhu" value={rest} onChange={setRest} />
          </div>
        </div>
      )}
      <div className="mt-6 flex gap-2">
        {step > 0 && <Button onClick={() => setStep(step - 1)}>Zpět</Button>}
        <Button variant="ghost" onClick={() => finish(true)}>Přeskočit</Button>
        <Button variant="primary" className="flex-1" onClick={() => (step < 2 ? setStep(step + 1) : finish(false))}>{step < 2 ? 'Pokračovat' : 'Hotovo'}</Button>
      </div>
    </div>
  );
}
