# Plán: zjednodušení a nový vzhled

Stav k 25. 11. 2026, po commitu `696d6b5`.

## 1. Potřebujeme ještě run connector?

**Úložiště a API ano, kartu v chatu ne.**

Konektor dnes dělá tři věci:

| Co dělá | Kdo ho potřebuje | Bez Clauda to jde? |
|---|---|---|
| Drží data plánu na `/mcp/<klíč>` | aplikace i Claude | ano, je to jen úložiště a API |
| Dává Claudovi nástroje: import plánu z PDF nebo fotky, sestavení plánu, úpravy, hodnocení běhu ze Stravy, rady | Claude | ne. Appka by potřebovala vlastní editor plánu a vlastní napojení na Stravu (OAuth, účty, podmínky Strava API) |
| Kreslí kartu v chatu (MCP Apps, ChatGPT, stránka v claude.ai) | nikdo nutně | tohle je duplicita appky |

Rozdělení rolí:

- **Appka** je jediné místo, kde se plán *ukazuje* a kde se denně *klepe*: hotovo, pocit, přesun, vynechání, tempa, hodinky.
- **Claude s konektorem** je *mozek*: založí plán z dokumentu, postaví plán podle Stravy, přeplánuje týden, zhodnotí běh a poradí. Odpovídá textem a odkazem do appky, bez karet.

„Jen appka“ bez Clauda by znamenala ztratit import, generování plánu i Stravu. Nedoporučuju.

## 2. Název

`Trénink` je popis, ne název.

Návrh: **RPM, Run Plan Modulator.**
- RPM je zároveň kadence: běžec ji zná.
- „Modulator“ sedí na to, co appka dělá: plán se neodškrtává, ale ladí (přesunout, ubrat, zhustit).

Varianty: **Run Plan Modulator** celým názvem, nebo jen **Modulator**.

Název se propíše do manifestu PWA, ikony, úvodní stránky, názvu konektoru a README.

## 3. Proč je dnešní UI slop (upřímně)

- **Tentýž týden je na obrazovce třikrát:** pás dní, hlavní karta, seznam. Uživatel nečte, hledá.
- **Krabice v krabicích:** objem, hlášky, hlavní trénink, dlaždice. Každá má vlastní pozadí, rádius a padding, takže nic nevede.
- **Moc tlačítek:** dnešní trénink má sedm akcí (Doběhnuto, Přesunout, Vynechat, Zkrátit, Tempa, Hodinky a pocit). Polovina posílá text Claudovi.
- **Generické fitness klišé:** limetkový akcent na tmavé, štítky jako pilulky, barevné proužky u řádků, velká tučná čísla se šedým „km“.
- **Malé popisky velkými písmeny všude**, takže nic není nadpis.
- **Kvůli chatu nesou karty šum:** čipy „Zeptat se“, ikony „otevřít v Claude“, banner „Vrátit“, tlačítko pro opětovné načtení.

## 4. Nový směr: appka jako přístroj

Vzor je měřicí přístroj nebo sequencer, ne fitness dashboard. Jedna plocha, linky místo krabic, čísla v neproporcionálním písmu, barva jen tam, kde nese informaci.

### Obrazovky (místo 4 záložek 2 + tlačítko)

1. **Týden** (výchozí)
   - Nahoře jeden řádek: `Týden 4/12 · Build · 10,7 / 59 km · závod za 60 dní`, šipky týdne gestem do stran.
   - Pod tím **7 řádků dní**. Každý ukazuje:
     - den;
     - název;
     - **profil jednotky**: vodorovný proužek složený z úseků v poměru délky a v barvě intenzity (rozklus, úseky, pauzy, výklus). Je to hlavní vizuální prvek appky, dnes chybí úplně.
     - km;
     - stav: tečka, plná = hotovo.
   - **Dnešek je rozbalený v místě** (ne zvláštní karta): rozpis s tempy a jedno tlačítko **Hotovo**. Po klepnutí se objeví pět teček pocitu.
   - Ostatní akce (přesunout, vynechat, do hodinek) jsou v nabídce `⋯` řádku, ne jako tlačítka.
2. **Plán**: **matice týdny × dny** (12 × 7 buněk).
   - Buňka má barvu intenzity, plná znamená splněno, prázdná naplánováno; dnešek má rámeček.
   - Vlevo objem týdne, nahoře fáze.
   - Klepnutí na buňku otevře týden.
   - Celý plán je tak na jedné obrazovce bez grafu, tabulky a šipek. Matice je i to „modulační“ v názvu.
3. **Tempa**: místo záložky panel z dnešní jednotky nebo z `⋯`.
   - Pásma jako stupnice, převody na 400 m na jeden řádek.
