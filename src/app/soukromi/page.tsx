export default function PrivacyPage() {
  return <article className="space-y-4 text-[15px]">
    <h2 className="display text-[28px]">Jak se ukládají tvoje data</h2>
    <p>Bez přihlášení zůstávají plán, původní PDF, vlastní aktivity, poznámky a historie konzultací v tomto prohlížeči (IndexedDB). Vymazání dat webu je odstraní. Pravidelně používej export v Profilu.</p>
    <p>Po přihlášení vznikne samostatný místní prostor účtu. Synchronizaci zapínáš výslovně v Profilu. Pak se tyto údaje a originály dokumentů ukládají do soukromého prostoru Supabase v EU (Frankfurt). Přístup řídí přihlášení a pravidla databáze pro vlastníka. E-mail pro přihlašovací odkaz zpracovává Supabase.</p>
    <p>Strava je samostatné propojení jen ke čtení. Aplikace zobrazuje dočasně uložené aktivity a odkazy do Stravy. Cache a přístupové tokeny se nesynchronizují, neexportují a nedostávají do podkladů pro trenéra. Cache expiruje nejpozději sedm dní od stažení; odpojení v Profilu odstraní místní přístup i cache.</p>
    <p>Trenéra používáš ve vlastním ChatGPT nebo Claude. Před kopírováním můžeš podklady zkontrolovat. Aplikace je automaticky neposílá a nečte tvůj externí chat. Pokud si v něm připojíš Stravu, jde o přímý vztah s danou službou; řídí se jejími pravidly. Do Run Trackeru vracíš pouze návrh změny plánu.</p>
    <p>Web hostuje Netlify. Serverové funkce pro připojení Stravy předávají autorizační údaje službě Strava. Kód aplikace nezapisuje obsah plánu ani přístupové údaje do vlastních aplikačních logů; provozovatelé infrastruktury mohou zpracovávat technické údaje o požadavcích podle svých podmínek.</p>
    <p>V Profilu můžeš vypnout synchronizaci, exportovat vlastní data a smazat místní prostor. Při zapnuté synchronizaci místní smazání samo o sobě neznamená odstranění cloudové kopie. Veřejná verze je ve vývoji; automatické zálohy databáze a plné samoobslužné smazání účtu zatím nejsou hotové.</p>
    <p className="text-[13px] text-muted">Aktualizováno 16. listopadu 2026. <a className="underline" href="/profil/">Zpět do Profilu</a></p>
  </article>;
}
