# Run Tracker

Mobilní PWA pro běžecký plán, skutečné běhy a konzultace ve vlastním Claude/ChatGPT. Stav implementace a zbývající brány jsou v [CHECKLIST.md](CHECKLIST.md).

## Použití

- PDF se čte lokálně: textová vrstva, OCR výřezu a kontrola proti originálu. Import zná tabulky se dny ve sloupcích; není univerzální převodník libovolného PDF.
- Jednotka zachovává rozklus, více částí opakování, pauzy i výklus. Vizuální editor opraví jednotlivé hodnoty a pořadí. Původní instrukce zůstává dostupná.
- Rozsahy tempa přepočítají časové úseky na rozsah kilometrů. Přednost má potvrzená tabulka plánu, případně vlastní tempa z Profilu. Výhled týdne nahradí jednoznačný den skutečným během; neznámé úseky se přiznají.
- Trenér: otázka → zkontrolovat/kopírovat podklady → vlastní externí chat → vložit JSON návrhu → validace → potvrzení změny. Kompletní návrh vzniká nejprve jako draft.
- Oficiální osobní Strava konektor je ověřený pro Claude a vyžaduje předplatné Stravy. Oficiální ChatGPT podpora není v aktuálním seznamu Stravy; aplikace ji neslibuje.
- Lokální inference a přímý API chat byly na pokyn uživatele odstraněny. Žádné stahování modelů ani API klíč uživatele.
- Bez účtu jsou data v IndexedDB. Google/e-mail přihlášení vytvoří samostatný místní prostor. Synchronizace do Supabase se zapíná výslovně; hostovská data lze převzít jako kopii.
- Strava API připojení uvnitř PWA je samostatné a slouží k zobrazení. Tokeny/cache nejsou součástí AI podkladů ani cloudového workspace.

## Vývoj

Node 24. `npm install`, `npm run dev`, `npm run build`.
Testy: `npm test -- --pool=threads --maxWorkers=1`.
Typy: `npm run typecheck -- --incremental false`.
Referenční PDF je soukromé a není v repu; viz `src/import/reference.test.ts`.

## Backend a nasazení

Netlify: `netlify.toml`, statický export `out`, serverová funkce `/api/strava`.
Strava vyžaduje `STRAVA_CLIENT_ID` a tajnou `STRAVA_CLIENT_SECRET` v Netlify. Callback doména musí odpovídat produkčnímu webu. Konfigurace je jednorázová pro provozovatele; běžný uživatel pouze projde OAuth. Kapacita aktuální Strava aplikace je jeden sportovec, veřejný přístup vyžaduje schválení.

Supabase: veřejná klientská konfigurace je v `src/cloud/client.ts`. Publishable klíč je určený pro prohlížeč a nesmí se zaměnit za serverový secret/service_role klíč. Ochranu zajišťuje Auth + RLS. Google klientský secret zůstává v nastavení Supabase, nikoliv v kódu.

`supabase/migrations/202611160001_workspace.sql` byl na novém projektu aplikovaný přes Dashboard SQL. Před prvním použitím CLI migrací je nutné sladit historii migrací; bootstrap nespouštět podruhé bez kontroly existujících policies.

Synchronizace používá atomický verzovaný snapshot (max. 10 MB JSON), privátní originály dokumentů (max. 40 MB každý) a lokální hash základní verze. Souběžné úpravy zobrazí konflikt. Soukromé originály se stáhnou a ověří checksumem před obnovou. Strava tokeny/cache ani lokální sync metadata do snapshotu nepatří.

Supabase Free má omezení kapacity a může po neaktivitě pozastavit projekt. Výchozí e-mailový transport má omezení příjemců; veřejné e-mailové přihlášení vyžaduje vlastní SMTP. Google OAuth má vlastní stav testování/publikace a případného ověření. Plná veřejná produkční akceptace ještě není uzavřená.

## Moduly

| Cesta | Účel |
|---|---|
| `src/domain` | příkazy, revize, drafty, metriky, rozsahy vzdálenosti |
| `src/import` | PDF/OCR, tabulka týdnů a temp |
| `src/ai/coach.ts` | kontrolovaný kontext a validace vrácených návrhů |
| `src/db` | účetní IndexedDB prostory a validovaný snapshot |
| `src/cloud` | Supabase Auth, soukromý sync, konflikty a guest převzetí |
| `src/strava` | OAuth a dočasná oddělená cache |
| `src/ui`, `src/app` | rozhraní, PWA a průchod externím trenérem |

MIT.
