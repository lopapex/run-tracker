'use client';

import { CalendarDots, ChatCircleDots, Sun, UserCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useProfile } from './hooks';
import { Onboarding } from './Onboarding';
import { cx, Toaster } from './primitives';

const TABS = [
  { href: '/', label: 'Dnes', icon: Sun },
  { href: '/plan/', label: 'Plán', icon: CalendarDots },
  { href: '/trener/', label: 'Trenér', icon: ChatCircleDots },
] as const;

const TITLES: Record<string, string> = { '/': 'Dnes', '/plan': 'Plán', '/trener': 'Trenér', '/profil': 'Profil', '/import': 'Import plánu', '/strava': 'Strava' };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = (usePathname() ?? '/').replace(/\/$/, '') || '/';
  const profile = useProfile();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Bez service workeru aplikace běží dál, jen bez offline shellu.
    });
    // Vlastní plán nemá jinou zálohu než export; požádat prohlížeč, ať data nemaže (§13).
    void navigator.storage?.persist?.();
  }, []);

  if (profile === undefined) return <div className="min-h-dvh" aria-busy="true" />;
  if (!profile.onboardedAt) return <Onboarding profile={profile} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-bg/95 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <h1 className="text-[22px] font-semibold tracking-tight">{TITLES[pathname] ?? 'Run Tracker'}</h1>
        <Link href="/profil/" aria-label="Profil a nastavení" className={cx('grid size-11 place-items-center rounded-full', pathname === '/profil' ? 'bg-accent-soft text-accent' : 'text-muted')}>
          <UserCircle size={28} />
        </Link>
      </header>
      <main className="flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav aria-label="Hlavní" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-xl">
          {TABS.map((t) => {
            const active = pathname === (t.href.replace(/\/$/, '') || '/');
            const Icon = t.icon;
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={active ? 'page' : undefined} className={cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium', active ? 'text-accent' : 'text-muted')}>
                  <Icon size={24} weight={active ? 'fill' : 'regular'} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Toaster />
    </div>
  );
}
