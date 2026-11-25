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
   - **Dnešek je rozbalený v místě** (ne zvláštní karta): rozpis s tempy a jedno tlačítko **Odběhnuto** a pod ním tiché odkazy (Přesunout, Vynechat, Do hodinek). Pocit se v appce nezadává.
   - Ostatní akce (přesunout, vynechat, do hodinek) jsou v nabídce `⋯` řádku, ne jako tlačítka.
2. **Plán**: **matice týdny × dny** (12 × 7 buněk).
   - Buňka má barvu intenzity, plná znamená splněno, prázdná naplánováno; dnešek má rámeček.
   - Vlevo objem týdne, nahoře fáze.
   - Klepnutí na buňku otevře týden.
   - Celý plán je tak na jedné obrazovce bez grafu, tabulky a šipek. Matice je i to „modulační“ v názvu.
3. **Tempa**: záložka (ne tlačítko u běhu). Tabulka pásem na km a na 400 m; přepočet z čerstvého závodu je schovaný pod jedním řádkem.
4. **Claude**: jedno tlačítko ve spodní liště vedle záložek, otevře nový chat. Žádné čipy s větami.

Nasazeno 25. 11.: `public/app/` (index.html, rpm.css, rpm.js), obyčejná stránka bez rámu. Záhlaví má jeden řádek a pod ním jednu řádku čísel; mezi týdny se swipuje.

### Nový plán a nahrání plánu (v appce)

- **Nový plán** zvládne appka sama, bez Clauda: generátor kostry (`draft_plan`) je deterministický.
  - Formulář na jednu obrazovku: cíl (udržovat / zlepšit / závod), závod (vzdálenost, datum), dnešní týdenní objem, běhů týdně, den dlouhého běhu, volné dny a volitelně čerstvý závodní čas pro tempa (`calculate_paces`).
  - → náhled jako matice s objemem po týdnech → **Zařadit do kalendáře** (`activate_plan`).
  - Starý plán se archivuje, jako dnes.
- **Nahrát plán z dokumentu** (PDF, fotka, tabulka) potřebuje čtení dokumentu, a to umí jen Claude. Appka otevře nový chat s připravenou větou a uživatel tam přiloží soubor; Claude plán přepíše přes konektor.
  - Appka pak sama ukáže **rozpracovaný plán** (náhled, varování, Zařadit do kalendáře), takže schválení proběhne v appce.
  - K tomu musí data týdne nést i stručný přehled rozpracovaného importu.
- Vstup do obou: v záhlaví appky `+ Plán`. Když plán není, je to celá úvodní obrazovka.

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
2. ~~**Statický prototyp**~~ **Hotovo 25. 11.** nového vzhledu s ukázkovými daty: Týden, Plán (matice) a dnešní trénink po Hotovo, na 390 px ve světlém i tmavém režimu. Schválíš, nebo vrátíš.
3. ~~**Server:**~~ **Hotovo 25. 11.** zeštíhlit podle sekce 5 a upravit testy. Data a `show_week` jen pro appku (`?client=app`).
4. ~~**Appka:**~~ **Hotovo 25. 11.** (shell.js a karta v rámu z appky pryč) přepsat na prototyp a volat API přímo, bez rámu a postMessage. Přidat profil jednotky a matici.
5. **Mazání:** ~~karta v chatu~~, ~~ChatGPT~~ (hotovo 25. 11.); zbývá stránka v claude.ai (smaže se po tvém souhlasu).
6. ~~**Název a instalace:**~~ **Hotovo 25. 11.** (konektor se jmenuje RPM, appka nabízí instalaci)
   - manifest, ikona, úvodní stránka (appka první, Claude jako mozek), README;
   - v appce tlačítko Nainstalovat: na Androidu přes výzvu prohlížeče, na iPhonu jednořádkový návod „Sdílet → Přidat na plochu“.
   - Odkaz na appku nahoře na úvodní stránce je hotový od 25. 11. Nese adresu konektoru, pokud ji prohlížeč má uloženou.
7. **Nasazení:** commit, push, ověření na produkci, nové snímky na úvodní stránku.

## 7. Rozhodnutí pro tebe

