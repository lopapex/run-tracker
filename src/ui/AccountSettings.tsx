'use client';
import { useEffect, useState } from 'react';
import { useAccount } from '@/cloud/auth';
import { cloud } from '@/cloud/client';
import { enableSync, importGuest, syncEnabled, syncWorkspace, useSyncState } from '@/cloud/sync';
import { exportAll } from '@/db/repo';
import { Button, Field, inputClass } from './primitives';

export function AccountSettings() {
  const account = useAccount();
  const sync = useSyncState();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [choice, setChoice] = useState<'local'|'remote'|null>(null);
  useEffect(() => { setEnabled(account ? syncEnabled(account.id) : false); }, [account]);
  if (!account) return <div className="space-y-3">
    <p className="text-[14px] text-muted">Bez účtu máš data v tomto prohlížeči. Přihlášení přidá soukromý prostor pro synchronizaci mezi zařízeními. Běžný tarif ChatGPT / Claude se připojuje zvlášť v Trenérovi.</p>
    <Button variant="primary" className="w-full" disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { const {error} = await cloud.auth.signInWithOAuth({provider:'google', options:{redirectTo:`${location.origin}/profil/`, queryParams:{prompt:'select_account'}}}); if(error) { setMessage('Přihlášení přes Google se nepodařilo spustit. Zkus to později nebo použij e-mail.'); setBusy(false); } } catch { setMessage('Přihlašovací služba není dostupná.'); setBusy(false); } }}>Pokračovat přes Google</Button>
    <p className="text-center text-[12px] text-muted">nebo přihlašovací odkaz do e-mailu</p>
    <Field label="Tvůj e-mail"><input className={inputClass} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
    <Button className="w-full" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={async () => {
      setBusy(true); setMessage('');
      try { const {error} = await cloud.auth.signInWithOtp({email: email.trim(), options:{emailRedirectTo: `${location.origin}/profil/`}}); setMessage(error ? 'Přihlášení se nepodařilo odeslat. Zkontroluj adresu; v testovacím provozu může být doručování omezené na povolené e-maily.' : 'Zkontroluj e-mail a otevři přihlašovací odkaz v tomto prohlížeči. Nepřišel? Počkej minutu a zkontroluj spam.'); } catch { setMessage('Jsi offline nebo přihlašovací služba neodpovídá. Lokální data zůstávají dostupná.'); } finally { setBusy(false); }
    }}>{busy ? 'Odesílám…' : 'Poslat přihlašovací odkaz'}</Button>
    <p className="text-[12px] text-muted">E-mail slouží k přihlášení přes Supabase. <a href="/soukromi/" className="underline">Jak se ukládají data</a></p>
    {message && <p role="status" className="text-[14px]">{message}</p>}
  </div>;
  return <div className="space-y-3 text-[14px]">
    <p className="font-medium">Přihlášený účet: {account.email}</p>
    <p className="text-muted">Synchronizuje se plán, vlastní importované aktivity, poznámky, konzultace a originály PDF do privátního prostoru Supabase v EU. Přístupy ke Stravě a její API cache zůstávají jen v zařízení.</p>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} onChange={e => { const on = e.target.checked; setEnabled(on); enableSync(account.id, on); if (on) void syncWorkspace(account.id); }} />Zapnout automatickou synchronizaci tohoto účtu</label>
    <p role="status" className={sync.phase === 'conflict' || sync.phase === 'error' ? 'text-warn' : 'text-muted'}>{!enabled ? 'Automatická synchronizace je vypnutá.' : sync.phase === 'syncing' ? 'Synchronizuji…' : sync.message ?? (sync.at ? `Naposledy synchronizováno ${new Date(sync.at).toLocaleString('cs-CZ')}` : 'Čeká na první synchronizaci.')}</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || sync.phase === 'syncing'} onClick={() => { enableSync(account.id,true); setEnabled(true); void syncWorkspace(account.id); }}>Synchronizovat teď</Button><Button disabled={busy} onClick={async () => { setBusy(true); try { await importGuest(account.id); setMessage('Lokální data převzatá. Původní kopie zůstala zachovaná; Stravu připoj znovu v tomto účtu.'); } catch(e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Převzít data z používání bez účtu</Button></div>
    {sync.phase === 'conflict' && <div className="space-y-2 rounded-[12px] border border-warn p-3">
      <p>Automatické přepsání je pozastavené. Jedna verze nahradí druhou; nejdřív si stáhni lokální export.</p>
      <Button onClick={async () => { const url = URL.createObjectURL(await exportAll()); const a=document.createElement('a'); a.href=url; a.download='run-tracker-pred-sloucenim.json'; a.click(); URL.revokeObjectURL(url); }}>Exportovat místní verzi</Button>
      <div className="flex flex-wrap gap-2"><Button onClick={() => setChoice('remote')}>Použít cloudovou verzi</Button><Button onClick={() => setChoice('local')}>Použít verzi tohoto zařízení</Button></div>
      {choice && <div className="space-y-2"><p>{choice === 'remote' ? 'Cloudová verze nahradí místní plány a záznamy tohoto účtu.' : 'Verze tohoto zařízení nahradí cloudovou kopii účtu.'} Chceš pokračovat?</p><Button onClick={() => setChoice(null)}>Zrušit</Button><Button variant="primary" onClick={() => { const resolution=choice; setChoice(null); void syncWorkspace(account.id,resolution); }}>Potvrdit vybranou verzi</Button></div>}
    </div>}
    {message && <p role="status">{message}</p>}
    <Button className="w-full" disabled={busy} onClick={async () => { const {error}=await cloud.auth.signOut({scope:'local'}); if(error) setMessage('Odhlášení se nepodařilo. Zkus to znovu.'); }}>Odhlásit tento prohlížeč</Button>
  </div>;
}
