import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';
import './globals.css';

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
    { media: '(prefers-color-scheme: light)', color: '#f6f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f120f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" className={GeistSans.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
