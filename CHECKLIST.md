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
- [~] Netlify funkce a Blobs za běhu.
- [ ] Ověřit v Claude: přidání konektoru bez přihlášení, schvalování zápisových nástrojů, import skutečného PDF, souběh s konektorem Stravy, mobilní aplikace.
- [ ] Omezení počtu požadavků a velikosti prostoru.

## Web

- [x] Úvodní stránka: vytvoření adresy v prohlížeči, návod, soukromí.
- [ ] Ověřit na telefonu.

## Později

- [ ] Týden přímo v konverzaci (MCP Apps).
- [ ] OAuth a adresář Claude.
- [ ] ChatGPT (dnes bez Stravy a se zápisem jen na firemních tarifech).
