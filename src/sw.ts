/// <reference lib="webworker" />
// Service worker: app shell a offline cache (§13). Inference ani OCR tu neběží.
import { CacheFirst, ExpirationPlugin, Serwist, type PrecacheEntry } from 'serwist';

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: Array<PrecacheEntry | string> };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // Líně načítané části (lokální AI, PDF, OCR) nejsou v precache; po prvním použití fungují offline.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({ cacheName: 'next-static', plugins: [new ExpirationPlugin({ maxEntries: 80 })] }),
    },
    {
      // Workery a jazyková data importu: velké soubory, stáhnou se až při prvním importu.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/vendor/'),
      handler: new CacheFirst({ cacheName: 'vendor', plugins: [new ExpirationPlugin({ maxEntries: 20 })] }),
    },
  ],
});

serwist.addEventListeners();
