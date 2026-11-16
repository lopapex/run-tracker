# Run Tracker – checklist prvního kola (M1–M4 + Strava k zobrazení)

Zdroj zadání: `RUN_TRACKER_PRODUCT_PLAN.md` v3.0 (soukromý, není v repu – obsahuje osobní údaje).

Stav: `[x]` hotovo a ověřeno (test nebo průchod v prohlížeči) · `[~]` napsáno, ale neověřeno na reálných datech/zařízení · `[ ]` čeká

## Rozhodnutí tohoto kola

- [x] Rozsah: M1–M4 včetně lokální AI (volba uživatele), dodatečně Strava v přehledu
- [x] Repo: `lopapex/run-tracker`, veřejné
- [x] Hosting: Netlify, CLI + průběžné nasazování z GitHubu
- [x] Složka projektu: `Documents/projects/run-tracker`
- [x] Next.js jako statický export; jediná serverová část je funkce pro tokeny Stravy
- [x] Odchylky od §11.1: bez TanStack Query (do M5 není serverový stav), bez shadcn/Radix (vlastní primitives nad nativním `<dialog>`), bez Motion a Recharts (CSS přechody, zatím žádné grafy)

## M1 – lokální základ

- [x] Next.js App Router, TypeScript, Tailwind v4, Zod, Dexie
- [x] Tokeny designu podle §4.5 (zelený akcent, light/dark podle systému, Geist, ovládání 44 px)
- [x] PWA: manifest, ikony, service worker (Serwist), precache app shellu
- [x] Navigace Dnes / Plán / Trenér + Profil pod avatarem (D07)
- [x] První otevření: jazyk/jednotky/zóna, záměr, dostupnost; vše přeskočitelné (§4.2)
- [x] IndexedDB schéma (§12, lokální část)
- [x] Registr příkazů s validací, revizí a auditem (INV-04 až INV-07) – testy
- [x] Undo jako další revize (INV-06) – testy + prohlížeč
- [x] Export a smazání vlastních dat (R-15, lokální část)
- [~] Offline běh po instalaci: service worker se sestaví a registruje; vypnutou síť jsem nezkoušel
- [ ] Světlé téma a větší písmo jsem vizuálně neprocházel (UX-01), čtečku obrazovky také ne (UX-02)

## M2 – první souvislý průchod

- [x] Ruční týden, volitelně opakovaný
- [x] Import PDF: stránka → OCR → tabulka týdnů (§6.1) – referenční plán přečten v Node i v prohlížeči
- [x] IMP-01: 12 týdnů, součty 58…48–51 km, fáze, long run 22 km v týdnu 6, míle nezdvojeny
- [x] Kontrola importu: výřez originálu u každé buňky, nejasnosti, součty, oprava (§6.2)
- [x] Čísla, která OCR v daném fontu slévá („11k“, „1km“, „71k“), se doplní podle tvaru znaků a hlásí ke kontrole
- [x] Ověřená verze je neměnná (INV-01) – test
- [x] Mapování: od data, k závodu, „jsem v týdnu N“, přeskočení týdnů (PLAN-01) – testy
- [x] Pauza a přeskočení týdne v běžícím plánu, vratně – testy
- [x] Dnes: dnešní jednotka, hlavní akce, poslední běh, další 3 dny (R-02)
- [x] Plán: týdenní agenda, předchozí/další, výběr týdne, `Aktuální týden`; otevřený týden nezávislý na pozici (PLAN-03)
- [~] Přejetí palcem mezi týdny: napsáno, na dotykovém zařízení nezkoušeno
- [x] Detail jednotky: přesun (s prohozením), úprava, vynechání, zámek, obnovení originálu, historie
- [~] Import obrázku (PNG/JPG): stejná cesta jako PDF, samostatně nezkoušeno
- [ ] Pace chart se z PDF nenačítá (OCR tabulky temp je nespolehlivé); tempa se zadávají v profilu
- [ ] IMP-03: nesoulad cíle plánu a profilu se hlásí jen když plán cíl má; importovaný plán ho zatím nenastavuje
- [ ] Minulý týden ukazuje současný stav jednotek + historii změn, ne rekonstruovaný „tehdy platný“ rozpis

## M3 – aktivity

