'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { initializeAccount, useAccount } from '@/cloud/auth';
import { watchSync } from '@/cloud/sync';
import { Button } from './primitives';

export function AccountGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void initializeAccount().then(() => setReady(true)).catch(e => setError((e as Error).message)); }, []);
  useEffect(() => { if (ready && account) return watchSync(account.id); }, [ready, account]);
  if (!ready) return <div className="mx-auto max-w-xl space-y-3 px-4 py-8" role="status">{error || 'Otevírám tvůj prostor…'}{error && <Button onClick={() => location.reload()}>Zkusit znovu</Button>}</div>;
  return children;
}
