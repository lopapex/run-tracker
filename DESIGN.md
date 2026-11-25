---
name: RPM
description: Běžecký deník v kapse. Plán od trenéra v telefonu, každý den co běžet a jak rychle.
colors:
  paper: "#f3f2ed"
  ink: "#17191b"
  mute: "#63676b"
  faint: "#a4a7a9"
  line: "rgba(23, 25, 27, .12)"
  fill: "rgba(23, 25, 27, .05)"
  bib-orange: "#bf4112"
  done-green: "#1f7a52"
  zone-walk: "#c9ccc9"
  zone-easy: "#5fa8de"
  zone-long: "#3f6fd1"
  zone-tempo: "#e49a12"
  zone-speed: "#d63c5e"
  strava: "#fc4c02"
  strava-ink: "#c93d02"
  bib-paper: "#ffffff"
  night: "#111213"
  night-ink: "#e9e7e1"
  night-mute: "#9a9da0"
  night-orange: "#ff6a33"
  night-done: "#4cc38a"
typography:
  display:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "clamp(2.1rem, 8vw, 3.1rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  app-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
rounded:
  cell: "3px"
  bib: "6px"
  control: "10px"
  sheet: "14px"
  badge: "50%"
spacing:
  gutter: "16px"
  row: "12px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "48px"
  button-today:
    backgroundColor: "{colors.bib-orange}"
    textColor: "{colors.bib-paper}"
    rounded: "{rounded.control}"
    height: "44px"
  link-quiet:
    textColor: "{colors.mute}"
    height: "32px"
  strava-action:
    textColor: "{colors.strava-ink}"
    rounded: "16px"
  plan-cell:
    size: "26px"
    rounded: "{rounded.cell}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
---

# RPM

## Overview

**Běžecký deník v kapse.** Appka je papír a inkoust, ne dashboard z krabic: řádky oddělené linkou, žádné karty, žádné stíny jako dekorace. Běžecký svět nese pár předmětů, které běžec zná: **startovní číslo** (odpočet do závodu), **trasa s cílovou vlajkou** (uběhnuté km týdne), **zóny jako z hodinek** (barva = intenzita) a **medaile** na konci plánu.

Appka je režim *Operate*: člověk ráno chce vědět, co běžet a jak rychle, a po běhu klepnout „Odběhnuto“. Čitelnost a jedna jasná akce mají přednost před výrazem. Web je režim *Persuade*: smí být hlasitější (velký kurzívní nadpis, produkt hned v úvodu).

Zdroj pravdy jsou tokeny v `public/app/rpm.css` (appka) a `public/style.css` (web). Tenhle soubor je popisuje; když se rozejdou, platí CSS a tenhle soubor se opraví.

## Colors