- [x] Import GPX / TCX, deduplikace podle checksumu (ACT-01) – testy
- [x] Deterministické metriky: vzdálenost, pohybový čas, tempo, kola po km, tep, převýšení (§7.3)
- [x] Párování: automaticky jen jednoznačný kandidát, jinak výběr; oprava nezdvojí objem – testy
- [x] Rychlý check-in a hodnocení z dostupných vstupů s výpisem toho, co chybí (§7.4)
- [x] Plán versus realita v týdnu
- [~] FIT soubory: napojeno přes `fit-file-parser`, bez reálného souboru nezkoušeno
- [~] Ruční aktivita a check-in: napsáno, v prohlížeči jsem neproklikával

## M4 – chat a drafty

- [x] Draft na 1/2/4 týdny nebo do data: udržování, zlepšení, závod (PLAN-04) – testy + prohlížeč
- [x] Revize draftu, zámek dne, obnovení části starší verze; příklad z §5.5 jako test (PLAN-05)
- [x] Atomická aktivace jen aktuální validní revize; zastaralá se odmítne (PLAN-06, INV-11) – test
- [x] `AiEngine` kontrakt + WebLLM ve Web Workeru; model se stahuje až na vyžádání (§9.1)
- [x] Chat se streamingem a kartami; odpověď lokálního modelu ověřena v desktopovém Chromu (Qwen2.5 0.5B)
- [x] Příkazy z chatu ověřuje doména; neplatný nebo vymyšlený příkaz nic nezmění (CHAT-02) – test
- [x] Usage: tokeny za požadavek i období, původ čísel, neznámé ≠ nula (R-13)
- [x] Bez AI zůstává kalendář, ruční práce i návrh formulářem (AI-04, část)
- [~] Návrh změny z chatu → karta → Použít → Vrátit: logika testovaná, s reálným modelem jsem to nevyvolal
- [~] Zastavení generování, storno stahování a smazání modelu: napsáno, neproklikáno
- [ ] Kvalita: nejmenší model česky jen opisuje data. Výběr výchozího modelu čeká na měření (G1)
- [ ] Řízená paměť trenéra (§8.4) není; kontext se skládá vždy znovu z dat

## Strava (přidáno během práce)

- [x] Karta v přehledu, běhy se vzdáleností, časem, tempem a tepem, stav „odběháno / kratší než plán / mimo plán“
- [x] Odkaz „View on Strava“ (v telefonu otevře aplikaci, je-li nainstalovaná), atribuce „Powered by Strava“
- [x] Data ze Stravy nejdou do kontextu trenéra ani do exportu (DATA-01) – test
- [x] Cache nejvýš 7 dní, starší týdny se načtou až při otevření, odpojení smaže token i cache
- [~] OAuth, obnova tokenu a načítání aktivit: napsáno podle dokumentace, **bez přihlašovacích údajů Strava aplikace neověřeno**
- [ ] Tokeny jsou do M5 uložené v zařízení uživatele, ne šifrovaně na serveru (odchylka od §10.2)
- [ ] Webhooky Stravy (revoke/delete) nejsou; zrušený přístup se pozná až při dalším načtení

## Ověření

- [x] 26 testů (doména, úložiště, Strava izolace) + test referenčního PDF (spouští se jen s lokálním souborem)
- [x] Produkční build
- [x] Průchod v prohlížeči na šířce telefonu, tmavé téma: onboarding → návrh → plán → přesun → vrácení → import PDF → chat

## Vydání

- [x] GitHub repo: https://github.com/lopapex/run-tracker
- [x] Netlify web napojený na repo (push do `main` nasadí): https://run-tracker-613.netlify.app
- [x] Živá URL ověřena: stránky, service worker, worker lokální AI i funkce `/api/strava` odpovídají
- [ ] Aplikaci jsem na ostré adrese neproklikával v telefonu ani neinstaloval jako PWA

## Co potřebuje tebe

- [ ] Strava: založit API aplikaci na strava.com/settings/api, nastavit callback doménu a dvě proměnné v Netlify (viz README)
- [ ] G1: vyzkoušet lokální modely na Pixelu 10 (rychlost, paměť, čeština) a vybrat výchozí
- [ ] G2: veřejné vydání se Stravou vyžaduje její schválení aplikace (do té doby jen ty jako vlastník)
- [ ] G3: vlastní tarif ChatGPT/Codex – ověřit způsobilost v programu „Sign in with ChatGPT“
- [ ] G4: zkusit import plánu s jinou strukturou; parser zná jeden typ tabulky

## Další kola

- [ ] M5: Supabase Auth/RLS, sync, guest merge, serverové tokeny
- [ ] M6: cloudová AI podle G3, limity tarifu, Strava webhooky
- [ ] M7: mobilní QA, provozní retence, monitoring