1. ~~Karta v chatu pryč úplně?~~ **Rozhodnuto 25. 11.:** konektor zůstává, grafické karty v chatu ne. Claude odpovídá textem a odkazem do appky.
2. ~~Název?~~ **Rozhodnuto 25. 11.:** RPM, Run Plan Modulator.
3. **Stránka v claude.ai** (připnutá) pryč? Doporučuju ano, je to třetí kopie téže appky.
4. ~~ChatGPT pryč?~~ **Rozhodnuto 25. 11.:** ano. Z úvodní stránky a README je pryč; metadata `openai/*` na serveru zmizí se zeštíhlením.
5. **Hodnocení běhu:** stačí v chatu textem, s uloženým jen stavem a pocitem? Nebo má appka ukazovat i skóre (uložené jedno číslo)?

---

# Review 25. 11.: PDF jako hlavní cesta, Strava druhá

## Co jsem našel

**Import z PDF (hlavní cesta):**
- Referenční přepis plánu Half Marathon L4 měl tři druhy chyb, které nikdo neviděl.
  - Všech 11 běhů „Easy Run & Strides“ bylo zapsaných jako 10–11 km rovinek. Appka pak ukazovala „10 km rovinky“.
  - Závod „Half Marathon!“ neměl délku, takže týden 12 vycházel na 18 km místo 48–51 km.
  - Ve středě týdne 10 se „6x“ přečetlo jako „ex“, takže z 6× (800 m + 200 m) zbyl jeden úsek.
- Kontrola součtů u týdnů s úseky na čas psala jen „nejde ověřit“, takže nechytla ani jednu z těch chyb. Varování byla jen text pro model a po zařazení zmizela.
- V appce nešlo rozpracovaný plán rozkliknout. Nebyl vidět součet autora ani původní znění, takže nebylo jak přepis zkontrolovat.
- Zařazení plánu, který končí závodem, se nabízelo jako „Začít týdnem od“.
- „Nahrát plán od trenéra“ byl až pod formulářem generátoru, za „nebo“.

**Appka:**
- Při listování mezi týdny bylo chvíli prázdno, protože další týden se načítal až po odjezdu.
- Při prvním klepnutí na Plán probliklo, než se ukázala matice, protože se nejdřív vykreslil formulář nového plánu.
- Sám se rozbaloval i nejbližší budoucí běh, ne jen dnešek.
- Tempa: sloupec na 400 m navíc. Cílový čas nešel změnit, i když PDF má tabulku pro 1h25, 1h30 a 1h35.
- Tempa bez uložených temp ukázala chybu psanou pro model („Ulož je přes set_profile…“).
- Řádek se dvěma tempy (800 m + 200 m) nechal jedno tempo v textu.

**Úvodní stránka:** kroky šly „appka, pak Claude“. U PDF musí být Claude první, protože bez konektoru appka plán nezaloží.

## Co je hotové (necommitnuté)

- Server: automatické opravy přepisu (`autofixWorkout`) a kontrola součtů s odhadem úseků na čas (`checkWeekTotal`, tolerance 4 %). Na skutečném PDF dává 0 falešných chyb a chybu v týdnu 10 najde.
- Instrukce pro model: z PDF s verzí v mílích i v km vzít jen km, rovinky jako blok, závod vždy s délkou, u rozpětí součtu („48–51k“) horní hranice, celá tabulka temp v `paceTable`.
- Nový prompt `plan-z-dokumentu` a nový nástroj `set_goal_time`.
- Appka:
  - Nový plán: Plán od trenéra, pak Plán podle mé Stravy, ruční formulář schovaný pod „Sestavit bez Clauda“.
  - Kontrola plánu: týdny jdou rozkliknout, u každého dne přepis, znění z dokumentu, opravy a varování; v km sloupci součet přepisu / součet autora; zařazení podle závodu je výchozí.
  - U každého dne „V plánu: …“ (doslovné znění).
  - Upozornění na rozpracovaný plán i v Týdnu.
  - Rozbaluje se jen dnešek.
  - Listování ukazuje sousední týden vedle (načtený předem).
  - Plán se načte na pozadí, takže neproblikne.
  - Tempa: cílový čas s krokem 1 min v rozsahu tabulky, bez 400 m.

