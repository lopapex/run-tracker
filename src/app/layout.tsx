import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { Barlow_Condensed } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';
import { AccountGate } from '@/ui/AccountGate';
import './globals.css';

const display = Barlow_Condensed({ subsets: ['latin', 'latin-ext'], weight: ['600', '700'], style: ['normal', 'italic'], variable: '--font-barlow', display: 'swap' });

export const metadata: Metadata = {
  title: 'Run Tracker',
  description: 'Běžecký plán, aktivity a trenér v jedné aplikaci. Data zůstávají ve tvém zařízení.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Run Tracker', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f1ea' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0f0a' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" className={`${GeistSans.variable} ${display.variable}`}>
      <body>
        <AccountGate><AppShell>{children}</AppShell></AccountGate>
      </body>
    </html>
  );
}
