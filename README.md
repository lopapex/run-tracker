# Run Tracker

Konektor pro Claude (vzdálený MCP server), který drží běžecký plán: ověřený plán, jeho zařazení do kalendáře, přesuny, stav splnění a vratnou historii změn. Konverzace běží v Claude uživatele a čerpá jeho předplatné. Skutečné běhy čte Claude přes oficiální konektor Stravy; Run Tracker data ze Stravy nedostává ani neukládá.

Stav a zbývající kroky jsou v [CHECKLIST.md](CHECKLIST.md).

## Jak to funguje

1. Uživatel si na úvodní stránce vytvoří adresu `https://<web>/mcp/<klíč>`. Klíč vzniká v prohlížeči.
2. Adresu přidá v Claude jako vlastní konektor. Účet ani přihlášení neexistují; adresa je jediné oprávnění.
3. V konverzaci přiloží plán (PDF, obrázek, tabulka). Claude ho přepíše po týdnech přes `import_plan_weeks`, nástroj vrátí kontrolu týdenních součtů a `activate_plan` plán zařadí do kalendáře. Bez dokumentu postaví kostru `draft_plan` z objemu podle Stravy (`src/domain/generator.ts`: růst objemu, lehčí každý 4. týden, ubrání před závodem).
4. Další změny jdou přes `move_workout`, `skip_workout`, `edit_workout`, `add_workout`, `restore_workout`, `shift_plan`, `set_status` a `set_statuses` (celý týden splnění jedním zápisem). Každá je vratná přes `undo_change`. `get_plan` vrací aktuální stav včetně poznámek trenéra a historie předchozích plánů, `delete_all_data` smaže vše.
5. Kontrola importu: `src/domain/lint.ts` hledá podezřelé jednotky (dlouhé rovinky, intervaly bez pauzy, název nesedí s rozpisem, dlouhý běh kratší než jiný, tempa mimo meze nebo prohozená). Jsou to jen varování: `import_plan_weeks` a `draft_plan` je vrátí modelu a ukážou v kartě kontroly, aktivaci neblokují.
6. Trenér: `fatigueOf` z posledních zápisů pozná únavu nebo bolest a karta týdne i `get_plan` na ni upozorní. `show_result` z úseků nebo tempového běhu bez zhoršujících okolností spočítá odhad VDOT; ten se uloží se zápisem (`estimateVdot`) a přehled plánu ukáže vývoj formy a předpověď na cílovou vzdálenost.
7. Paměť mezi plány: `set_profile` ukládá poznámky trenéra o běžci (zranění, volné dny, cíle). Po posledním týdnu plánu ukáže `show_week` shrnutí a další plán naváže na historii. Prompty `novy-plan` a `tydenni-kontrola` připraví obvyklé postupy.
8. Vizualizace běží přímo v konverzaci (MCP Apps): `show_week`, `show_plan`, `show_paces` a `show_result` (doběhnuto: odhad splnění proti plánu a zápis stavu, pocitu a okolností) vykreslí widget z `public/widget.html`. Nástroje, které mění rozpis, vykreslí aktualizovaný týden samy. Widget má záložky, navigaci po týdnech, akce u jednotek a nápovědy dalších promptů; mezi pohledy přepíná přímým voláním nástrojů, změny rozpisu posílá jako zprávu do konverzace a zápis doběhnuté jednotky ukládá přímo.
9. `calculate_paces` spočítá tempa a předpovědi závodů z jednoho výkonu vzorci VDOT (`src/domain/vdot.ts`, test proti tabulkám Danielse); instrukce konektoru říkají modelu, aby tempa neodhadoval.
10. Ve widgetu jde přesunout (výběrem dne), vynechat, obnovit a vrátit klepnutím: widget volá nástroje přímo a model se o změně dozví přes kontext.
11. `export_garmin` převede jednotku na strukturovaný trénink FIT (kroky, opakování, cílová tempa) a vystaví ho 24 hodin na `/garmin/<token>`; prošlé soubory se při dalším exportu smažou a `delete_all_data` smaže i soubory daného prostoru. Kódování je v `src/connector/fit.ts` a test ho čte nezávislým dekodérem.
12. Aplikace Trénink na `/app/` je PWA pro telefon: tentýž widget přes celou obrazovku se záložkami dole. Nástroje volá přímo na adrese konektoru (klíč je jen v prohlížeči, z úvodní stránky přijde v kotvě odkazu), poslední týden drží pro offline start a věty pro Clauda otevře v novém chatu. Stejný obal (`public/app/shell.js`) běží i jako stránka v claude.ai (`app/trenink.html`), kde Doběhnuto a Doplnit čtou běhy z oficiálního konektoru Stravy.

