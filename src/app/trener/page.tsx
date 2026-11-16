'use client';

import { PaperPlaneRight, Stop } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { addSystemNote, addUserMessage, applyProposal, dismissProposal, reply, THREAD_ID } from '@/ai/coach';
import { currentEngine, MODEL_OPTIONS } from '@/ai/webllm';
import { db } from '@/db/db';
import { undoRevision } from '@/db/repo';
import { formatDay } from '@/domain/dates';
import type { AiUsageEvent, CoachMessage, ContextRef } from '@/domain/types';
import { cancelModel, ensureSupport, optionOf, startModel, useAi } from '@/ui/aiStore';
import { DraftCard } from '@/ui/DraftCard';
import { useProfile } from '@/ui/hooks';
import { DraftFormSheet } from '@/ui/PlanSetup';
import { Button, Chip, cx, Sheet, toast } from '@/ui/primitives';

const QUICK = ['Jak vypadá můj týden?', 'Zítra nemůžu běhat, co s tím?', 'Navrhni mi čtyři týdny na udržování.'];

function ProposalCard({ m }: { m: CoachMessage }) {
  const p = m.proposal!;
  if (p.state === 'invalid' || p.state === 'stale') {
    return <p className="mt-2 rounded-[8px] bg-warn-soft px-3 py-2 text-[14px] text-warn">{p.error ?? 'Návrh změny se nepodařilo ověřit.'} Změnu můžeš udělat ručně v plánu.</p>;
  }
  return (
    <div className="mt-2 space-y-2 rounded-[12px] border border-line bg-surface p-3">
      <p className="text-[13px] font-medium text-muted">Návrh změny rozpisu</p>
      <ul className="num space-y-1 text-[15px]">{(p.summary ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
      {p.state === 'pending' && (
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={async () => { const r = await applyProposal(m.id); if (!r.ok) toast(r.message ?? 'Návrh nejde použít.', { tone: 'error' }); }}>Použít</Button>
          <Link href="/plan/" className="flex min-h-11 flex-1 items-center justify-center rounded-[8px] bg-surface-2 font-medium">Upravit</Link>
          <Button className="flex-1" onClick={() => dismissProposal(m.id)}>Nechat být</Button>
        </div>
      )}
      {p.state === 'applied' && (
        <div className="flex items-center gap-3 text-[14px]">
          <Chip tone="accent">Použito</Chip>
          <Link href="/plan/" className="min-h-11 content-center font-medium text-accent underline">Otevřít týden</Link>
          {p.revisionId && <button type="button" className="min-h-11 font-medium text-accent underline" onClick={async () => { const u = await undoRevision(p.revisionId!); toast(u.ok ? 'Změna vrácena.' : u.message, { tone: u.ok ? 'info' : 'error' }); }}>Vrátit</button>}
        </div>
      )}
      {p.state === 'dismissed' && <Chip>Nepoužito</Chip>}
    </div>
  );
}

export default function CoachPage() {
  const profile = useProfile();
  const ai = useAi();
  const messages = useLiveQuery(() => db().messages.where('[threadId+seq]').between([THREAD_ID, 0], [THREAD_ID, Infinity]).toArray(), []);
  const [text, setText] = useState('');
  const [refs, setRefs] = useState<ContextRef[]>([]);
  const [stream, setStream] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AiUsageEvent | null>(null);
  const [draftForm, setDraftForm] = useState(false);
  const [models, setModels] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  useEffect(() => {
    void ensureSupport();
    // Rozepsaný vstup přežije přepnutí záložky i uspání (§13).
    setText(sessionStorage.getItem('rt.coachDraft') ?? '');
    const id = new URLSearchParams(window.location.search).get('jednotka');
    if (id) void db().workouts.get(id).then((w) => w && setRefs([{ kind: 'workout', id: w.id, label: `${w.workout.title}, ${formatDay(w.date, { weekday: true })}` }]));
    const onScroll = () => { nearBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { sessionStorage.setItem('rt.coachDraft', text); }, [text]);
  // Při čtení historie se chat sám neposouvá (§4.5).
  useEffect(() => { if (nearBottom.current) endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length, stream?.text]);

  const send = async (value: string) => {
    const content = value.trim();
    if (!content || busy) return;
    setText('');
    nearBottom.current = true;
    await addUserMessage(content, refs);
    const engine = currentEngine();
    if (!engine) {
      await addSystemNote('Lokální AI není spuštěná, takže ti teď neodpovím. Zpráva zůstala uložená. Plán, přesuny i návrh plánu fungují bez ní.');
      return;
    }
    setBusy(true);
    try {
      await reply(engine, refs, (id, t) => setStream({ id, text: t }));
    } finally {
      setStream(null);
      setBusy(false);
    }
  };

  if (!profile || !messages) return null;
  const preferred = optionOf(profile.aiModelId) ?? MODEL_OPTIONS[1];

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      {ai.status !== 'ready' && (
        <div className="mb-3 space-y-2 rounded-[12px] border border-line bg-surface p-3 text-[14px]">
          {ai.support && !ai.support.ok ? (
            <p className="text-muted">{ai.support.reason}</p>
          ) : ai.status === 'loading' ? (
            <>
              <p className="font-medium">Stahuji a spouštím model {optionOf(ai.modelId)?.label}</p>
              <progress className="h-2 w-full" value={ai.progress?.value ?? 0} max={1} aria-label="Průběh stahování" />
              <p className="break-words text-[12px] text-muted">{ai.progress?.text}</p>
              <Button onClick={cancelModel}>Storno</Button>
            </>
          ) : (
            <>
              <p className="text-muted">Trenér běží jako model přímo v telefonu. Nejdřív se musí stáhnout (stovky MB až přes 1 GB podle modelu), pak funguje i offline. Jak rychlý a jak dobrý bude na tvém zařízení, zatím není změřené.</p>
              {ai.error && <p className="text-danger">{ai.error}</p>}
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => startModel(preferred)}>Spustit {preferred.label}</Button>
                <Button onClick={() => setModels(true)}>Jiný model</Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2 pt-4">
            <p className="text-muted">Zeptej se na běh, týden nebo cíl. Trenér vidí tvůj rozpis a poslední běhy; co neví, řekne.</p>
            {QUICK.map((q) => <button key={q} type="button" onClick={() => send(q)} className="block min-h-11 w-full rounded-[8px] border border-line bg-surface px-3 text-left text-[15px]">{q}</button>)}
          </div>
        )}
        {messages.map((m) => {
          const live = stream?.id === m.id ? stream.text : m.text;
          if (m.role === 'system') {
            return (
              <div key={m.id} className="space-y-2">
                <p className="rounded-[8px] bg-surface-2 px-3 py-2 text-[14px] text-muted">{m.text}</p>
                {m.draftId && <DraftCard draftId={m.draftId} compact />}
              </div>
            );
          }
          const mine = m.role === 'user';
          return (
            <div key={m.id} className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
              {m.contextRefs?.map((r) => <span key={r.id} className="mb-1 text-[12px] text-muted">k: {r.label}</span>)}
              <div className={cx('max-w-[88%] whitespace-pre-wrap rounded-[16px] px-3.5 py-2 text-[15px]', mine ? 'bg-accent text-accent-ink' : 'border border-line bg-surface')}>
                {live || (m.status === 'streaming' ? '…' : m.status === 'error' ? 'Odpověď se nepodařila.' : '')}
              </div>
              {!mine && m.status === 'stopped' && <span className="mt-1 text-[12px] text-muted">zastaveno</span>}
              {!mine && m.proposal && <div className="w-full"><ProposalCard m={m} /></div>}
              {!mine && m.draftId && <div className="mt-2 w-full"><DraftCard draftId={m.draftId} compact /></div>}
              {!mine && m.usageEventId && m.status !== 'streaming' && (
                <button type="button" className="mt-0.5 min-h-8 text-[12px] text-muted underline" onClick={async () => setDetail((await db().usage.get(m.usageEventId!)) ?? null)}>spotřeba</button>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] -mx-4 mt-3 space-y-2 border-t border-line bg-bg px-4 pb-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {refs.map((r) => <Chip key={r.id} tone="accent" onRemove={() => setRefs(refs.filter((x) => x.id !== r.id))}>{r.label}</Chip>)}
          <button type="button" className="min-h-8 text-[13px] font-medium text-accent underline" onClick={() => setDraftForm(true)}>Navrhnout plán formulářem</button>
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <label className="sr-only" htmlFor="coach-input">Zpráva trenérovi</label>
          <textarea
            id="coach-input"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
            placeholder="Napiš trenérovi…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[12px] border border-line bg-surface px-3 py-2.5 text-base"
          />
          {busy ? (
            <button type="button" aria-label="Zastavit generování" onClick={() => currentEngine()?.stop()} className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger"><Stop size={20} weight="fill" /></button>
          ) : (
            <button type="submit" aria-label="Odeslat" disabled={!text.trim()} className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-40"><PaperPlaneRight size={20} weight="fill" /></button>
          )}
        </form>
      </div>

      <Sheet open={detail != null} onClose={() => setDetail(null)} title="Spotřeba požadavku">
        {detail && (
          <dl className="num space-y-2 text-[15px]">
            {[
              ['Režim', detail.mode === 'local' ? 'lokálně v zařízení' : 'cloud'],
              ['Model', detail.model],
              ['Stav', detail.status === 'completed' ? 'dokončeno' : detail.status === 'stopped' ? 'zastaveno' : 'selhalo'],
              ['Doba', `${(detail.durationMs / 1000).toFixed(1)} s`],
              ['Vstupní tokeny', detail.inputTokens ?? 'neznámé'],
              ['Výstupní tokeny', detail.outputTokens ?? 'neznámé'],
              ['Celkem', detail.totalTokens ?? 'neznámé'],
              ['Původ čísel', detail.measurementKind === 'tokenized' ? 'spočítáno tokenizerem modelu' : detail.measurementKind === 'reported' ? 'hlášeno poskytovatelem' : detail.measurementKind === 'estimated' ? 'odhad' : 'nezměřeno'],
            ].map(([k, v]) => <div key={String(k)} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
            <p className="pt-2 text-[13px] text-muted">Lokální model neúčtuje žádné cloudové tokeny. Neznámá hodnota neznamená nulu.</p>
          </dl>
        )}
      </Sheet>

      <Sheet open={models} onClose={() => setModels(false)} title="Vybrat model">
        <ul className="space-y-2">
          {MODEL_OPTIONS.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => { setModels(false); void startModel(o); }} className="w-full rounded-[8px] border border-line px-3 py-2 text-left">
                <span className="block font-medium">{o.label}</span>
                <span className="block text-[13px] text-muted">{o.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <DraftFormSheet open={draftForm} onClose={() => setDraftForm(false)} profile={profile} onCreated={async (id) => { setDraftForm(false); await addSystemNote('Návrh plánu z formuláře:', { draftId: id }); }} />
    </div>
  );
}
