'use client';
import { useSyncExternalStore } from 'react';
import { configureWorkspace } from '@/db/db';
import { cloud } from './client';

export interface Account { id: string; email?: string }
let account: Account | null = null;
let initialized: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const useAccount = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => account, () => null);
export function initializeAccount(): Promise<void> {
  initialized ??= (async () => {
    const { data, error } = await cloud.auth.getSession();
    if (error && navigator.onLine) throw new Error('Přihlášení se nepodařilo ověřit. Zkus obnovit stránku.');
    account = data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
    if (!navigator.onLine && error) {
      try { const cached = JSON.parse(localStorage.getItem('rt.lastAccount') ?? 'null'); if (cached && typeof cached.id === 'string') account = cached; } catch { /* bez uloženého účtu */ }
    }
    if (account) localStorage.setItem('rt.lastAccount', JSON.stringify(account));
    else if (!error) localStorage.removeItem('rt.lastAccount');
    configureWorkspace(account?.id ?? null);
    listeners.forEach(l => l());
    let userId = account?.id;
    cloud.auth.onAuthStateChange((_event, session) => {
      if (_event === 'INITIAL_SESSION') return;
      if (session?.user.id !== userId) { userId = session?.user.id; location.reload(); }
    });
  })();
  return initialized;
}