## Návrhy dál

1. **Uspořádání nechat: konektor + appka.**
   - Podmínky Strava API vylučují vlastní napojení s AI.
   - Tokeny jdou z předplatného uživatele.
   - PDF umí číst jen Claude.
   - Alternativy a proč ne:
     - Claude API v appce: vlastní klíč a náklady, Strava stejně ne.
     - Karta v chatu: duplicita appky.
     - Čistě Claude Project: bez appky v telefonu.
2. **Sdílení PDF rovnou do appky** (Web Share Target na Androidu): appka soubor uloží k prostoru a nový nástroj `get_uploaded_plan` ho vrátí Claudovi. Uživatel by PDF nemusel přikládat znovu. Nejdřív ověřit, jestli Claude předá modelu PDF nebo obrázky stránek z výsledku nástroje; když ne, rozdělit PDF v appce na obrázky stránek (pdf.js).
3. **Druhý průchod přepisu:** po importu by model zavolal `get_import_review` s týdny, kde součet nesedí, a opravil je bez zásahu uživatele. Dnes to zajišťují instrukce; nástroj by to vynutil.
4. **Varování i po zařazení:** jednotky s varováním nebo opravou označit v Týdnu tečkou a „V plánu“ zvýraznit.
5. **Strava jako druhá cesta:**
   - `draft_plan` by bral i nejdelší běh a počet běhů posledních týdnů, aby kostra nezačínala od průměru.
   - Prompt „podle Stravy“ by se zeptal jen na cíl a datum.
6. **Skill „RPM import“** s příklady přepisu buněk (rovinky, progresivní běh, opakování s více úseky), když bude kvalita importu u jiných PDF slabší. Načítá se jen při importu, takže nezvyšuje cenu běžné konverzace.
7. **Snímky na úvodní stránce** jsou zastaralé (formulář a Tempa s 400 m); přefotit po schválení.

## Stav návrhů po druhém kole

- **1. Uspořádání:** zůstává konektor + appka.
- **2. Sdílení PDF do appky:** neuděláno. Není ověřené, že Claude z výsledku nástroje přečte PDF; tlačítko, které by nemuselo fungovat, do appky nepatří. Vrátit se k tomu, až to půjde ověřit.
- **3. Druhý průchod přepisu:** částečně. Místo nového nástroje `get_plan` u rozpracovaného plánu vypíše týdny, kde nesedí součet, a týdny s varováním. Model je tak vidí při každém dalším kroku.
- **4. Varování i po zařazení:** hotové. Den ukáže „Při přepisu opraveno: …“ a varování, dokud se jednotka nezmění.
- **5. Strava:** hotové. `draft_plan` bere `longestRunKm` a dlouhý běh od něj roste nejvýš o 1,5 km za týden.
- **6. Skill:** neuděláno. U referenčního PDF stačí instrukce a automatické opravy; skill až při slabším importu jiných plánů.
- **7. Snímky:** přefocené (390×844 @2x přes DevTools protokol, demo týden 10).

## Vzhled (druhé kolo)

- Typ tréninku má ikonu (bota, trasa, plamen, blesk, rovinky, cílová vlajka, měsíc pro volno) a barvu zóny jako z hodinek: modrá volně, tmavě modrá dlouhý, žlutá tempo, červená rychlost, oranžová závod.
- Týden: uběhnuté km jako trasa s běžcem a cílovou vlajkou, odpočet do závodu jako startovní číslo, nadpisy tučnou kurzívou.
- Plán: závod jako šachovnice cílové vlajky. Tempa: všechna pásma na jedné ose od pomalého po rychlé.
- Konec plánu s medailí, prázdné obrazovky s trasou ze startu do cíle, odškrtnutí s krátkou animací.
- Co jde přes konektor Strava, má barvu a značku Stravy. Na webu je u toho poznámka o ochranné známce.
- Web: kroky pro člověka bez technických znalostí (adresa, konektor v Claude klik po kliku, volitelná Strava, poslat PDF, kontrola, běhání), časté otázky, stejné barvy jako appka.
