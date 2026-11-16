# Run Tracker – stav implementace

Datum: 16. 11. 2026. Zadání: soukromý RUN_TRACKER_PRODUCT_PLAN.md v3.1.
`[x]` ověřeno · `[~]` implementováno, čeká úplný integrační/device test · `[ ]` zbývá.

## Platná rozhodnutí

- [x] Veřejná mobilní PWA; primární telefon Pixel 10.
- [x] Trenér ve vlastním externím Claude/ChatGPT, kontrolované kopírování a validovaný návrat. Lokální model a přímý API chat odstraněny.
- [x] Supabase Free, region EU Frankfurt. Google OAuth nastavený poskytovatelem; e-mail je doplňková cesta.
- [x] Strava API pro zobrazení a osobní konektor v externím AI jsou dva samostatné přístupy.

## M1 – základ

- [x] Next/React/TypeScript/Tailwind/Zod/Dexie, PWA manifest a service worker.
- [x] Dnes / Plán / Trenér / Profil, onboarding, příkazy, audit a undo.
- [x] Původní plány a zdrojová čísla týdnů zůstávají zachované.
- [~] Spodní navigace drží vlastní vykreslovací vrstvu a nezmizí při načítání profilu; fyzický Pixel test zbývá.
- [ ] Čtečka obrazovky, větší písmo a kompletní offline instalace na telefonu.

## M2 – plán a import

- [x] Ruční týden, aktivace od libovolného týdne, přeskočení a pauzy, historie/přesuny/undo.
- [x] PDF: textová vrstva s geometrií, OCR fallback a kontrolní výřezy.
- [x] Referenční L4: 12 týdnů, součty a km/mílové varianty; úplný lokální OCR test prošel.
- [x] Opakování přes zalomení, více pracovních částí, inline ×, oddělené posilování; originální instrukce se zachová.
- [x] Editor segmentů, opakování, pauz, rovinek a pořadí; oprava hodnot bez zahození struktury.
- [x] Kontrola importu po jednom vybraném týdnu; problémy a neplatné jednotky se nepřevezmou potichu.
- [~] Tabulka temp: konzervativní rozpoznání úplných řádků, výběr cíle a potvrzení proti originálu. Obecné případy testované, celé nové browser PDF workflow ještě projít.
- [x] Čas → rozsah km, více bloků, poslední pauza neurčená = rozsah, chybějící tempo = nevyčíslená část.
- [x] Výhled týdne nahrazuje jednoznačný den skutečností. Dva stejně dlouhé běhy v den se nespojí bez blízkého času startu.
- [ ] Odlišný formát dokumentu (G4), automatické rozpoznání cílové délky a historický rozpis „platný tehdy“.

## M3 – aktivity

- [x] GPX/TCX, deduplikace, metriky, kola, párování, check-in a hodnocení dostupných údajů.
- [x] Kontext konkrétní vlastní aktivity v trenérovi včetně kol; odkaz z detailu.
- [~] FIT a reálné soubory různých hodinek.

## M4 – externí trenér a drafty

- [x] Otázka a evidence pack z vlastního plánu/souborů; Strava API data/tokeny nejsou přítomné.
- [x] Náhled podkladů, kopírování, odkazy na vlastní Claude/ChatGPT a oficiální návod Stravy.
- [x] Návrat JSON → validace → karta návrhu; přesun/vynechání/úprava s potvrzením a undo.
- [x] Kompletní vlastní `weekEntries` vytvoří draft; duplicitní/neúplné dny se odmítnou.
- [x] Iterace, zámky, verze, částečné obnovení a atomická aktivace aktuálního draftu.
- [x] Browser průchod návratem externího návrhu do draftu.
- [~] Rozpracované předání v sessionStorage, oddělené podle účtu; reload/přepnutí na fyzickém telefonu zbývá.
- [x] Historická usage zůstává; nová spotřeba externího chatu je výslovně neměřitelná.
- [ ] Více změn v jediném schvalovaném balíčku; řízená paměť mezi externími konverzacemi.

## M5 – účty a synchronizace

- [x] Supabase Free projekt a bootstrap RLS, soukromý bucket, verzované ukládání.
- [x] Živý SQL test: dva účty, zakázané čtení/zápis cizích dat, soukromé soubory, anonymní zákaz, optimistic concurrency. Testovací záznamy rollback.
- [x] Validace snapshotu, konzistentní obnova, odmítnutí chybějícího dokumentu a souběžné lokální změny – testy.
- [x] Účty/host mají oddělené databáze a klíče rozpracovaného stavu.
- [~] Google/e-mail přihlášení, zapínaná autosynchronizace, návrat online, řešení konfliktu a převzetí hosta.
- [~] Privátní upload/download originálů s kontrolním součtem – klient implementovaný, reálný round trip mezi zařízeními zbývá.
- [ ] Plný export/obnova včetně binárních originálů a samoobslužné smazání účtu/cloudových dat.
- [ ] Otestovat změny na dvou fyzických zařízeních a výpadek během ukládání.

## M6 – Strava a integrace

- [x] Netlify badge vypnutý v nastavení projektu.
- [x] Strava callback, Client ID a produkční secret nastavené v Netlify; secret není v repu.
- [x] Stránkování aktivit, 7denní cache, odpojení, prokliky, atribuce a izolace od AI/exportu.
- [x] Při chybějící konfiguraci cesta do návodu místo slepého červeného toastu.
- [~] Produkční OAuth/refresh/sync s reálným účtem – ověřit po novém nasazení.
- [ ] Veřejná kapacita Stravy (nyní 1 sportovec), webhooky revoke/delete, serverové tokeny.
- [x] Oficiální osobní konektor ve vlastním Claude je oddělená cesta; veřejná PWA neprovozuje Strava AI proxy.

## M7 – vydání a provoz

- [x] GitHub/Netlify propojení a produkční build.
- [x] Stránka soukromí popisuje aktuální ukládání a omezení.
- [ ] Google OAuth audience/test users/publikace ověřit na reálném přihlášení.
- [ ] Veřejné e-mailové přihlášení: vlastní SMTP, ověření domény a doručitelnost.
- [ ] Pixel 10: instalace, offline, scroll/navigace, přepnutí do externího chatu a návrat.
- [ ] Automatické zálohy, provozní retence/cleanup, obnovení po ztrátě zařízení a úplné smazání účtu.

Poslední ověření: 44 testů + samostatný referenční PDF test; další drobná oprava deduplikace čeká finální test run. Produkční sestavení průběžně prochází. Přesné vydání a závěrečné ověření doplnit po nasazení.