- **Papír a inkoust** (`paper`, `ink`): teplý papír místo bílé, skoro černý inkoust. Tmavý režim je „noc“ (`night`, `night-ink`), ne inverze.
- **Startovní oranžová** (`bib-orange`): jediný akcent. Dnešek, hlavní akce dne, číslo týdne, chyby. Na papíře je tmavší (#bf4112), aby bílý text na ní a ona jako text měly ≥ 4,5:1. V noci #ff6a33 s tmavým textem.
- **Hotovo zelená** (`done-green`): jen splnění (fajfka, dojetá trasa, opravy přepisu).
- **Zóny** (`zone-*`): intenzita jako na hodinkách. Modrá volně, tmavší modrá dlouhý/ustáleně, žlutá tempo, červená rychlost, závod šachovnicí cílové vlajky. Barva vždy znamená intenzitu, nikdy ozdobu.
- **Strava** (`strava`, `strava-ink`): **jen** u věcí, které jdou přes oficiální konektor Strava. Logo a obrys v barvě značky, text v `strava-ink`, aby byl čitelný.
- **Tlumený text** je `mute`. `faint` je jen na čáry, tečky volných dnů a vypnuté prvky, **nikdy na text** (kontrast 2,2:1).

## Typography

- Appka: systémové písmo. Nadpisy obrazovek a velká čísla v tučné kurzívě (800, italic, těsné prostrkání) jako na startovní tabuli.
- Čísla, tempa a km: monospace s tabulkovými číslicemi (`data`). Monospace jen pro data a měření, ne jako „technický“ kostým.
- Web: nadpisy v **Barlow ExtraBold Italic** (SIL OFL, uložené v `public/fonts/`, žádné externí CDN).
- Česká typografie: jednopísmenné předložky a spojky (v, k, s, z, o, u, a, i) dostanou nezlomitelnou mezeru; odstavce mají `text-wrap: pretty`.
- Nejmenší funkční text 11 px.

## Layout

- Telefon napřed. Okraj `gutter` 16 px, obsah jako sloupec. Na širší obrazovce zůstane appka sloupcem 520 px uprostřed, ne roztaženou tabulkou.
- Spodní lišta se čtyřmi záložkami (Týden, Plán, Tempa, Claude ↗). Hlavní akce formulářů je přilepená nad lištou (`.sticky`); hláška pak vyjede nad ni.
- Týden: řádek na den, mřížka den / odznak / název / km / stav, pod tím profil jednotky (délka úseku = čas, výška a barva = intenzita).
- Plán: matice týdny × dny, fáze jako mezititulky, vpravo uběhnuto / plán km.
- Web: sloupec 40rem; úvod na širší obrazovce ve dvou sloupcích s obrazovkou appky vpravo.

## Elevation & Depth

Plochý papír. Hloubku nese linka (`line`) a jemná výplň (`fill`), ne stín. Výjimky jsou předměty z reálného světa: startovní číslo (lehký stín, natočení −2°, dírky po špendlících) a spodní list nad ztmaveným pozadím.

## Shapes

Malé poloměry: buňka plánu 3 px, startovní číslo 6 px, ovládací prvky 10 px, list 14 px nahoře. Odznaky druhu tréninku jsou kruhy. Ikony jsou vlastní SVG s tahem 1,8 a kulatými konci.

## Components

- **Řádek dne**: klepnutí rozbalí detail; sám se rozbalí jen dnešní trénink.
- **Jedna akce u běhu**: jedno plné tlačítko („Odběhnuto“, dnes oranžové), ostatní jako tiché podtržené odkazy (Přesunout, Vynechat, Do hodinek). Žádné menu „···“.
- **Stav jednotky**: zelená fajfka = splněno, půlená = částečně, šedý kroužek = nezapsáno, přeškrtnuto = vynecháno.
- **Buňka plánu**: *v plánu* = jen obrys v barvě zóny, *splněno* = plná barva, *nezapsáno* = čárkovaný obrys, *vynecháno* = šikmá čára. Stav se musí přečíst dřív než druh, i v noci.
- **List zespodu**: `role="dialog"`, fokus dovnitř a po zavření zpět, Esc a tah dolů zavírají.
- **Hláška** (toast): inkoustová, nad lištou, u změny vždy „Vrátit“.
- **Odpočet** jako startovní číslo, **týden** jako trasa s tečkou běžce a cílovou vlajkou.

## Motion

Pohyb jen tam, kde vysvětluje: listování týdnů gestem (1:1 s prstem, dojezd podle rychlosti švihu), list zespodu (křivka `cubic-bezier(.32,.72,0,1)`, 240 ms), hláška (200 ms ease-out, odjede stejnou cestou), stisk tlačítka (scale .97, 160 ms) a jediná oslava: fajfka po „Odběhnuto“. Přepínání záložek a rozbalení dne jsou okamžité. Při `prefers-reduced-motion` animace mizí, gesto zůstává.

## Do's and Don'ts

- **Do** jednu jasnou akci na obrazovku; zbytek tiše.
- **Do** barvu jen s významem: intenzita, dnešek, splnění, Strava.
- **Do** český jazyk v rozhraní; anglické fáze z plánů překládat (prep → příprava, peak → vrchol…). Názvy tréninků od trenéra nechat.
- **Do** neutrální oslovení („Když adresa vznikla…“), ne mužský rod.
- **Don't** karty, stínované krabice, gradientový text, nadpisky nad nadpisy.
- **Don't** `faint` na text, bílý text na světlé oranžové, oranžovou Stravy jako běžný text.
- **Don't** knihovny pro UI: appka je čistý JS bez závislostí a přísná CSP (žádné inline styly ani cizí domény).
- **Don't** nechat rozšíření typu Dark Reader přebarvit appku: stránky mají `<meta name="darkreader-lock">`.
