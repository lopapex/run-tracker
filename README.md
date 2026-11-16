# Run Tracker

Konektor pro Claude (vzdálený MCP server), který drží běžecký plán: ověřený plán, jeho zařazení do kalendáře, přesuny, stav splnění a vratnou historii změn. Konverzace běží v Claude uživatele a čerpá jeho předplatné. Skutečné běhy čte Claude přes oficiální konektor Stravy; Run Tracker data ze Stravy nedostává ani neukládá.

Stav a zbývající kroky jsou v [CHECKLIST.md](CHECKLIST.md).

## Jak to funguje

1. Uživatel si na úvodní stránce vytvoří adresu `https://<web>/mcp/<klíč>`. Klíč vzniká v prohlížeči.
2. Adresu přidá v Claude jako vlastní konektor. Účet ani přihlášení neexistují; adresa je jediné oprávnění.
3. V konverzaci přiloží plán (PDF, obrázek, tabulka). Claude ho přepíše po týdnech přes `import_plan_weeks`, nástroj vrátí kontrolu týdenních součtů a `activate_plan` plán zařadí do kalendáře.
4. Další změny jdou přes `move_workout`, `skip_workout`, `edit_workout`, `add_workout`, `restore_workout`, `shift_plan` a `set_status`. Každá je vratná přes `undo_change`. `get_plan` vrací aktuální stav, `delete_all_data` smaže vše.

## Hranice vůči Stravě

Podmínky Strava API (platné od 1. 6. 2026) zakazují posílat data z API do AI a provozovat vlastní MCP server se Strava daty. Run Tracker proto Strava API nepoužívá vůbec. Nástroje přijímají jen stav jednotky a krátkou poznámku uživatele a instrukce konektoru říkají modelu, aby data aktivit neposílal.

## Vývoj

Node 24. `npm install`, `npm test`, `npm run typecheck`.

Testy v `src/connector/connector.test.ts` procházejí celý konektor přes skutečný MCP protokol nad úložištěm v paměti. Lokální běh funkce s Netlify Blobs vyžaduje `netlify dev`.

## Nasazení

Netlify: `netlify.toml`, statická stránka z `public/`, funkce `netlify/functions/mcp.mts` na cestě `/mcp/:key`. Data jsou v Netlify Blobs (úložiště `workspaces`), jeden JSON na uživatele pod otiskem klíče. Žádné proměnné prostředí nejsou potřeba.

## Moduly

| Cesta | Účel |
|---|---|
| `src/domain` | příkazy nad rozpisem, revize a undo, mapování týdnů, vzdálenosti a tempa |
| `src/connector/tools.ts` | operace konektoru nad prostorem uživatele |
| `src/connector/server.ts` | registrace nástrojů a instrukce pro model |
| `src/connector/http.ts` | bezstavový HTTP vstup MCP |
| `src/connector/store.ts`, `blobStore.ts` | úložiště s podmíněným zápisem |
| `public/` | úvodní stránka s vytvořením adresy a návodem |

`src/domain` obsahuje i části původní aplikace, které konektor zatím nepoužívá (`activities.ts`, `drafts.ts`, `generator.ts`).

Původní PWA je v historii gitu do commitu `6fcdf7d`.

MIT.
