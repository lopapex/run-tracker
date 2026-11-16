// Adresa konektoru vzniká jen v prohlížeči: 32 náhodných bajtů jako klíč v cestě.
// Server ji uvidí až ve chvíli, kdy ji Claude poprvé použije.
(() => {
  const STORAGE = 'rt.connectorKey';
  const KEY = /^[A-Za-z0-9_-]{40,64}$/;
  const $ = (id) => document.getElementById(id);
  const create = $('create');
  const result = $('result');
  const url = $('url');
  const status = $('status');

  const read = () => {
    try {
      const key = localStorage.getItem(STORAGE);
      return key && KEY.test(key) ? key : null;
    } catch {
      return null;
    }
  };

  const remember = (key) => {
    try {
      localStorage.setItem(STORAGE, key);
      return true;
    } catch {
      return false;
    }
  };

  const newKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const show = (key, message) => {
    url.value = `${location.origin}/mcp/${key}`;
    result.hidden = false;
    create.hidden = true;
    status.textContent = message;
  };

  const generate = () => {
    const key = newKey();
    show(key, remember(key) ? 'Adresa je uložená v tomhle prohlížeči. Přesto si ji zkopíruj na bezpečné místo.' : 'Prohlížeč adresu neuložil. Zkopíruj si ji hned, po zavření stránky už ji neuvidíš.');
  };

  create.addEventListener('click', generate);

  $('renew').addEventListener('click', () => {
    if (confirm('Nová adresa má prázdný plán. Stará dál funguje, pokud ji máš uloženou. Pokračovat?')) generate();
  });

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.value);
      status.textContent = 'Zkopírováno. Vlož adresu do nastavení konektorů v Claude.';
    } catch {
      url.select();
      status.textContent = 'Kopírování se nepovedlo. Adresa je označená, zkopíruj ji ručně.';
    }
  });

  url.addEventListener('focus', () => url.select());

  const existing = read();
  if (existing) show(existing, 'Tohle je adresa vytvořená dřív v tomhle prohlížeči.');
})();