## ChatGPT

Stejná adresa funguje i v ChatGPT jako vlastní MCP server (vývojářský režim; OpenAI ho se zápisem nabízí hlavně na tarifech Business a Enterprise). Widget používá standard MCP Apps a navíc rozhraní `window.openai` pro výšku karty, odkazy, barevný režim a data; nástroje nesou alias `openai/outputTemplate` a zdroj widgetu `openai/widgetCSP` s povolenou doménou pro odkaz na soubor do hodinek. Oficiální konektor Stravy v ChatGPT není: widget tam místo „Zhodnotit podle Stravy“ nabízí zadání čísel a model má v instrukcích, že se na čísla zeptá nebo je spočítá z nahraného GPX, TCX či FIT. ChatGPT podle dokumentace OpenAI čte `structuredContent` i modelem, takže každá karta tam stojí víc tokenů než text.

## Hranice vůči Stravě

Podmínky Strava API (platné od 1. 6. 2026) zakazují posílat data z API do AI a provozovat vlastní MCP server se Strava daty. Run Tracker proto Strava API nepoužívá vůbec a data aktivit neukládá. `set_status` přijímá jen stav jednotky a krátkou poznámku uživatele. Výjimka je `show_result`: čísla běhu, která model přečetl přes oficiální konektor Stravy, přepočítá a vrátí widgetu, aniž by je uložil. Pro osobní použití vlastních dat to odpovídá účelu oficiálního konektoru; u veřejné služby pro cizí uživatele je to šedá zóna a před zveřejněním je potřeba si ji u Stravy ověřit.

## Vývoj

Node 24. `npm install`, `npm test`, `npm run typecheck`.

Testy v `src/connector/connector.test.ts` procházejí celý konektor přes skutečný MCP protokol nad úložištěm v paměti. Lokální běh funkce s Netlify Blobs vyžaduje `netlify dev`.

## Nasazení

Netlify: `netlify.toml`, statická stránka z `public/`, funkce `netlify/functions/mcp.mts` na cestě `/mcp/:key` a `garmin.mts` na `/garmin/:token`. Data jsou v Netlify Blobs (úložiště `workspaces`), jeden JSON na uživatele pod otiskem klíče. Žádné proměnné prostředí nejsou potřeba.

## Moduly

| Cesta | Účel |
|---|---|
| `src/domain` | příkazy nad rozpisem, revize a undo, mapování týdnů, generátor kostry plánu, vzdálenosti a tempa |
| `src/connector/tools.ts` | operace konektoru nad prostorem uživatele |
| `src/connector/views.ts` | data pro vizualizace (týden, plán, tempa, doběhnuto) a export do Garminu |
| `src/connector/fit.ts` | kódování tréninku do formátu FIT |
| `src/domain/vdot.ts` | tempa a předpovědi závodů podle VDOT |
| `src/connector/server.ts` | registrace nástrojů, UI metadat a instrukcí pro model |
| `src/connector/http.ts` | bezstavový HTTP vstup MCP |
| `src/connector/store.ts`, `blobStore.ts` | úložiště s podmíněným zápisem |
| `public/widget.html` | widget pro konverzaci i aplikaci; samostatný soubor bez závislostí, mluví protokolem MCP Apps |
| `public/app/` | PWA Trénink: obal karty, manifest, service worker |
| `public/` | úvodní stránka s vytvořením adresy a návodem, ikony |

Původní PWA je v historii gitu do commitu `6fcdf7d`.

MIT.
