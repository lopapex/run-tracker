'use client';

import { PaperPlaneRight, Stop } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { addSystemNote, applyProposal, dismissProposal, THREAD_ID } from '@/ai/coach';
import { ExternalCoach } from '@/ui/ExternalCoach';
import { db } from '@/db/db';
import { undoRevision } from '@/db/repo';
import { formatDay } from '@/domain/dates';
import type { AiUsageEvent, CoachMessage, ContextRef } from '@/domain/types';
import { DraftCard } from '@/ui/DraftCard';
import { useProfile } from '@/ui/hooks';
import { DraftFormSheet } from '@/ui/PlanSetup';
import { Button, Chip, Sheet, toast } from '@/ui/primitives';

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
  const messages = useLiveQuery(() => db().messages.where('[threadId+seq]').between([THREAD_ID, 0], [THREAD_ID, Infinity]).toArray(), []);
  const [text, setText] = useState('');
  const [refs, setRefs] = useState<ContextRef[]>([]);
  const [draftForm, setDraftForm] = useState(false);
  const [detail, setDetail] = useState<AiUsageEvent | null>(null);
  useEffect(() => {
    setText(sessionStorage.getItem('rt.coachDraft') ?? '');
    const id = new URLSearchParams(window.location.search).get('jednotka');
    if (id) void db().workouts.get(id).then(w => w && setRefs([{kind: 'workout', id: w.id, label: w.workout.title + ', ' + formatDay(w.date)}]));
    const activityId = new URLSearchParams(window.location.search).get('aktivita');
    if (activityId) void db().activities.get(activityId).then(a => a && setRefs([{kind: 'activity', id: a.id, label: a.name + ', ' + formatDay(a.localDate)}]));
  }, []);
  useEffect(() => { sessionStorage.setItem('rt.coachDraft', text); }, [text]);
  if (!profile || !messages) return null;
  return <div className="space-y-4">
    <div className="space-y-3 rounded-[20px] border border-line bg-surface p-4">
      <h2 className="display text-[28px]">Tvůj trenér, tvůj chat</h2>
      <p className="text-[15px] text-muted">Plán držíš tady. Se svým ChatGPT nebo Claudem probereš běhy ze Stravy a návrh vrátíš zpátky. Bez stahování modelů a API klíčů.</p>
      {refs.map(r => <Chip key={r.id}>{r.label}<button type="button" aria-label="Odebrat kontext" onClick={() => setRefs([])} className="min-h-11 px-2">×</button></Chip>)}
      <textarea aria-label="Otázka pro trenéra" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Např. v sobotu nemůžu běhat. Jak upravit týden?" className="min-h-24 w-full rounded-[12px] border border-line bg-surface px-3 py-2.5 text-base" />
      <ExternalCoach refs={refs} question={text} />
      <div className="flex flex-wrap gap-2">{QUICK.map(q => <button key={q} type="button" onClick={() => setText(q)} className="min-h-11 rounded-full border border-line px-3 text-left text-[13px]">{q}</button>)}</div>
    </div>
    <Button className="w-full" onClick={() => setDraftForm(true)}>Navrhnout plán formulářem</Button>
    {messages.length > 0 && <section className="space-y-3">
      <h3 className="font-semibold">Historie konzultací a návrhů</h3>
      {messages.map(m => <div key={m.id} className="space-y-2 rounded-[16px] border border-line bg-surface p-3">
        <p className="text-[12px] text-muted">{m.role === 'user' ? 'Ty' : m.role === 'system' ? 'Run Tracker' : 'Trenér'} · {new Date(m.at).toLocaleString('cs-CZ')}</p>
        {m.text && <p className="whitespace-pre-wrap text-[15px]">{m.text}</p>}
        {m.proposal && <ProposalCard m={m} />}
        {m.draftId && <DraftCard draftId={m.draftId} />}
        {m.usageEventId && <button type="button" className="min-h-11 text-[12px] text-muted underline" onClick={async () => setDetail((await db().usage.get(m.usageEventId!)) ?? null)}>Historická spotřeba</button>}
      </div>)}
    </section>}
    <Sheet open={detail != null} onClose={() => setDetail(null)} title="Historická spotřeba">
      {detail && <p className="num text-[14px]">{detail.provider} · {detail.model}<br />Vstup {detail.inputTokens ?? 'neznámý'}, výstup {detail.outputTokens ?? 'neznámý'}, celkem {detail.totalTokens ?? 'neznámé'} tokenů.</p>}
    </Sheet>
    <DraftFormSheet open={draftForm} onClose={() => setDraftForm(false)} profile={profile} onCreated={async id => { setDraftForm(false); await addSystemNote('Návrh plánu z formuláře:', {draftId: id}); }} />
  </div>;
}
