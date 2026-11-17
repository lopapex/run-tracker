# Run Tracker – stav konektoru

Datum: 17. 11. 2026. `[x]` ověřeno · `[~]` implementováno, čeká na ověření v provozu · `[ ]` zbývá.

## Platná rozhodnutí

- [x] Produkt je konektor pro Claude, ne samostatná aplikace. Původní PWA je odstraněná (historie do `6fcdf7d`).
- [x] Tokeny jdou z předplatného uživatele v Claude. Vlastní okno chatu ani API klíč se neprovozují.
- [x] Strava jen přes oficiální konektor v Claude. Run Tracker Strava API nepoužívá a data aktivit neukládá.
- [x] Bez účtů: přístup dává tajná adresa konektoru. OAuth až při zařazení do adresáře Claude.
- [x] Úložiště Netlify Blobs, jeden JSON na uživatele.

## Konektor

- [x] Nástroje pro čtení plánu, profil, import po týdnech, aktivaci, přesun, vynechání, úpravu, přidání, obnovu, pauzu/přeskočení týdne, splnění, undo a smazání dat.
- [x] Změny rozpisu jdou přes registr příkazů z domény a jsou vratné; zápis pocitu, bolesti a okolností je součást vratné změny.
- [x] Kontrola týdenních součtů při importu.
- [x] Podmíněný zápis proti souběžným změnám; oddělené prostory podle klíče; strop velikosti prostoru 3 MB.
- [x] Testy přes skutečný MCP protokol nad úložištěm v paměti; referenční 12týdenní plán prošel importem i aktivací.
- [x] Netlify funkce a Blobs za běhu: živý průchod importem, aktivací, přesunem, splněním, undo, exportem a smazáním dat.
- [x] Tvar jednotky je v popisech nástrojů jen jednou (u importu); úprava a přidání vracejí chybu s cestou k poli. Popisy nástrojů 22,7 kB místo 28,6 kB.
- [ ] Ověřit v Claude: přidání konektoru bez přihlášení, schvalování zápisových nástrojů, import skutečného PDF, souběh s konektorem Stravy, mobilní aplikace.
- Omezení počtu požadavků vědomě není: provoz chodí ze serverů Claude, takže limit podle IP by omezil všechny uživatele najednou.

## Přesnost

- [x] Tempa a předpovědi z výkonu podle VDOT (Daniels); ověřeno proti tabulkám a proti tempům referenčního plánu.
- [x] Hodnocení splnění: jednotka s rychlými úseky (i dlouhý běh s úseky v tempu půlmaratonu) se nesoudí průměrným tempem celého běhu; úseky jen na čas bez tempa netrestají delší běh.
- [x] Kilometry ve widgetu jsou výslovně „podle plánu“, ne naměřené.
- [x] Okolnosti běhu (zima, vítr, alkohol den předem…) se ukládají k jednotce a zmírňují hodnocení pomalejšího tempa.

## Vizualizace a UI v konverzaci

- [x] Widget s pohledy týden, celý plán, tempa a doběhnuto; světlý i tmavý režim, tabulková podoba grafů; vlastní karta bez rámečku hostitele.
- [x] Nejbližší trénink je v týdnu rozbalený; doběhnuto, přesun výběrem dne, vynechání, obnovení a vrácení jdou klepnutím přímo do konektoru.
- [x] Tlačítko Vrátit vrací právě změnu, ke které patří; po vrácení se už nenabízí.
- [x] Sloupec v grafu plánu otevře týden; záložky a šipky přepínají pohledy bez zprávy v chatu.
- [x] Když hostitel neodpoví do 20 s, akce se pošle jako zpráva do konverzace a widget nezamrzne; chyby nástroje se ukazují jako chyba, ne jako text k opsání.
- [x] Řádky týdne jsou skutečná tlačítka (čtečky obrazovky), dotykové plochy 44 px, ověřeno na 360 a 420 px.
- [x] Export do Garminu jako nenápadný odkaz „Soubor do hodinek“; soubor čte nezávislý dekodér. Na hodinkách neověřeno. Prošlé soubory se mažou, smazání dat smaže i vlastní soubory.
- [~] Nová ikona pod novými názvy souborů; ověřit po odpojení a připojení konektoru.
- [~] Ověřeno proti napodobenému hostiteli. V Claude zbývá ověřit vykreslení, přímé volání nástrojů z widgetu a zprávy do konverzace.
- [ ] Ověřit, jestli Claude předává modelu i data pro widget (structuredContent); pokud ano, přesunout je mimo kontext modelu.

## Web

- [x] Úvodní stránka: vytvoření adresy v prohlížeči, návod, příklady, snímky karet, soukromí; na 360 px bez přetékání.

## Později

- [ ] OAuth a adresář Claude.
- [ ] ChatGPT (dnes bez Stravy a se zápisem jen na firemních tarifech).
