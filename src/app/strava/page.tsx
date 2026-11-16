'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { completeConnect, StravaError } from '@/strava/client';
import { Card } from '@/ui/primitives';

/** Návrat ze souhlasu ve Stravě. Kód z adresy se hned vymění a z adresy zmizí. */
export default function StravaCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(null, '', '/strava/');
    completeConnect(params)
      .then(() => window.location.replace('/'))
      .catch((e) => setError(e instanceof StravaError ? e.message : 'Propojení se nepodařilo dokončit.'));
  }, []);

  return (
    <Card className="space-y-3">
      {error ? (
        <>
          <h2 className="text-[17px] font-semibold">Stravu se nepodařilo propojit</h2>
          <p className="text-[15px] text-muted">{error}</p>
          <Link href="/" className="inline-flex min-h-11 items-center font-medium text-accent underline">Zpět na přehled</Link>
        </>
      ) : (
        <p aria-live="polite" className="text-muted">Dokončuji propojení se Stravou…</p>
      )}
    </Card>
  );
}
