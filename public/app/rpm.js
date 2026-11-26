// RPM: obyčejná stránka nad /mcp/<klíč>. Tři záložky: Týden (co běžet dnes a jak rychle), Plán (blok jako matice, založení a schválení plánu), Tempa.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view'), sheet = $('#sheet'), toastEl = $('#toast');
  var DOW = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
  var TYPE_LVL = { easy: 1, other: 1, long: 2, tempo: 3, speed: 4, race: 5, strength: 0, cross: 0 };
  var INT_LVL = { walk: 0, easy: 1, free: 1, steady: 2, mp: 2, hm_pace: 3, '10k_pace': 4, '5k_pace': 4, strides: 4 };
  var RACES = [[5000, '5 km'], [10000, '10 km'], [21097.5, '21,1'], [42195, '42,2']];
  // Ikony druhů tréninku: bota, trasa, plamen, blesk, cílová vlajka… Barva podle zóny, jak ji běžci znají z hodinek.
  var IC = {
    easy: '<path d="M2.5 16V8.5l3 1.5L8 7.5h2.6l3 4 5.2 1.3a2.5 2.5 0 0 1 1.9 2.4v.8z"/><path d="M2.5 19h18.2M9.3 10.6l1.3-1.1M11 12.3l1.3-1.1"/>',
    long: '<circle cx="5" cy="19" r="2"/><path d="M7 19h7.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H17"/><path d="M17 2.5v5l3-1.2z"/>',
    tempo: '<path d="M12 21a6 6 0 0 0 6-6c0-4.5-3.5-6.5-5-11-1.8 2.6-2 4.4-1.5 6.4C10.4 9.7 9.4 8.8 9 7.5 7.3 9.4 6 11.8 6 15a6 6 0 0 0 6 6z"/>',
    speed: '<path d="M13.5 2.5 5 13.5h6.2l-1.2 8 8.5-11h-6.3z"/>',
    race: '<path d="M5 21.5V3.5"/><path d="M5 4h13.5l-2.7 4.2 2.7 4.3H5"/><path d="M9.5 4v8.5M14 4v8.5M5 8.2h12"/>',
    strides: '<path d="M4 6.5 9.5 12 4 17.5M11.5 6.5 17 12l-5.5 5.5"/>',
    strength: '<path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11"/>',
    cross: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l3.5-7h5.5l3 7M12 16 9.5 9M13.5 6h2.5"/>',
    rest: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    doc: '<path d="M6.5 2.5h8l4 4v15h-12z"/><path d="M14.5 2.5v4h4M9.5 11.5h6M9.5 15h6M9.5 18.5h4"/>',
    pulse: '<path d="M2.5 12.5h4l2.5-7 4.5 13 2.5-6h5.5"/>',
    check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
    // Značka Stravy u akcí, které jdou přes oficiální konektor Strava v Claude.
    strava: '<path d="M15.39 17.94l-2.09-4.11h-3.07L15.39 24l5.15-10.17h-3.07M10.36 8.23l2.84 5.6h4.17L10.36 0 3.37 13.83h4.17"/>'
  };
  IC.other = IC.easy;
  var PACE_IC = { walk: 'rest', easy: 'easy', free: 'easy', steady: 'long', mp: 'long', hm_pace: 'tempo', '10k_pace': 'speed', '5k_pace': 'speed', strides: 'strides' };
  function ico(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (IC[name] || IC.easy) + '</svg>'; }
  function badge(type) { return '<span class="bd ' + (type === 'rest' ? 'rest' : 'e' + lvlOfType(type)) + '">' + ico(type) + '</span>'; }
  // Ilustrace prázdných obrazovek: trasa ze startu do cíle.
  var ROUTE_ART = '<svg class="art" viewBox="0 0 280 96" aria-hidden="true"><path class="r" d="M18 74c40 0 40-46 90-46s52 44 98 44 46-38 56-50"/><circle class="s" cx="18" cy="74" r="6"/><path class="f" d="M262 22V4l12 5-12 5"/><circle class="me" cx="108" cy="28" r="7"/></svg>';
  var MEDAL_ART = '<svg class="art medal" viewBox="0 0 96 112" aria-hidden="true"><path class="rb1" d="M26 4h18l12 34H38z"/><path class="rb2" d="M70 4H52L40 38h18z"/><circle class="m" cx="48" cy="72" r="30"/><circle class="m2" cx="48" cy="72" r="22"/><path class="m3" d="m48 58 4.3 8.8 9.7 1.4-7 6.8 1.7 9.6L48 80l-8.7 4.6 1.7-9.6-7-6.8 9.7-1.4z"/></svg>';
  // Fáze z anglických plánů česky; neznámý název zůstane, jak je.
  var PHASE = { prep: 'příprava', preparation: 'příprava', base: 'základ', build: 'budování', recovery: 'odlehčení', peak: 'vrchol', taper: 'ladění', race: 'závod', 'race week': 'závodní týden' };
  function phaseCs(ph) { var k = String(ph || '').trim().toLowerCase(); return PHASE[k] || k.replace(/^[a-z]+/, function (w) { return PHASE[w] || w; }); }
  function daysWord(n) { return n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní'; }

  // ---------- Klíč ----------
  var theme = (location.hash.match(/theme=(light|dark)/) || [])[1];
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  var key = null, firstTab = (location.hash.match(/t=(week|plan|paces|new)/) || [])[1];
  try {
    var m = location.hash.match(/k=([\w-]{20,})/);
    if (m) { localStorage.setItem('rt.connectorKey', m[1]); history.replaceState(null, '', location.pathname); }
    key = localStorage.getItem('rt.connectorKey');
  } catch (e) { /* soukromé okno */ }

  // ---------- API ----------
  var rid = 0;
  function call(name, args) {
    return fetch('/mcp/' + key + '?client=app', {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name: name, arguments: args || {} } })
    }).then(function (r) {
      if (r.status === 404) { setup('Adresa konektoru neplatí. Vlož ji znovu.'); throw new Error('Adresa konektoru neplatí.'); }
      if (!r.ok) throw new Error('Spojení se nepovedlo.');
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error.message);
      var res = j.result;
      if (res.isError) throw new Error(((res.content || [])[0] || {}).text || 'Akce se nepovedla.');
      return res.structuredContent || {};
    });
  }

  // ---------- Stav ----------
  var S = { tab: 'week', week: null, plan: null, paces: null, staged: null, sub: null, open: null, form: null, calc: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function num(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }
  // Km z plánu; když je spočítat nejde (úseky na čas bez temp), aspoň délka v minutách z profilu.
  function kmOf(w) {
    if (!w.kmUnknown && w.kmMax) return (w.kmMin === w.kmMax ? '' : '~') + num(Math.round(w.kmMax * 2) / 2);
    var sec = (w.profile || []).reduce(function (s, p) { return s + p[1]; }, 0);
    return sec ? Math.round(sec / 60) + '<small> min</small>' : '';
  }
  function pace(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function dm(iso) { var d = iso.split('-'); return +d[2] + '. ' + +d[1] + '.'; }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function todayIso() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function nextMonday() { var t = todayIso(), dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7; return addDays(t, 7 - dow); }
  function lvlOfType(t) { return TYPE_LVL[t] == null ? 1 : TYPE_LVL[t]; }

  // Nový chat s Claudem s připravenou větou; Claude pracuje přes konektor nad stejnými daty.
  function toClaude(q) { window.open('https://claude.ai/new?q=' + encodeURIComponent(q), '_blank', 'noopener'); }

  // ---------- Hláška s Vrátit ----------
  var toastTimer;
  // Hláška přijede zespodu a stejnou cestou odjede; přechod (ne keyframes), takže jde přerušit další hláškou.
  function toast(text, undo) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button" data-undo>Vrátit</button>' : '');
    if (toastEl.hidden) { toastEl.hidden = false; void toastEl.offsetWidth; }
    toastEl.classList.add('on');
    toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.classList.remove('on');
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, reduced() ? 0 : 200);
  }
  toastEl.addEventListener('click', function (e) {
    if (!e.target.closest('[data-undo]')) return;
    hideToast();
    act('undo_change', {}, 'Vráceno');
  });

  // ---------- Načtení ----------
  function load(tab, args) {
    S.tab = tab;
    var p = tab === 'week' ? call('show_week', Object.assign({}, args))
      : tab === 'plan' ? call('show_week', { tab: 'plan' })
      : call('show_week', { tab: 'paces' });
    return p.then(function (d) { take(d); render(); }, fail);
  }
  // Načtené týdny podle pondělí: sousední týden je při listování hned po ruce.
  var weeks = {}, fetching = {};
  function prefetch() {
    var d = S.week;
    if (!d || d.view !== 'week') return;
    [-1, 1].forEach(function (dir) {
      var k = addDays(d.weekStart, dir * 7);
      if (!hasWeek(dir) || weeks[k] || fetching[k]) return;
      fetching[k] = true;
      call('show_week', { date: k }).then(function (x) { if (x.view === 'week') weeks[x.weekStart] = x; }, function () { /* zkusí se příště */ }).then(function () { delete fetching[k]; });
    });
  }
  function take(d) {
    // Tlačítka Stravy jen u toho, kdo má v Claude konektor Strava (server to ví z hodnocení nebo z přepínače).
    if (d && 'strava' in d) S.strava = d.strava;
    if (d.view === 'week') { S.week = d; weeks[d.weekStart] = d; }
    else if (d.view === 'plan') S.plan = d;
    else if (d.view === 'paces') { if (d.calc) S.calc = d; else { S.paces = d; S.calc = null; } }
    else if (d.view === 'import') { S.staged = d; S.sub = 'staged'; S.tab = 'plan'; }
    else if (d.view === 'finished') S.week = d;
    else if (d.view === 'empty') { S.week = d; S.plan = d; if (S.tab === 'plan' && !S.sub) S.sub = 'new'; }
  }
  function fail(err) { toast(err && err.message ? err.message : 'Něco se nepovedlo.'); render(); }
  // Zápis: server vrátí přepočítaný týden nebo plán, ten se rovnou ukáže.
  function act(name, args, msg, undo) {
    return call(name, args).then(function (d) {
      // Změna mohla zasáhnout i sousední týden (přesun, vrácení); uložené týdny se načtou znovu.
      weeks = {};
      take(d); render(); if (msg) toast(msg, undo); return d;
    }, fail);
  }

  // ---------- Týden ----------
  function profile(w, max) {
    if (!w.profile || !w.profile.length) return '<span class="pf empty"></span>';
    var total = w.profile.reduce(function (s, p) { return s + p[1]; }, 0);
    var h = '<span class="pf" data-wpct="' + Math.max(8, Math.round(total / max * 100)) + '">';
    w.profile.forEach(function (p) { h += '<i class="e' + (INT_LVL[p[0]] == null ? 1 : INT_LVL[p[0]]) + '" data-g="' + p[1] + '"></i>'; });
    return h + '</span>';
  }
  function stOf(w, day) {
    if (w.status === 'completed') return 'done';
    if (w.status === 'partial') return 'partial';
    if (w.status === 'skipped') return 'skipped';
    return day.isPast ? 'missed' : 'none';
  }
  function steps(w) {
    var lines = w.lines && w.lines.length ? w.lines : [(/^[\d,.]+ km$/.test(w.summary) ? mainLabel(w) : w.summary) + (mainPace(w) ? ' (' + mainPace(w) + '/km)' : '')];
    // Tempa z textu do pravého sloupce; řádek s víc úseky (800 m + 200 m) má víc temp pod sebou.
    return '<ul class="steps">' + lines.map(function (l) {
      var paces = [], text = l.replace(/\s*\(([^()]*\d:\d\d[^()]*)\)/g, function (_, p) { paces.push(p.replace('/km', '')); return ''; });
      return '<li><span>' + esc(text) + '</span>' + (paces.length ? '<span class="p">' + paces.map(esc).join('<br>') + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function mainZone(w) {
    if (!S.paces || !w.profile || !w.profile.length) return null;
    var k = w.profile.slice().sort(function (a, b) { return b[1] - a[1]; })[0][0];
    return S.paces.paces.filter(function (x) { return x.key === k; })[0] || null;
  }
  function mainLabel(w) { var p = mainZone(w); return p ? p.label.charAt(0).toUpperCase() + p.label.slice(1) : w.summary; }
  function mainPace(w) {
    if (!S.paces || !w.profile || !w.profile.length) return '';
    var k = w.profile.slice().sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var p = S.paces.paces.filter(function (x) { return x.key === k; })[0];
    return p ? pace(p.fromSec) + '–' + pace(p.toSec) : '';
  }
  // Jedna jasná akce, zbytek jako tiché odkazy (bez nabídky ···).
  function link(act, id, label, cls) { return '<button type="button"' + (cls ? ' class="' + cls + '"' : '') + ' data-do="' + act + '" data-id="' + id + '">' + label + '</button>'; }
  function detail(w, day) {
    var h = '<div class="open">' + steps(w), id = w.id;
    if (w.planNote) h += '<p class="note">' + esc(w.planNote) + '</p>';
    // Doslovné znění z dokumentu trenéra: kontrola, že přepis sedí.
    var raw = w.raw ? w.raw.replace(/\s*\n\s*/g, ' ').trim() : '';
    if (raw && raw.toLowerCase() !== String(w.title).toLowerCase()) h += '<p class="note raw">V plánu: ' + esc(raw) + '</p>';
    (w.fixes || []).forEach(function (t) { h += '<p class="note fix">Při přepisu opraveno: ' + esc(t) + '</p>'; });
    (w.issues || []).forEach(function (t) { h += '<p class="note iss">' + esc(t) + '</p>'; });
    if (w.status === 'skipped') {
      h += '<p class="state">Vynecháno' + (w.skipReason ? ': ' + esc(w.skipReason) : '') + '</p><div class="links">' + link('restore', id, 'Obnovit') + '</div>';
    } else if (w.status === 'completed' || w.status === 'partial') {
      if (w.status === 'partial') h += '<p class="state">Odběhnuto jen částečně</p>';
      h += '<div class="links">' + (S.strava ? link('eval', id, ico('strava', 'fill') + 'Zhodnotit se Stravou', 'ext strava') : '') + (w.status === 'completed' ? link('partial', id, 'Jen část') : '') + link('unset', id, 'Zrušit') + '</div>';
    } else {
      if (day.isPast) h += '<p class="state">Nezapsáno.</p>';
      if (day.isPast || day.isToday) h += '<div class="acts sm"><button type="button" class="btn go' + (day.isToday ? ' accent' : '') + '" data-do="done" data-id="' + id + '">' + ico('check') + 'Odběhnuto</button></div>';
      h += '<div class="links">' + link('move', id, 'Přesunout') + link('skip', id, 'Vynechat') + (day.isPast ? '' : link('fit', id, 'Do hodinek')) + '</div>';
    }
    return h + '</div>';
  }
  function renderWeek() {
    var d = S.week;
    if (d && d.view === 'finished') return renderFinished(d);
    if (!d || d.view !== 'week') return emptyHint();
    var st = d.stats;
    var m = d.label.match(/týden (\d+) z (\d+)/);
    var h = '<header class="hd"><h1 class="big">' + (m ? 'Týden ' + m[1] + '<span class="n">/' + m[2] + '</span>' : esc(d.label.charAt(0).toUpperCase() + d.label.slice(1))) + '</h1>';
    h += '<div class="nav"><button type="button" data-do="prev" aria-label="Předchozí týden"' + (d.hasPrev ? '' : ' disabled') + '>‹</button><button type="button" data-do="next" aria-label="Další týden"' + (d.hasNext ? '' : ' disabled') + '>›</button></div></header>';
    // Týden jako trasa: hotové km jsou uběhnutý kus, tečka je běžec, na konci cílová vlajka.
    var pct = Math.min(100, Math.round(st.doneKm / Math.max(1, st.plannedKmMax) * 100));
    h += '<div class="hero"><div class="trip"><p class="kmb"><b>' + num(st.doneKm) + '</b><span> z ' + Math.round(st.plannedKmMax) + ' km</span></p>';
    h += '<div class="route' + (pct >= 100 ? ' full' : '') + '" role="img" aria-label="Uběhnuto ' + pct + ' % týdne"><i data-wpct="' + pct + '"></i>' + ico('race', 'flag') + '</div>';
    h += d.phase ? '<p class="phase">' + esc(phaseCs(d.phase)) + '</p>' : '';
    h += '</div>';
    // Odpočet do závodu jako startovní číslo.
    if (d.isCurrent && d.daysToRace != null) h += '<div class="bib" role="img" aria-label="Závod ' + (d.daysToRace ? 'za ' + d.daysToRace + ' ' + daysWord(d.daysToRace) : 'dnes') + '"><span>závod</span><b>' + (d.daysToRace || 'DNES') + '</b><small>' + (d.daysToRace ? daysWord(d.daysToRace) + ' do startu' : 'hodně štěstí') + '</small></div>';
    h += '</div>';
    if (d.staged) h += '<button type="button" class="pending" data-do="staged"><span>Nový plán „' + esc(d.staged.name) + '“ čeká na kontrolu.</span><b>Zkontrolovat ›</b></button>';
    return h + daysHtml(d, S.open == null ? autoOpen(d) : S.open) + installRow();
  }
  // Řádky dní jednoho týdne; stejné HTML slouží i pro sousední týden, který při listování jede vedle.
  function daysHtml(d, auto) {
    var max = 1, h = '<ul class="days">';
    d.days.forEach(function (day) { day.workouts.forEach(function (w) { var t = (w.profile || []).reduce(function (s, p) { return s + p[1]; }, 0); if (t > max) max = t; }); });
    d.days.forEach(function (day) {
      var list = day.workouts.filter(function (w) { return w.type !== 'rest'; });
      if (!list.length) {
        h += '<li class="day rest' + (day.isToday ? ' today' : '') + '"><div class="hit">' + dw(day) + badge('rest') + '<span class="nm">Volno</span><span class="km"></span><span class="st"></span></div></li>';
        return;
      }
      list.forEach(function (w, i) {
        var s = stOf(w, day), open = auto === w.id;
        h += '<li class="day' + (day.isToday ? ' today' : '') + (s === 'done' ? ' done' : '') + (s === 'skipped' ? ' off' : '') + '">';
        h += '<button type="button" class="hit" data-do="open" data-id="' + w.id + '" aria-expanded="' + open + '">' + (i === 0 ? dw(day) : '<span class="dw"></span>') + badge(w.type);
        h += '<span class="nm">' + esc(w.title) + (w.moved ? ' <small>přesunuto</small>' : '') + '</span><span class="km">' + kmOf(w) + '</span><span class="st ' + s + (S.pop === w.id ? ' pop' : '') + '" aria-label="' + ({ done: 'hotovo', partial: 'částečně', skipped: 'vynecháno', missed: 'nezapsáno' }[s] || 'naplánováno') + '"></span>' + profile(w, max) + '</button>';
        if (open) h += detail(w, day);
        h += '</li>';
      });
    });
    return h + '</ul>';
  }
  // Instalace na plochu: Android a Chrome přes výzvu prohlížeče, iPhone jednou větou. Po zavření se neukáže.
  function standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  function installRow() {
    var off; try { off = localStorage.getItem('rpm.noInstall'); } catch (x) { off = '1'; }
    if (off || theme || standalone()) return '';
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!S.install && !ios) return '';
    return '<div class="install"><p>' + (S.install ? 'RPM jako appka na ploše' : 'Na plochu: <b>Sdílet</b> → <b>Přidat na plochu</b>') + '</p>' + (S.install ? '<button type="button" class="btn go" data-do="install">Nainstalovat</button>' : '') + '<button type="button" class="x" data-do="noinstall" aria-label="Skrýt">×</button></div>';
  }
  function dw(day) { return '<span class="dw">' + DOW[day.dow] + '<b>' + +day.date.slice(8) + '</b></span>'; }
  // Sám se rozbalí jen dnešní trénink; ostatní dny až na klepnutí.
  function autoOpen(d) {
    var hit = null;
    (d.days || []).forEach(function (day) { if (day.isToday && !hit) day.workouts.forEach(function (w) { if (w.type !== 'rest' && !hit) hit = w.id; }); });
    return hit;
  }
  function findW(id) {
    var out = null;
    (S.week.days || []).forEach(function (day) { day.workouts.forEach(function (w) { if (w.id === id) out = [w, day]; }); });
    return out;
  }
  // Po posledním týdnu: jak plán dopadl a co dál. Čísla jsou podle plánu, ne naměřená.
  function renderFinished(d) {
    var p = d.plan, runs = p.done + p.partial;
    var h = '<header class="hd"><h1 class="big">Plán dokončen</h1></header><p class="meta">' + esc(p.name) + '<span>' + dm(p.first) + ' – ' + dm(p.last) + '</span></p>';
    h += '<div class="trophy">' + MEDAL_ART + '<p>' + (runs >= p.runs * 0.8 ? 'Tohle se povedlo.' : 'Dobojováno.') + '</p></div>';
    h += '<dl class="fin"><div><dt>Odběhnuto</dt><dd class="n">' + runs + '<small> z ' + p.runs + ' běhů</small></dd></div>';
    h += '<div><dt>Kilometry podle plánu</dt><dd class="n">' + p.doneKm + '<small> z ' + p.plannedKm + ' km</small></dd></div>';
    if (p.skipped) h += '<div><dt>Vynecháno</dt><dd class="n">' + p.skipped + '</dd></div>';
    h += '</dl><div class="form choice"><button type="button" class="btn go accent wide" data-do="tab" data-v="plan">Nový plán</button>';
    return h + '<button type="button" class="row-link" data-do="showplan">Celý uplynulý plán</button></div>';
  }
  function emptyHint() {
    return '<div class="blank">' + ROUTE_ART + '<p class="lead">Zatím nemáš plán.</p><p>Nahraj plán od trenéra, nebo si ho nech postavit podle Stravy.</p><p><button type="button" class="btn go accent" data-do="tab" data-v="plan">Založit plán</button></p></div>';
  }

  // ---------- Přesun jednotky ----------
  function moveMenu(id) {
    var x = findW(id), w = x[0], start = S.week.weekStart;
    var h = '<div class="back" data-do="close"></div><section class="panel" role="dialog" aria-modal="true" aria-label="Přesunout"><h2>Přesunout ' + esc(w.title) + ' <button type="button" data-do="close">Zavřít</button></h2><div class="seg n wk7">';
    for (var i = 0; i < 7; i++) {
      var date = addDays(start, i);
      h += '<button type="button" data-do="moveto" data-id="' + id + '" data-v="' + date + '"' + (date === w.date ? ' class="on" disabled' : '') + '>' + DOW[i] + '</button>';
    }
    openSheet(h + '</div><p class="hint">Když je v cílovém dni jiný běh, prohodí se.</p></section>');
  }
  // List zespodu: fokus do listu a po zavření zpět, Esc zavře, tah dolů zavře. Zavření jede stejnou cestou jako otevření.
  var sheetFrom = null, sheetTimer;
  function openSheet(html) {
    clearTimeout(sheetTimer);
    sheetFrom = document.activeElement;
    sheet.innerHTML = html; sheet.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('on');
    var first = sheet.querySelector('.panel button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    var panel = sheet.querySelector('.panel');
    if (panel) { panel.style.transition = ''; panel.style.transform = ''; }
    sheet.classList.remove('on');
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () { sheet.hidden = true; sheet.innerHTML = ''; }, reduced() ? 0 : 240);
    if (sheetFrom && sheetFrom.focus && document.contains(sheetFrom)) sheetFrom.focus({ preventScroll: true });
    sheetFrom = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !sheet.hidden) { closeSheet(); return; }
    // Šipky listují týdny, když se zrovna nepíše do pole.
    if (sheet.hidden && S.tab === 'week' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.metaKey && !e.ctrlKey) goWeek(e.key === 'ArrowRight' ? 1 : -1);
  });
  // Tah listu dolů: panel jde 1:1 s prstem, po puštění zavře podle vzdálenosti nebo rychlosti, jinak rychle zpět.
  var sg = null;
  sheet.addEventListener('touchstart', function (e) {
    var panel = e.target.closest('.panel');
    sg = panel && panel.scrollTop <= 0 && e.touches.length === 1 ? { panel: panel, y: e.touches[0].clientY, dy: 0, v: 0, t: e.timeStamp } : null;
  }, { passive: true });
  sheet.addEventListener('touchmove', function (e) {
    if (!sg) return;
    var dy = e.touches[0].clientY - sg.y;
    if (dy <= 0) { sg.panel.style.transform = ''; sg.dy = 0; return; }
    e.preventDefault();
    var dt = Math.max(1, e.timeStamp - sg.t);
    sg.v = (dy - sg.dy) / dt; sg.dy = dy; sg.t = e.timeStamp;
    sg.panel.style.transition = 'none';
    sg.panel.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: false });
  function sheetEnd(e) {
    var s = sg; sg = null;
    if (!s || !s.dy) return;
    var v = e.timeStamp - s.t > 80 ? 0 : s.v;
    s.panel.style.transition = '';
    if (s.dy > s.panel.offsetHeight * 0.3 || v > 0.4) closeSheet();
    else s.panel.style.transform = '';
  }
  sheet.addEventListener('touchend', sheetEnd);
  sheet.addEventListener('touchcancel', sheetEnd);

  // ---------- Plán ----------
  function cell(c, today) {
    if (!c) return '<span class="c rest' + (today ? ' today' : '') + '"></span>';
    return '<span class="c e' + lvlOfType(c[0]) + ' s-' + c[1] + (today ? ' today' : '') + '"></span>';
  }
  function matrix(weeks, opts) {
    var phase = null, today = todayIso();
    // Dnešek: sloupec dne v záhlaví oranžově s tečkou, buňka v probíhajícím týdnu s oranžovým rámečkem (i volný den).
    var nowDow = opts.link && weeks.some(function (w) { return w.isCurrent; }) ? (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7 : -1;
    var h = '<table class="mx"><thead><tr><th></th>' + DOW.map(function (x, i) { return i === nowDow ? '<th class="now" aria-current="date">' + x + '</th>' : '<th>' + x + '</th>'; }).join('') + '<th class="vol">km</th></tr></thead><tbody>';
    weeks.forEach(function (w) {
      var ph = phaseCs(w.phase);
      if (ph && ph !== phase) h += '<tr class="ph"><td colspan="9">' + esc(ph) + '</td></tr>';
      phase = ph || phase;
      var flag = opts.stage && (w.issues.length || w.totals === 'off'), open = opts.stage && S.sweek === w.index;
      var cls = 'w' + (w.isCurrent ? ' cur' : '') + (w.isPast ? ' past' : '') + (flag ? ' flag' : '') + (open ? ' open' : '');
      var target = opts.link ? ' data-do="week" data-v="' + w.weekStart + '"' : opts.stage ? ' data-do="sweek" data-v="' + w.index + '" aria-expanded="' + open + '"' : '';
      var wkNo = w.sourceWeek != null ? w.sourceWeek : w.index != null ? w.index : '–';
      // Číslo týdne je tlačítko, aby šel týden otevřít i klávesnicí; klepnout jde dál na celý řádek.
      var wkBtn = opts.link ? '<button type="button" data-do="week" data-v="' + w.weekStart + '" aria-label="Otevřít týden ' + wkNo + '">' + wkNo + '</button>'
        : opts.stage ? '<button type="button" data-do="sweek" data-v="' + w.index + '" aria-expanded="' + open + '" aria-label="Týden ' + wkNo + ' ke kontrole">' + wkNo + '</button>' : wkNo;
      h += '<tr class="' + cls + '"' + target + '><td class="wk">' + wkBtn + '</td>';
      w.cells.forEach(function (c, i) { h += '<td>' + cell(c, opts.link && w.weekStart && addDays(w.weekStart, i) === today) + '</td>'; });
      var plannedKm = w.plannedKmMax != null ? w.plannedKmMax : w.kmMax, vol;
      if (opts.link && (w.isPast || w.isCurrent)) vol = num(w.doneKm) + '<span class="mute"> / ' + Math.round(plannedKm) + '</span>';
      // Při kontrole součet přepisu vedle součtu, který uvádí autor plánu.
      else if (opts.stage && w.declaredKm != null) vol = '<span' + (w.totals === 'off' ? ' class="bad"' : '') + '>' + Math.round(w.kmMax) + '</span><span class="mute"> / ' + Math.round(w.declaredKm) + '</span>';
      else vol = Math.round(plannedKm);
      h += '<td class="vol">' + vol + '</td></tr>';
      if (open) h += '<tr class="wd"><td colspan="9">' + weekDetail(w) + '</td></tr>';
    });
    return h + '</tbody></table>' + legend(nowDow >= 0);
  }
  function legend(now) {
    var t = [['e1', 'volně'], ['e2', 'dlouhý'], ['e3', 'tempo'], ['e4', 'rychlost'], ['e5', 'závod']];
    return '<div class="legend">' + t.map(function (x) { return '<span><i class="c ' + x[0] + ' s-completed"></i>' + x[1] + '</span>'; }).join('') +
      '</div><div class="legend sts"><span><i class="c e2 s-scheduled"></i>v plánu</span><span><i class="c e2 s-completed"></i>splněno</span><span><i class="c e2 s-missed"></i>nezapsáno</span><span><i class="c e2 s-skipped"></i>vynecháno</span>' + (now ? '<span><i class="c e2 s-scheduled today"></i>dnes</span>' : '') + '</div>';
  }

  function renderPlan() {
    if (S.sub === 'new') return renderForm();
    if (S.sub === 'staged' && S.staged) return renderStaged();
    var d = S.plan;
    // Plán se ještě načítá: místo formuláře nového plánu (problikl by) jen prázdná plocha.
    if (!d && S.week && (S.week.view === 'week' || S.week.view === 'finished')) return '<p class="blank">Načítám…</p>';
    if (!d || d.view !== 'plan') return renderForm();
    var t = d.totals;
    var h = '<header class="hd"><h1>' + esc(d.planName) + '</h1><button type="button" class="tb" data-do="new">Nový</button></header>';
    h += '<p class="meta"><b>' + t.doneKm + '</b> z ' + t.plannedKm + ' km<span>' + (d.last ? 'do ' + dm(d.last) : '') + '</span></p>';
    if (S.week && S.week.staged) h += '<button type="button" class="pending" data-do="staged"><span>Rozpracovaný plán „' + esc(S.week.staged.name) + '“ čeká na schválení.</span><b>Zkontrolovat ›</b></button>';
    return h + matrix(d.weeks, { link: true }) + stravaLine();
  }

  // ---------- Nový plán ----------
  function defaults() {
    return { intent: 'race', dist: 21097.5, race: '', weeks: 12, km: 30, runs: 4, long: 6, rest: [0, 4], start: nextMonday() };
  }
  function seg(name, items, val, cls) {
    return '<div class="seg' + (cls ? ' ' + cls : '') + '">' + items.map(function (it) {
      return '<button type="button" data-f="' + name + '" data-v="' + it[0] + '"' + (String(it[0]) === String(val) ? ' class="on"' : '') + '>' + it[1] + '</button>';
    }).join('') + '</div>';
  }
  // Nový plán: nejčastěji plán od trenéra (PDF), pak plán podle Stravy; obojí čte Claude. Ruční formulář je záloha.
  function renderChoice() {
    var hasPlan = S.plan && S.plan.view === 'plan';
    var h = '<header class="hd line"><h1>Nový plán</h1>' + (hasPlan ? '<button type="button" class="tb" data-do="cancel">Zrušit</button>' : '') + '</header><div class="form choice">';
    h += ROUTE_ART + '<button type="button" class="doc main" data-do="doc"><span class="bd ink">' + ico('doc') + '</span><b>Plán od trenéra</b><span>PDF, fotka nebo tabulka. Otevře se Claude s připravenou zprávou, přiložíš soubor a odešleš. Přepsaný plán se objeví tady ke kontrole.</span></button>';
    if (S.strava) h += '<button type="button" class="doc strava" data-do="strava"><span class="bd sv">' + ico('strava', 'fill') + '</span><b>Plán podle mé Stravy</b><span>Claude projde tvoje běhy za poslední 2–3 měsíce, zeptá se na cíl a postaví plán ke kontrole.</span></button>';
    h += '<p class="hint">' + (S.strava ? 'Obojí potřebuje adresu RPM přidanou v Claude jako konektor; pro Stravu i oficiální konektor Strava.' : 'Potřebuje adresu RPM přidanou v Claude jako konektor.') + '</p>';
    // Bez Stravy jen nenápadný odkaz, kterým se karta Stravy zapne; nastavuje se jednou.
    return h + '<button type="button" class="row-link" data-do="manual">Sestavit bez Clauda</button>' + (S.strava ? '' : '<button type="button" class="row-link quiet" data-do="stravasw">Mám v Claude konektor Strava</button>') + '</div>';
  }
  // Tichý řádek dole v Plánu: appka nevidí konektory v Claude, tak tlačítka Stravy jdou zapnout a vypnout tady.
  // Zapnou se i sama po prvním hodnocení běhu ze Stravy.
  function stravaLine() {
    return '<p class="setting">Tlačítka Stravy ' + (S.strava ? 'zapnutá' : 'vypnutá') + ' · <button type="button" data-do="stravasw">' + (S.strava ? 'Vypnout' : 'Zapnout') + '</button></p>';
  }
  function renderForm() {
    if (!S.manual) return renderChoice();
    var f = S.form || (S.form = defaults());
    var h = '<header class="hd line"><h1>Sestavit plán</h1><button type="button" class="tb" data-do="choice">Zpět</button></header><div class="form">';
    h += '<div class="f"><span class="lab">Cíl</span>' + seg('intent', [['race', 'Závod'], ['improve', 'Zlepšit se'], ['maintain', 'Udržet']], f.intent) + '</div>';
    if (f.intent === 'race') {
      h += '<div class="f"><span class="lab">Závod</span>' + seg('dist', RACES, f.dist, 'n') + '<input class="in n gap" type="date" data-f="race" value="' + esc(f.race) + '" aria-label="Datum závodu" min="' + addDays(todayIso(), 14) + '"></div>';
    } else {
      h += '<div class="f"><span class="lab">Délka</span>' + seg('weeks', [[6, '6 týdnů'], [8, '8'], [12, '12'], [16, '16']], f.weeks, 'n') + '</div>';
    }
    h += '<div class="f"><span class="lab">Teď běhám týdně</span><div class="step"><button type="button" data-do="km" data-v="-5" aria-label="Ubrat">−</button><output class="n">' + f.km + ' <small>km</small></output><button type="button" data-do="km" data-v="5" aria-label="Přidat">+</button></div><p class="hint">Průměr posledních čtyř týdnů. Od něj plán roste.</p></div>';
    h += '<div class="f"><span class="lab">Běhů týdně</span>' + seg('runs', [[3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']], f.runs, 'n') + '</div>';
    h += '<div class="f"><span class="lab">Dlouhý běh</span><div class="seg wk7">' + DOW.map(function (x, i) { return '<button type="button" data-f="long" data-v="' + i + '"' + (f.long === i ? ' class="on"' : '') + '>' + x + '</button>'; }).join('') + '</div></div>';
    h += '<div class="f"><span class="lab">Volné dny</span><div class="seg wk7">' + DOW.map(function (x, i) { return '<button type="button" data-do="rest" data-v="' + i + '"' + (f.rest.indexOf(i) >= 0 ? ' class="on"' : '') + (i === f.long ? ' disabled' : '') + '>' + x + '</button>'; }).join('') + '</div></div>';
    h += '<div class="f"><span class="lab">Začátek</span><input class="in n" type="date" data-f="start" value="' + esc(f.start) + '" aria-label="Začátek plánu"></div>';
    if (f.err) h += '<p class="err">' + esc(f.err) + '</p>';
    h += '</div><div class="sticky"><button type="button" class="btn go accent" data-do="draft">Sestavit náhled</button></div>';
    return h;
  }
  function draft() {
    var f = S.form;
    f.err = null;
    if (f.intent === 'race' && !f.race) { f.err = 'Vyplň datum závodu.'; render(); return; }
    if (7 - f.rest.length < f.runs) { f.err = 'Na ' + f.runs + ' běhů zbývá málo dní. Uber volné dny.'; render(); return; }
    var label = RACES.filter(function (r) { return r[0] === f.dist; })[0];
    var args = { name: f.intent === 'race' ? 'Závod ' + label[1] + (label[0] > 10000 ? ' km' : '') + ', ' + dm(f.race) : f.intent === 'improve' ? 'Zlepšení' : 'Udržení', intent: f.intent, weeklyKm: f.km, runsPerWeek: f.runs, restDows: f.rest, longRunDow: f.long, startDate: f.start };
    if (f.intent === 'race') { args.raceDate = f.race; args.raceDistanceM = f.dist; } else args.weeks = +f.weeks;
    S.fromForm = true;
    act('draft_plan', args);
  }

  // ---------- Rozpracovaný plán ----------
  // Kontrola plánu před zařazením. U plánu z PDF je tohle místo, kde se chyba přepisu najde:
  // týden jde rozkliknout a přepis každého dne stojí vedle doslovného znění z dokumentu.
  function stagedMode(d) { return S.amode || (d.suggest && d.suggest.mode) || 'start'; }
  function stagedDate(d) { return S.adate != null ? S.adate : stagedMode(d) === 'race' ? '' : nextMonday(); }
  function weekDetail(w) {
    var rest = [], h = '<ul class="sd">';
    w.days.forEach(function (x) {
      if (x.type === 'rest') { rest.push(x.day); return; }
      var what = x.lines && x.lines.length ? x.lines.join(' · ') : x.summary;
      h += '<li><span class="dw">' + x.day + '</span><div><p class="t"><b>' + badge(x.type) + esc(x.title) + '</b><span class="n">' + (x.kmMax ? num(x.kmMax) + ' km' : '') + (x.kmUnknown ? ' +' : '') + '</span></p>';
      if (what && what !== x.title) h += '<p>' + esc(what) + '</p>';
      if (x.raw) h += '<p class="raw">Dokument: ' + esc(x.raw.replace(/\s*\n\s*/g, ' ')) + '</p>';
      x.fixes.forEach(function (t) { h += '<p class="fix">Opraveno: ' + esc(t) + '</p>'; });
      x.issues.forEach(function (t) { h += '<p class="iss">' + esc(t) + '</p>'; });
      h += '</div></li>';
    });
    if (rest.length) h += '<li class="rest"><span class="dw"></span><div><p>Volno: ' + rest.join(', ') + '</p></div></li>';
    return h + '</ul>';
  }
  function renderStaged() {
    var d = S.staged, peak = 0;
    d.weeks.forEach(function (w) { peak = Math.max(peak, w.kmMax); });
    var a = d.activate, mode = stagedMode(d);
    var h = '<header class="hd"><h1>' + esc(d.name) + '</h1><button type="button" class="tb" data-do="' + (S.fromForm ? 'new' : 'cancel') + '">' + (S.fromForm ? 'Upravit' : 'Zpět') + '</button></header>';
    h += '<p class="meta"><b>' + d.weeks.length + '</b> týdnů · vrchol <b>' + Math.round(peak) + '</b> km<span>ke kontrole</span></p>';
    var off = d.weeks.filter(function (w) { return w.totals === 'off'; }).map(function (w) { return w.index; });
    var flagged = d.weeks.filter(function (w) { return w.issues.length; }).map(function (w) { return w.index; });
    var lines = [];
    if (d.missing.length) lines.push('<b>Chybí týden ' + d.missing.join(', ') + '.</b>');
    if (off.length) lines.push('<b>Součet nesedí s dokumentem:</b> týden ' + off.join(', ') + '.');
    if (flagged.length) lines.push('<b>K ověření:</b> týden ' + flagged.join(', ') + '.');
    if (d.fixes) lines.push('Opraveno automaticky: ' + d.fixes + '×.');
    if (!S.fromForm) lines.push('Klepni na týden a porovnej přepis se zněním z dokumentu.');
    h += '<div class="warn">' + lines.join('<br>') + '</div>';
    h += matrix(d.weeks, { stage: true });
    if (!a) {
      h += '<div class="form"><div class="f"><span class="lab">Zařadit</span>' + seg('amode', [['race', 'Závod v den'], ['start', 'Začít týdnem od']], mode) + '<input class="in n gap" type="date" data-f="adate" value="' + esc(stagedDate(d)) + '" aria-label="' + (mode === 'race' ? 'Datum závodu' : 'Začátek plánu') + '">';
      h += '<p class="hint">' + (mode === 'race' ? 'Poslední týden plánu bude ten se závodem.' : 'Plán začne pondělím týdne s tímto dnem.') + '</p></div></div>';
    }
    return h + '<div class="sticky"><button type="button" class="btn go accent" data-do="activate"' + (d.missing.length ? ' disabled' : '') + '>Zařadit do kalendáře</button></div>';
  }

  // ---------- Tempa ----------
  function renderPaces() {
    var d = S.calc || S.paces;
    var h = '<header class="hd"><h1>Tempa</h1></header>';
    if (S.calc) h += '<p class="meta">' + RACES.filter(function (r) { return r[0] === S.calc.calc.distanceM; }).map(function (r) { return r[1]; })[0] + ' za ' + hms(S.calc.calc.timeSec) + '<span>VDOT ' + num(S.calc.calc.vdot) + '</span></p>';
    // Cílový čas: tempa se přepočítají podle tabulky z plánu (jen v jejím rozsahu), bez ní podle VDOT.
    var goal = !S.calc && S.paces && S.paces.goal;
    if (goal) {
      var gs = S.goalSec != null ? S.goalSec : goal.sec, dist = RACES.filter(function (r) { return Math.abs(r[0] - goal.distanceM) < 200; })[0];
      var method = S.goalMethod || goal.source, st = goalStep(gs), methods = goal.methods || [goal.source];
      h += '<div class="goal">';
      // Zdroj temp: tabulka autora plánu, nebo VDOT. Přepínač jen když jde obojí.
      if (methods.length > 1) h += '<div class="f0"><span class="lab">Odkud brát tempa</span>' + seg('gmethod', [['table', 'Tabulka z plánu'], ['vdot', 'Z cílového času']], method) + '</div>';
      h += '<span class="lab">Cílový čas' + (dist ? ' na ' + dist[1] + (dist[0] > 10000 ? ' km' : '') : '') + '</span>';
      // Krok je vidět na tlačítkách a popisky pod nimi říkají směr: kratší čas = rychlejší tempa.
      h += '<div class="step goalstep"><button type="button" data-do="goal" data-v="' + -st + '" aria-label="Rychleji o ' + stepWord(st) + '"' + (gs <= goal.minSec ? ' disabled' : '') + '><b>−' + stepWord(st) + '</b><small>rychleji</small></button>';
      h += '<output class="n" aria-live="polite">' + hms(gs) + (goal.distanceM ? '<small>' + pace(gs / (goal.distanceM / 1000)) + ' /km</small>' : '') + '</output>';
      h += '<button type="button" data-do="goal" data-v="' + st + '" aria-label="Pomaleji o ' + stepWord(st) + '"' + (gs >= goal.maxSec ? ' disabled' : '') + '><b>+' + stepWord(st) + '</b><small>pomaleji</small></button></div>';
      var how = method === 'table'
        ? 'Tempa jsou z tabulky, kterou trenér dal do plánu. Cíl jde nastavit od ' + hms(goal.minSec) + ' do ' + hms(goal.maxSec) + '.'
        : 'Tempa se spočítají z cílového času, jako v běžecké kalkulačce. Cíl jde nastavit od ' + hms(goal.minSec) + ' do ' + hms(goal.maxSec) + '.';
      h += '<p class="hint" aria-live="polite">' + (S.goalBusy ? 'Přepočítávám tempa…' : how) + '</p></div>';
    }
    if (!d || !d.paces || !d.paces.length) h += '<p class="blank">Tempa zatím nejsou. Spočítej je z čerstvého závodu.</p>';
    else {
      // Všechna tempa na jedné ose: vlevo pomaleji, vpravo rychleji. Na první pohled je vidět, jak daleko je volný běh od závodního.
      var slow = 0, fast = 1e9;
      d.paces.forEach(function (p) { slow = Math.max(slow, p.toSec); fast = Math.min(fast, p.fromSec); });
      var span = Math.max(1, slow - fast);
      h += '<ul class="pz' + (S.goalBusy ? ' stale' : '') + '">' + d.paces.slice().sort(function (a, b) { return b.toSec - a.toSec; }).map(function (p) {
        var lvl = INT_LVL[p.key] == null ? 1 : INT_LVL[p.key];
        var left = Math.round((slow - p.toSec) / span * 92), width = Math.max(4, Math.round((p.toSec - p.fromSec) / span * 92));
        return '<li><span class="bd e' + lvl + '">' + ico(PACE_IC[p.key] || 'easy') + '</span><span class="lb">' + esc(p.label.charAt(0).toUpperCase() + p.label.slice(1)) + '</span><span class="pv">' + pace(p.fromSec) + '–' + pace(p.toSec) + '<small> /km</small></span><span class="sc"><i class="e' + lvl + '" data-lpct="' + left + '" data-wpct="' + width + '"></i></span></li>';
      }).join('') + '</ul><p class="axis"><span>pomaleji</span><span>rychleji</span></p>';
    }
    var c = S.calcForm || (S.calcForm = { dist: 21097.5, time: '', open: false });
    if (S.calc) return h + '<div class="sticky"><button type="button" class="btn" data-do="calcback">Zpět</button><button type="button" class="btn go accent" data-do="calcsave">Uložit tempa</button></div>';
    if (goal) return h;
    if (!c.open && d && d.paces && d.paces.length) return h + '<button type="button" class="row-link" data-do="calcopen">Přepočítat z čerstvého závodu</button>';
    h += '<div class="form"><div class="f"><span class="lab">Čerstvý závod</span>' + seg('cdist', RACES, c.dist, 'n') + '<input class="in n gap" inputmode="numeric" placeholder="čas, např. 1:32:00" data-f="ctime" value="' + esc(c.time) + '" aria-label="Čas"></div></div>';
    return h + '<div class="sticky"><button type="button" class="btn go" data-do="calc">Spočítat tempa</button></div>';
  }
  // Krok cílového času podle délky závodu: u pětky po 10 s, u maratonu po minutě.
  function goalStep(sec) { return sec < 1800 ? 10 : sec < 3600 ? 15 : sec < 2 * 3600 ? 30 : 60; }
  function stepWord(s) { return s < 60 ? s + ' s' : s / 60 + ' min'; }
  function hms(s) { var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
  function parseTime(t) {
    var p = String(t).trim().split(':').map(Number);
    if (p.some(isNaN) || !p.length) return null;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
  }

  // ---------- Vykreslení ----------
  // Šířky a poměry přes CSSOM, ne atributem style (přísná CSP).
  function sizes(root) {
    root.querySelectorAll('[data-g]').forEach(function (el) { el.style.flexGrow = el.getAttribute('data-g'); });
    root.querySelectorAll('[data-wpct]').forEach(function (el) { el.style.width = el.getAttribute('data-wpct') + '%'; });
    root.querySelectorAll('[data-lpct]').forEach(function (el) { el.style.marginLeft = el.getAttribute('data-lpct') + '%'; });
  }
  function render() {
    view.innerHTML = S.tab === 'week' ? renderWeek() : S.tab === 'plan' ? renderPlan() : renderPaces();
    sizes(view);
    S.pop = null;
    if (S.tab === 'week') prefetch();
    document.querySelectorAll('.bar [data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === S.tab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      // Tečka u Plánu: čeká rozpracovaný plán ke schválení.
      if (b.getAttribute('data-tab') === 'plan') b.classList.toggle('dot', !!(S.week && S.week.staged));
    });
  }

  // ---------- Události ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-do],[data-f],[data-tab]');
    if (!t || t.disabled) return;
    var id = t.getAttribute('data-id'), v = t.getAttribute('data-v');
    if (t.hasAttribute('data-tab')) { var tab = t.getAttribute('data-tab'); S.sub = null; window.scrollTo(0, 0); S.tab = tab; render(); load(tab); return; }
    if (t.hasAttribute('data-f') && t.tagName === 'BUTTON') {
      var f = t.getAttribute('data-f');
      if (f === 'cdist') S.calcForm.dist = +v;
      else if (f === 'amode') S.amode = v;
      else if (f === 'gmethod') { if (v !== (S.goalMethod || S.paces.goal.source)) saveGoal(v); return; }
      else S.form[f] = f === 'intent' ? v : +v;
      if (f === 'long') S.form.rest = S.form.rest.filter(function (x) { return x !== +v; });
      render(); return;
    }
    switch (t.getAttribute('data-do')) {
      case 'open': S.open = (S.open == null ? autoOpen(S.week) : S.open) === id ? '' : id; render(); break;
      case 'prev': goWeek(-1); break;
      case 'install': if (S.install) { S.install.prompt(); S.install.userChoice.then(function () { S.install = null; render(); }); } break;
      case 'noinstall': try { localStorage.setItem('rpm.noInstall', '1'); } catch (x) { /* nic */ } render(); break;
      case 'next': goWeek(1); break;
      case 'done': S.open = id; S.pop = id; act('set_status', { workoutId: id, status: 'completed' }, 'Odběhnuto. Dobrá práce!', true); break;
      case 'unset': act('set_status', { workoutId: id, status: 'scheduled' }, 'Zápis zrušen', true); break;
      case 'restore': act('restore_workout', { workoutId: id, reason: '' }, 'Obnoveno', true); break;
      case 'eval': var ew = findW(id)[0]; toClaude('Zhodnoť můj běh „' + ew.title + '“ z ' + dm(ew.date) + ' podle Stravy (konektor RPM, show_result) a zapiš ho.'); break;
      case 'close': closeSheet(); break;
      case 'partial': closeSheet(); S.open = id; act('set_status', { workoutId: id, status: 'partial' }, 'Zapsáno jako částečně', true); break;
      case 'skip': closeSheet(); act('skip_workout', { workoutId: id, reason: '' }, 'Vynecháno', true); break;
      case 'move': moveMenu(id); break;
      case 'moveto': closeSheet(); act('move_workout', { workoutId: id, toDate: v, reason: '' }, 'Přesunuto na ' + DOW[(new Date(v + 'T12:00:00Z').getUTCDay() + 6) % 7], true); break;
      case 'fit': closeSheet(); call('export_garmin', { workoutId: id }).then(function (d) { if (d.url) location.href = d.url; else toast('Soubor se nepovedlo připravit.'); }, fail); break;
      case 'tab': S.tab = v; S.sub = 'new'; S.manual = false; window.scrollTo(0, 0); render(); break;
      case 'showplan': S.sub = null; window.scrollTo(0, 0); load('plan'); break;
      case 'week': S.open = null; window.scrollTo(0, 0); load('week', { date: v }); break;
      case 'new': S.sub = 'new'; window.scrollTo(0, 0); render(); break;
      case 'cancel': S.sub = null; S.fromForm = false; render(); break;
      case 'staged': call('show_week', { tab: 'staged' }).then(function (d) { S.fromForm = false; take(d); render(); }, fail); break;
      case 'km': S.form.km = Math.min(200, Math.max(10, S.form.km + +v)); render(); break;
      case 'rest': var r = S.form.rest, i = r.indexOf(+v); if (i >= 0) r.splice(i, 1); else r.push(+v); render(); break;
      case 'draft': draft(); break;
      case 'doc': toClaude('Přikládám svůj tréninkový plán. Přepiš ho přes konektor RPM do rozpracovaného importu (import_plan_weeks): když je v dokumentu verze v mílích i v km, vezmi jen kilometrovou, a týdny, kde nesedí součet, oprav podle dokumentu. Do kalendáře ho nezařazuj, zkontroluju ho v appce RPM.'); break;
      case 'strava': toClaude('Postav mi nový běžecký plán podle mé Stravy. Postupuj podle instrukcí RPM pro nový plán: načti profil a historii, projdi Stravu za posledních 8–12 týdnů, zeptej se jen na to, co chybí, a kostru nech v rozpracovaném importu; zkontroluju ji v appce RPM.'); break;
      case 'stravasw':
        var was = S.strava;
        S.strava = !S.strava; render();
        call('set_profile', { strava: S.strava }).then(function () { toast(S.strava ? 'Tlačítka Stravy zapnutá' : 'Tlačítka Stravy schovaná'); }, function (err) { S.strava = was; fail(err); });
        break;
      case 'manual': S.manual = true; window.scrollTo(0, 0); render(); break;
      case 'choice': S.manual = false; window.scrollTo(0, 0); render(); break;
      case 'sweek': S.sweek = S.sweek === +v ? null : +v; render(); break;
      case 'activate':
        var date = stagedDate(S.staged);
        if (!S.staged.activate && !date) { toast('Vyber datum závodu.'); break; }
        var a = S.staged.activate || { mode: stagedMode(S.staged), date: date };
        act('activate_plan', a, 'Plán je v kalendáři').then(function (d) { if (d && d.view === 'plan') { S.sub = null; S.staged = null; S.fromForm = false; S.form = null; S.manual = false; S.amode = S.adate = S.sweek = null; weeks = {}; if (S.week) S.week.staged = null; render(); } });
        break;
      case 'calc':
        var sec = parseTime(S.calcForm.time);
        if (!sec) { toast('Zadej čas jako 1:32:00 nebo 42:30.'); break; }
        call('calculate_paces', { distanceM: S.calcForm.dist, timeSec: sec }).then(function (d) { S.calc = d; render(); }, fail);
        break;
      case 'goal':
        var go = S.paces.goal, cur = S.goalSec != null ? S.goalSec : go.sec;
        S.goalSec = Math.min(go.maxSec, Math.max(go.minSec, cur + +v));
        // Tempa pod tím ztlumená, dokud se nepřepočítají: je vidět, že změna teprve dorazí.
        S.goalBusy = true;
        render();
        // Klepání za sebou se uloží jednou, až prst přestane.
        clearTimeout(S.goalTimer);
        S.goalTimer = setTimeout(function () { saveGoal(); }, 500);
        break;
      case 'calcback': S.calc = null; render(); break;
      case 'calcopen': S.calcForm.open = true; render(); break;
      case 'calcsave': call('calculate_paces', { distanceM: S.calc.calc.distanceM, timeSec: S.calc.calc.timeSec, save: true }).then(function () { S.calc = null; toast('Tempa uložena'); load('paces'); }, fail); break;
    }
  });
  // Uloží cílový čas (a případně zdroj temp); server vrátí přepočítaná tempa.
  function saveGoal(method) {
    var go = S.paces && S.paces.goal;
    if (!go) return;
    clearTimeout(S.goalTimer);
    var want = S.goalSec != null ? S.goalSec : go.sec, args = { goalSec: want };
    if (method) { args.method = method; S.goalMethod = method; }
    S.goalBusy = true; render();
    call('set_goal_time', args).then(function (d) {
      weeks = {};
      if (S.goalSec === want || method) { S.goalSec = null; S.goalBusy = false; S.goalMethod = null; }
      take(d); render();
      if (method) toast(method === 'vdot' ? 'Tempa spočítaná z cílového času' : 'Tempa z tabulky v plánu');
    }, function (err) { S.goalBusy = false; S.goalMethod = null; S.goalSec = null; fail(err); });
  }
  document.addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'ctime') S.calcForm.time = e.target.value;
    else if (f === 'adate') S.adate = e.target.value;
    else S.form[f] = e.target.value;
  });
  document.addEventListener('input', function (e) { if (e.target.getAttribute('data-f') === 'ctime') S.calcForm.time = e.target.value; });
  $('#claude').addEventListener('click', function () { toClaude('Podívej se přes konektor RPM na můj aktuální týden.'); });

  // Týden gestem do stran: dny jdou za prstem a vedle nich jede sousední týden (načtený předem),
  // takže při listování není prázdno. Bez dalšího týdne dny kladou odpor; po puštění dojedou, nebo se vrátí.
  var EASE = 'cubic-bezier(.2, .8, .2, 1)', OUT_MS = 260, BACK_MS = 200, busy = false, g = null;
  function slide(el, x, ms, opacity) {
    el.style.transition = ms ? 'transform ' + ms + 'ms ' + EASE + ', opacity ' + ms + 'ms ' + EASE : 'none';
    el.style.transform = x ? 'translateX(' + x + 'px)' : '';
    el.style.opacity = opacity == null ? '' : opacity;
  }
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  // Nový týden přijede z druhé strany kousek a dobarví se (jen když nebyl načtený předem).
  function slideIn(dir) {
    var el = view.querySelector('.days');
    if (!el || reduced()) return;
    slide(el, dir * 56, 0, 0);
    void el.offsetWidth;
    slide(el, 0, 240, 1);
  }
  function hasWeek(dir) { var w = S.week; return !!(w && w.view === 'week' && (dir > 0 ? w.hasNext : w.hasPrev)); }
  // Kopie dnů sousedního týdne, položená vedle aktuálních.
  function ghostFor(dir) {
    var el = view.querySelector('.days'), d = S.week && weeks[addDays(S.week.weekStart, dir * 7)];
    if (!el || !d) return null;
    var wrap = document.createElement('div');
    wrap.innerHTML = daysHtml(d, null);
    var gh = wrap.firstChild;
    gh.classList.add('ghost');
    gh.setAttribute('aria-hidden', 'true');
    gh.style.top = el.offsetTop + 'px';
    view.appendChild(gh);
    sizes(gh);
    return gh;
  }
  function goWeek(dir, gh, ms) {
    ms = ms || OUT_MS;
    var el = view.querySelector('.days');
    if (busy || !hasWeek(dir)) { if (el) slide(el, 0, BACK_MS); if (gh) slide(gh, dir * (el ? el.clientWidth : 0), BACK_MS); setTimeout(function () { if (gh) gh.remove(); }, BACK_MS); return; }
    busy = true; S.open = null;
    var key = addDays(S.week.weekStart, dir * 7), cached = weeks[key];
    var show = function (d) { take(d); render(); busy = false; };
    if (cached) {
      if (!el || reduced()) { if (gh) gh.remove(); show(cached); }
      else {
        if (!gh) { gh = ghostFor(dir); slide(gh, dir * el.clientWidth, 0); void gh.offsetWidth; }
        slide(el, -dir * el.clientWidth, ms);
        slide(gh, 0, ms);
        setTimeout(function () { show(cached); }, ms);
      }
      // Na pozadí ověří, že se týden mezitím nezměnil jinde (Claude, druhé zařízení).
      call('show_week', { date: key }).then(function (d) {
        if (d.view === 'week' && S.week && S.week.weekStart === key && JSON.stringify(d.days) !== JSON.stringify(S.week.days)) { take(d); if (S.tab === 'week' && !busy) render(); }
      }, function () { /* offline: zůstane uložená verze */ });
      return;
    }
    if (gh) gh.remove();
    var data = call('show_week', { date: key });
    var out = new Promise(function (ok) {
      if (!el || reduced()) return ok();
      slide(el, -dir * el.clientWidth, ms, 0); setTimeout(ok, ms);
    });
    Promise.all([data, out]).then(function (r) { take(r[0]); render(); slideIn(dir); }, fail).then(function () { busy = false; });
  }
  view.addEventListener('touchstart', function (e) {
    g = null;
    if (busy || S.tab !== 'week' || !S.week || S.week.view !== 'week' || e.touches.length !== 1) return;
    var t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, dx: 0, raw: 0, v: 0, lt: e.timeStamp, el: view.querySelector('.days'), ghost: null, gdir: 0 };
  }, { passive: true });
  view.addEventListener('touchmove', function (e) {
    if (!g || !g.el) return;
    var t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    if (g.axis !== 'x') return;
    e.preventDefault();
    var dir = dx < 0 ? 1 : -1;
    // Rychlost prstu z posledních pohybů, ne průměr za celé gesto: švih na konci se počítá.
    var dt = e.timeStamp - g.lt;
    if (dt > 0) { g.v = 0.6 * ((dx - g.raw) / dt) + 0.4 * g.v; g.raw = dx; g.lt = e.timeStamp; }
    g.dx = hasWeek(dir) ? dx : dx * 0.2;
    if (g.gdir !== dir) { if (g.ghost) g.ghost.remove(); g.ghost = hasWeek(dir) ? ghostFor(dir) : null; g.gdir = dir; }
    slide(g.el, g.dx, 0);
    if (g.ghost) slide(g.ghost, dir * g.el.clientWidth + g.dx, 0);
  }, { passive: false });
  function swipeEnd(e) {
    var s = g; g = null;
    if (!s || s.axis !== 'x' || !s.el) return;
    var dir = s.dx < 0 ? 1 : -1, v = e.timeStamp - s.lt > 80 ? 0 : s.v;
    // Rychlost ve směru tahu; švih opačným směrem gesto zruší.
    var speed = -dir * v;
    var gh = s.gdir === dir ? s.ghost : null;
    if ((Math.abs(s.dx) > s.el.clientWidth * 0.25 && speed > -0.11) || (speed > 0.11 && Math.abs(s.dx) > 16)) {
      // Týden dojede tak rychle, jak byl hozený: zbývající dráha / rychlost, mezi 120 a 260 ms.
      var rest = s.el.clientWidth - Math.abs(s.dx);
      goWeek(dir, gh, Math.round(Math.max(120, Math.min(OUT_MS, rest / Math.max(speed, rest / OUT_MS)))));
    }
    else {
      slide(s.el, 0, BACK_MS);
      if (gh) { slide(gh, dir * s.el.clientWidth, BACK_MS); setTimeout(function () { gh.remove(); }, BACK_MS); }
    }
  }
  view.addEventListener('touchend', swipeEnd);
  view.addEventListener('touchcancel', swipeEnd);

  // ---------- Bez klíče ----------
  function setup(msg) {
    view.innerHTML = '<div class="setup">' + ROUTE_ART + '<h1>Připoj svůj plán</h1><p>' + esc(msg || 'Vlož adresu konektoru z úvodní stránky. Zůstane jen v tomhle prohlížeči.') + '</p><form id="kf"><input class="in n" id="ki" placeholder="https://…/mcp/…" autocomplete="off" aria-label="Adresa konektoru"><div class="acts"><button class="btn go accent">Připojit</button></div></form></div>';
    $('#kf').addEventListener('submit', function (e) {
      e.preventDefault();
      var m = $('#ki').value.trim().match(/([\w-]{20,})\/?$/);
      if (!m) return;
      key = m[1];
      try { localStorage.setItem('rt.connectorKey', key); } catch (x) { /* nic */ }
      start();
    });
  }
  function start() {
    view.innerHTML = '<p class="blank">Načítám…</p>';
    // Tempa jsou malá a rozpis dne je potřebuje pro volné běhy bez rozpisu.
    Promise.all([call('show_week', {}), call('show_week', { tab: 'paces' }).catch(function () { return null; })]).then(function (r) {
      if (r[1]) take(r[1]);
      take(r[0]);
      // Přehled plánu na pozadí: první klepnutí na Plán ho ukáže hned.
      if (r[0].view === 'week' || r[0].view === 'finished') call('show_week', { tab: 'plan' }).then(function (d) { if (d.view === 'plan' && !S.plan) { S.plan = d; if (S.tab === 'plan' && !S.sub) render(); } }, function () { /* načte se při otevření */ });
      // Poslední týden a tempa pro start bez signálu (třeba na trati).
      try { localStorage.setItem(CACHE_KEY, JSON.stringify([r[0], r[1]])); } catch (e) { /* plné úložiště */ }
      if (firstTab === 'new') { S.tab = 'plan'; S.sub = 'new'; } else if (firstTab && firstTab !== 'week') return load(firstTab);
      if (r[0].view === 'empty') { S.tab = 'plan'; S.sub = r[0].staged ? null : 'new'; if (r[0].staged) return call('show_week', { tab: 'staged' }).then(take); }
    }).then(render, function (err) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { /* nic */ }
      // Jen při výpadku sítě (fetch hodí TypeError), ne při neplatné adrese nebo chybě serveru.
      if (!cached || !cached[0] || (navigator.onLine !== false && !(err instanceof TypeError))) return fail(err);
      if (cached[1]) take(cached[1]);
      take(cached[0]); render();
      toast('Jsi offline. Ukazuju naposledy načtený týden.');
    });
  }
  var CACHE_KEY = 'rpm.lastWeek';
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.install = e; if (S.tab === 'week') render(); });
  window.addEventListener('appinstalled', function () { S.install = null; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* bez offline startu */ });
  if (key) start(); else setup();
})();
