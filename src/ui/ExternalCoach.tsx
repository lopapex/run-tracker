'use client';
import { useState } from 'react';
import { addSystemNote, addUserMessage, buildContext, extractCommand, handleCommand, type CoachContext } from '@/ai/coach';
import type { ContextRef } from '@/domain/types';
import { Button, Field, inputClass, Sheet, toast } from './primitives';

export function ExternalCoach({ refs, question }: { refs: ContextRef[]; question: string }) {
  const [open, setOpen] = useState(false);
  const [pack, setPack] = useState('');
  const [context, setContext] = useState<CoachContext | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'chatgpt' | 'claude'>('claude');
  return <>
    <Button className="mb-3 w-full" onClick={async () => {
      const ctx = await buildContext(refs); setContext(ctx);
      if (question.trim()) await addUserMessage(question.trim(), refs);
      setPack(`${ctx.system}\n\nOTÁZKA\n${question.trim() || 'Pomoz mi projít aktuální plán a poslední běhy.'}\n\nPokud máš dostupný oficiální Strava konektor, načti moje relevantní vlastní běhy přes něj. Jinak řekni, že nejsou dostupné. Propojení Stravy v Run Trackeru se sem nepřenáší. Navrženou změnu mého plánu vrať jako jeden blok prikaz podle schématu výše. Nekopíruj do výstupu syrová data Stravy.`);
      setAnswer(''); setOpen(true);
    }}>Probrat v ChatGPT / Claude</Button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Probrat mimo aplikaci">
      <div className="space-y-4">
        <p className="text-[14px] text-muted">Použiješ svůj běžný účet a tarif. Podklady nikam automaticky neposíláme; vložíš je do svého chatu. Jeho tokeny a limity tato aplikace neměří.</p>
        <Field label="Kde chceš pokračovat?"><select className={inputClass} value={provider} onChange={e => setProvider(e.target.value as 'chatgpt' | 'claude')}><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></Field>
        <h3 className="font-semibold">1. Připoj Stravu ve svém chatu</h3>
        {provider === 'claude' ? <p className="text-[14px]">V Claude otevři Customize → Connectors → Discover, vyhledej Strava a zvol Connect. Přihlas se do Stravy a povol čtení. Oficiální konektor vyžaduje předplatné Stravy. Připojení v Run Trackeru je samostatné.</p> : <p className="text-[14px]">Oficiální Strava konektor pro ChatGPT teď Strava neuvádí. Použij ho pro konzultaci plánu a vlastních souborů; přístup ke Stravě tu neslibujeme. Pro živá data ze Stravy zvol Claude. Pokud už vlastní propojení máš, ověř jeho původ a oprávnění ve svém účtu.</p>}
        <a className="inline-flex min-h-11 items-center text-[13px] underline" href="https://support.strava.com/en-us/articles/15401531-how-do-i-connect-strava-to-an-ai-assistant" target="_blank" rel="noopener noreferrer">Aktuální oficiální návod Stravy</a>
        <h3 className="font-semibold">2. Zkopíruj podklady do chatu</h3>
        <details><summary className="min-h-11 cursor-pointer py-2 text-[14px]">Zkontrolovat, co kopíruji</summary><textarea readOnly aria-label="Podklady pro externího trenéra" className={inputClass} rows={10} value={pack} /></details>
        <Button variant="primary" className="w-full" onClick={async () => { try { await navigator.clipboard.writeText(pack); toast('Zkopírováno. Otevři svůj chat a vlož podklady.'); } catch { toast('Kopírování se nepovedlo. Zkopíruj text ručně z náhledu.', { tone: 'error' }); } }}>Zkopírovat plán a otázku</Button>
        <a className="flex min-h-11 items-center justify-center font-medium underline" href={provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/'} target="_blank" rel="noopener noreferrer">Otevřít {provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}</a>
        <h3 className="font-semibold">3. Vrať návrh zpátky</h3>
        <p className="text-[14px] text-muted">Vlož odpověď s blokem „prikaz“. Aplikace ji ověří; změnu rozpisu potvrdíš na kartě. Pokud se plán mezitím změnil, připrav nové podklady.</p>
        <textarea aria-label="Odpověď externího trenéra" className={inputClass} rows={6} value={answer} onChange={e => setAnswer(e.target.value)} />
        <Button disabled={!answer.trim() || !context || busy} onClick={async () => {
          if (!context) return;
          const parsed = extractCommand(answer);
          if (!parsed.raw) { toast('Chybí blok příkazu. Požádej chat o výstup podle podkladů.', { tone: 'error' }); return; }
          setBusy(true);
          try { const outcome = await handleCommand(parsed.raw, context); await addSystemNote(`Návrh z ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}`, outcome); setOpen(false); } finally { setBusy(false); }
        }}>Zkontrolovat a zobrazit návrh</Button>
      </div>
    </Sheet>
  </>;
}
