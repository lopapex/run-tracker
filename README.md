# Run Tracker

Mobilní PWA pro běžecký plán: import plánu z PDF, týdenní kalendář s přesuny a historií změn, aktivity z hodinek, volitelné zobrazení běhů ze Stravy a trenér jako model běžící přímo v telefonu.

Stav: první kolo vývoje (lokální aplikace bez účtů). Co je hotové a co čeká, je v [CHECKLIST.md](CHECKLIST.md).

## Jak to funguje

- **Data jsou v zařízení.** Plány, aktivity i chat se ukládají do IndexedDB. Účty a synchronizace zatím nejsou; zálohou je export v profilu.
- **Import plánu** běží lokálně: PDF.js stránku vykreslí, Tesseract.js přečte text. Umí týdenní tabulky se dny ve sloupcích (anglické názvy dnů). Každou přečtenou buňku jde zkontrolovat proti výřezu originálu.
- **Změny rozpisu** jdou přes jeden registr příkazů (`src/domain/commands.ts`). Každá změna je vratná revize s autorem a důvodem; stejné příkazy používá kalendář i chat.
- **Trenér** je WebLLM model ve Web Workeru. Stahuje se až na vyžádání. Změny plánu jen navrhuje; návrh ověří doména a použije ho až uživatel.
- **Strava** je jen ke čtení a jen k zobrazení (vzdálenost, tempo, splnění, odkaz „View on Strava“). Běhy ze Stravy se drží nejvýš 7 dní a do AI ani do exportu nejdou – to vyžadují podmínky Strava API.

## Vývoj

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # testy domény, úložiště a parseru
npm run build    # statický export do out/ + service worker
```

Vyžaduje Node 24.

## Nasazení (Netlify)

`netlify.toml` nastavuje build (`npm run build`), složku `out` a funkce v `netlify/functions`.

Pro Stravu je potřeba vlastní API aplikace na <https://www.strava.com/settings/api>:

1. „Authorization Callback Domain“ nastav na doménu webu (bez `https://`).
2. V Netlify přidej proměnné prostředí `STRAVA_CLIENT_ID` a `STRAVA_CLIENT_SECRET` (viz `.env.example`).

Bez nich aplikace běží normálně, jen tlačítko „Propojit se Stravou“ ohlásí, že propojení není nastavené. Nová Strava aplikace smí mít jediného sportovce (vlastníka), dokud ji Strava neschválí.

## Struktura

| Složka | Obsah |
|---|---|
| `src/domain` | čisté TypeScript moduly: plán, příkazy, revize, drafty, generátor, aktivity |
| `src/db` | Dexie schéma a transakční operace nad doménou |
| `src/import` | rekonstrukce tabulky plánu z obrázku stránky a čtení buněk |
| `src/ai` | kontrakt `AiEngine`, WebLLM adaptér, trenér |
| `src/strava` | klient Stravy a dočasná cache |
| `src/ui`, `src/app` | komponenty a obrazovky (Next.js App Router, statický export) |
| `netlify/functions` | výměna a obnova tokenů Stravy (client secret nesmí do prohlížeče) |
| `scripts` | build service workeru, kopie workerů, pomůcky pro ladění parseru |

## Licence

MIT