4. **Claude**: jedno tlačítko v záhlaví, které otevře nový chat. Žádné čipy s větami.

### Vizuální systém

- Světlý papírový podklad, tmavý režim podle systému.
- Jedna akcentní barva jen pro „dnes“ a primární tlačítko.
- Barvy intenzit tlumené, ve čtyřech stupních. Šedá je volno.
- Písmo: systémové sans pro text, `ui-monospace` s tabulárními číslicemi pro všechna čísla (km, tempa, časy). Dvě velikosti textu a jeden nadpis.
- Žádné karty se stínem ani pilulky. Oddělovače jsou vlasové linky, mezery na mřížce 4 px.
- Pohyb jen tam, kde vysvětluje: rozbalení dne, potvrzení „Hotovo“. Nic nepřiletí.
- Cíl na mobilu: dnešní trénink a tlačítko Hotovo bez posouvání, palcem dosažitelné dole.

## 5. Co smazat

| Oblast | Smazat | Odhad |
|---|---|---|
| Karta v chatu | `public/widget.html` jako MCP App, tedy protokol `ui/*`, hlášení výšky, `window.openai`, hlídání změn, zastaralá karta a nápovědy. Appka se z něj stane obyčejnou stránkou. | −600 řádků |
| Server | registrace UI zdroje, `_meta.ui`, `openai/*`, `show()` s `shownAt`/`watchAt`/`pendingBanner`, nástroje jen pro kartu `show_plan`/`show_paces`, parametry `fromCard`/`watch`, pravidlo odpovědi „pod kartou“ | −150 řádků |
| Workspace | pole `shownAt`, `watchAt`, `pendingBanner` | malé |
| Stránka v claude.ai | `app/trenink.html`, `app/card.html`, artefakt (po tvém souhlasu ho odepnu a smažu) | celé |
| Obal PWA | `shell.js` jako most do rámu, Strava a trenér přes `sample` | −230 řádků |
| ChatGPT | metadata a odstavec v README (bez karty nemá smysl) | malé |
| Pohledy v appce | kontrola importu, prázdný stav s návodem, „plán dokončen“ (řekne Claude), graf objemu, tabulka týdnů, formulář bolesti a okolností (řekneš Claudovi) | −200 řádků |
| Testy | testy metadat UI, druhé karty a hlídání | upravit |

**Zůstane:**
- doménová logika (plán, přesuny, stavy, tempa, VDOT, FIT);
- nástroje pro Clauda (import, sestavení, úpravy, `get_plan`, hodnocení běhu jako text se zápisem stavu);
- úložiště;
- appka;
- úvodní stránka.

Appka dál volá `/mcp/<klíč>`. Nástroje, které potřebuje jen ona, se skryjí modelu, takže Claude uvidí méně nástrojů a ušetří tokeny.

## 6. Postup

1. **Rozhodnutí** (sekce 7).
2. **Statický prototyp** nového vzhledu s ukázkovými daty: Týden, Plán (matice) a dnešní trénink po Hotovo, na 390 px ve světlém i tmavém režimu. Schválíš, nebo vrátíš.
3. **Server:** zeštíhlit podle sekce 5 a upravit testy.
4. **Appka:** přepsat na prototyp a volat API přímo, bez rámu a postMessage. Přidat profil jednotky a matici.
5. **Mazání:** karta v chatu, stránka v claude.ai, ChatGPT.
6. **Název a instalace:**
   - manifest, ikona, úvodní stránka (appka první, Claude jako mozek), README;
   - v appce tlačítko Nainstalovat: na Androidu přes výzvu prohlížeče, na iPhonu jednořádkový návod „Sdílet → Přidat na plochu“.
   - Odkaz na appku nahoře na úvodní stránce je hotový od 25. 11. Nese adresu konektoru, pokud ji prohlížeč má uloženou.
7. **Nasazení:** commit, push, ověření na produkci, nové snímky na úvodní stránku.

## 7. Rozhodnutí pro tebe

1. ~~Karta v chatu pryč úplně?~~ **Rozhodnuto 25. 11.:** konektor zůstává, grafické karty v chatu ne. Claude odpovídá textem a odkazem do appky.
2. **Název:** RPM / Run Plan Modulator / Modulator / jiný.
3. **Stránka v claude.ai** (připnutá) pryč? Doporučuju ano, je to třetí kopie téže appky.
4. **ChatGPT** pryč? Doporučuju ano, pokud ho nepoužíváš.
5. **Hodnocení běhu:** stačí v chatu textem, s uloženým jen stavem a pocitem? Nebo má appka ukazovat i skóre (uložené jedno číslo)?
