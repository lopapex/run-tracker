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
- [x] Hromadný zápis splnění (`set_statuses`) jako jedna vratná změna; úseky intervalů se hodnotí proti cílovému pásmu.
- [x] Paměť mezi plány: poznámky trenéra v profilu, historie plánů v `get_plan`, karta dokončeného plánu, kostra dalšího plánu přes `draft_plan`, prompty pro nový plán a týdenní kontrolu.
- [x] Odstraněny zbytky původní aplikace (parsování souborů aktivit, drafty, typy chatu a AI).
- [x] Tvar jednotky je v popisech nástrojů jen jednou (u importu); úprava a přidání vracejí chybu s cestou k poli. Popisy nástrojů 22,7 kB místo 28,6 kB.
- [x] Ověřeno v Claude: přidání konektoru bez přihlášení, import skutečného PDF, souběh s konektorem Stravy, karty v mobilní aplikaci.
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
- [x] Karty se vykreslují v Claude na webu i v mobilní aplikaci (tmavý režim).
- [~] Přímé volání nástrojů z widgetu a zprávy do konverzace ověřené proti napodobenému hostiteli; v Claude ověřit po každé větší změně widgetu.
- [x] Nezapsané proběhlé tréninky mají štítek a tlačítko Doplnit; zápis stavu u doběhnutého běhu je sbalený; záložky, dlaždice a akce jsou na mobilu přes celou šířku.
- [ ] Ověřit, jestli Claude předává modelu i data pro widget (structuredContent); pokud ano, přesunout je mimo kontext modelu.

## ChatGPT

- [x] Widget umí rozhraní `window.openai` (výška, odkazy, barevný režim, data) vedle standardu MCP Apps; ověřeno v napodobeném hostiteli.
- [x] Bez Stravy: widget nabízí zadání čísel běhu, instrukce vedou model k dotazu nebo výpočtu z GPX, TCX či FIT.
- [x] Metadata pro ChatGPT: `openai/outputTemplate` a `openai/widgetCSP` s doménou pro soubor do hodinek.
- [ ] Ověřit ve skutečném ChatGPT: dostupnost vlastního MCP serveru na tvém tarifu, schvalování zápisu, vykreslení a výšku karty, mobil.

## Web

- [x] Úvodní stránka: vytvoření adresy v prohlížeči, návod, příklady, snímky karet, soukromí; na 360 px bez přetékání.

## Později

- [ ] OAuth a adresář Claude.
- [ ] Data pro widget přesunout do `_meta` (v ChatGPT je model čte), až se ověří, že je Claude widgetu předává.
