# Run Tracker – stav konektoru

Datum: 16. 11. 2026. `[x]` ověřeno · `[~]` implementováno, čeká na ověření v provozu · `[ ]` zbývá.

## Platná rozhodnutí

- [x] Produkt je konektor pro Claude, ne samostatná aplikace. Původní PWA je odstraněná (historie do `6fcdf7d`).
- [x] Tokeny jdou z předplatného uživatele v Claude. Vlastní okno chatu ani API klíč se neprovozují.
- [x] Strava jen přes oficiální konektor v Claude. Run Tracker Strava API nepoužívá a data aktivit neukládá.
- [x] Bez účtů: přístup dává tajná adresa konektoru. OAuth až při zařazení do adresáře Claude.
- [x] Úložiště Netlify Blobs, jeden JSON na uživatele.

## Konektor

- [x] Nástroje pro čtení plánu, profil, import po týdnech, aktivaci, přesun, vynechání, úpravu, přidání, obnovu, pauzu/přeskočení týdne, splnění, undo a smazání dat.
- [x] Změny rozpisu jdou přes registr příkazů z domény a jsou vratné.
- [x] Kontrola týdenních součtů při importu.
- [x] Podmíněný zápis proti souběžným změnám; oddělené prostory podle klíče.
- [x] Testy přes skutečný MCP protokol nad úložištěm v paměti; referenční 12týdenní plán prošel importem i aktivací.
- [x] Zápis pocitu a poznámky je součást vratné změny; přeskočený týden jde vrátit i se zápisy.
- [x] Netlify funkce a Blobs za běhu: živý průchod importem, aktivací, přesunem, splněním, undo a smazáním dat.
- [ ] Ověřit v Claude: přidání konektoru bez přihlášení, schvalování zápisových nástrojů, import skutečného PDF, souběh s konektorem Stravy, mobilní aplikace.
- [ ] Omezení počtu požadavků a velikosti prostoru.

## Vizualizace a UI v konverzaci

- [x] Widget s pohledy týden, celý plán, tempa a doběhnuto (odhad splnění, zápis stavu, pocitu a okolností); světlý i tmavý režim, tabulková podoba grafů.
- [x] Každá změna rozpisu vykreslí aktualizovaný týden s možností vrácení; bez plánu widget ukáže, jak začít.
- [x] Záložky a navigace po týdnech přímým voláním nástrojů, akce u jednotek a nápovědy promptů jako zprávy do konverzace.
- [x] Okolnosti běhu (zima, vítr, alkohol den předem, málo tekutin…) se ukládají k jednotce, jdou vrátit a zmírňují hodnocení pomalejšího tempa.
- [x] Export jednotky do Garminu jako FIT trénink; soubor čte nezávislý dekodér. Na hodinkách neověřeno.
- [x] Ikona konektoru v informacích serveru a favicon webu.
- [~] Nová ikona pod novými názvy souborů (Claude si drží ikonu podle adresy); ověřit po odpojení a připojení konektoru.
- [x] Úspora tokenů: krátká id, stručnější výpis plánu, méně opakování v popisech nástrojů.
- [~] Ověřeno jen proti napodobenému hostiteli. V Claude zbývá ověřit vykreslení, zprávy z widgetu, přímé volání nástrojů a zobrazení ikony.
- [ ] Ověřit, jestli Claude předává modelu i data pro widget (structuredContent); pokud ano, přesunout je mimo kontext modelu.

## Web

- [x] Úvodní stránka: vytvoření adresy v prohlížeči, návod, soukromí.
- [ ] Ověřit na telefonu.

## Později

- [ ] OAuth a adresář Claude.
- [ ] ChatGPT (dnes bez Stravy a se zápisem jen na firemních tarifech).
