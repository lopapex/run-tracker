// RPM: obyčejná stránka nad /mcp/<klíč>. Tři záložky: Týden (co běžet dnes a jak rychle), Plán (blok jako matice, založení a schválení plánu), Tempa.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view'), sheet = $('#sheet'), toastEl = $('#toast');
  var DOW = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
  var TYPE_LVL = { easy: 1, other: 1, long: 2, tempo: 3, speed: 4, race: 5, strength: 0, cross: 0 };
  var INT_LVL = { walk: 0, easy: 1, free: 1, steady: 2, mp: 2, hm_pace: 3, '10k_pace': 4, '5k_pace': 4, strides: 4 };
  var RACES = [[5000, '5 km'], [10000, '10 km'], [21097.5, '21,1'], [42195, '42,2']];

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
  function toast(text, undo) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button" data-undo>Vrátit</button>' : '');
    toastEl.hidden = false;
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, undo ? 6000 : 3000);
  }
  toastEl.addEventListener('click', function (e) {
    if (!e.target.closest('[data-undo]')) return;
    toastEl.hidden = true;
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
    if (d.view === 'week') { S.week = d; weeks[d.weekStart] = d; }
    else if (d.view === 'plan') S.plan = d;
    else if (d.view === 'paces') { if (d.calc) S.calc = d; else { S.paces = d; S.calc = null; } }
    else if (d.view === 'import') { S.staged = d; S.sub = 'staged'; S.tab = 'plan'; }
    else if (d.view === 'empty' || d.view === 'finished') { S.week = d; S.plan = d; if (S.tab === 'plan' && !S.sub) S.sub = 'new'; }
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
    if (w.status === 'skipped') {
      h += '<p class="state">Vynecháno' + (w.skipReason ? ': ' + esc(w.skipReason) : '') + '</p><div class="links">' + link('restore', id, 'Obnovit') + '</div>';
    } else if (w.status === 'completed' || w.status === 'partial') {
      if (w.status === 'partial') h += '<p class="state">Odběhnuto jen částečně</p>';
      h += '<div class="links">' + link('eval', id, 'Zhodnotit se Stravou', 'ext') + (w.status === 'completed' ? link('partial', id, 'Jen část') : '') + link('unset', id, 'Zrušit') + '</div>';
    } else {
      if (day.isPast || day.isToday) h += '<div class="acts sm"><button type="button" class="btn go' + (day.isToday ? ' accent' : '') + '" data-do="done" data-id="' + id + '">Odběhnuto</button></div>';
      h += '<div class="links">' + link('move', id, 'Přesunout') + link('skip', id, 'Vynechat') + link('fit', id, 'Do hodinek') + '</div>';
    }
    return h + '</div>';
  }
  function renderWeek() {
    var d = S.week;
    if (!d || d.view !== 'week') return emptyHint();
    var st = d.stats;
    var m = d.label.match(/týden (\d+) z (\d+)/);
    var h = '<header class="hd"><h1>' + (m ? 'Týden ' + m[1] + '<span class="n"> z ' + m[2] + '</span>' : esc(d.label.charAt(0).toUpperCase() + d.label.slice(1))) + '</h1>';
    h += '<div class="nav"><button type="button" data-do="prev" aria-label="Předchozí týden"' + (d.hasPrev ? '' : ' disabled') + '>‹</button><button type="button" data-do="next" aria-label="Další týden"' + (d.hasNext ? '' : ' disabled') + '>›</button></div></header>';
    h += '<p class="meta"><b>' + num(st.doneKm) + '</b> z ' + Math.round(st.plannedKmMax) + ' km' + (d.isCurrent && d.daysToRace != null ? '<span>závod za ' + d.daysToRace + ' dní</span>' : d.phase ? '<span>' + esc(d.phase.toLowerCase()) + '</span>' : '') + '<span class="prog"><i data-wpct="' + Math.min(100, Math.round(st.doneKm / Math.max(1, st.plannedKmMax) * 100)) + '"></i></span></p>';
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
        h += '<li class="day rest' + (day.isToday ? ' today' : '') + '"><div class="hit">' + dw(day) + '<span class="nm">Volno</span><span class="km"></span><span class="st"></span></div></li>';
        return;
      }
      list.forEach(function (w, i) {
        var s = stOf(w, day), open = auto === w.id;
        h += '<li class="day' + (day.isToday ? ' today' : '') + (s === 'done' ? ' done' : '') + (s === 'skipped' ? ' off' : '') + '">';
        h += '<button type="button" class="hit" data-do="open" data-id="' + w.id + '" aria-expanded="' + open + '">' + (i === 0 ? dw(day) : '<span class="dw"></span>');
        h += '<span class="nm">' + esc(w.title) + (w.moved ? ' <small>přesunuto</small>' : '') + '</span><span class="km">' + kmOf(w) + '</span><span class="st ' + s + '" aria-label="' + ({ done: 'hotovo', partial: 'částečně', skipped: 'vynecháno', missed: 'nezapsáno' }[s] || 'naplánováno') + '"></span>' + profile(w, max) + '</button>';
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
  function emptyHint() {
    return '<div class="blank"><p>Zatím nemáš plán.</p><p><button type="button" class="btn go accent" data-do="tab" data-v="plan">Založit plán</button></p></div>';
  }

  // ---------- Přesun jednotky ----------
  function moveMenu(id) {
    var x = findW(id), w = x[0], start = S.week.weekStart;
    var h = '<div class="back" data-do="close"></div><section class="panel" role="dialog" aria-label="Přesunout"><h2>Přesunout ' + esc(w.title) + ' <button type="button" data-do="close">Zavřít</button></h2><div class="seg n wk7">';
    for (var i = 0; i < 7; i++) {
      var date = addDays(start, i);
      h += '<button type="button" data-do="moveto" data-id="' + id + '" data-v="' + date + '"' + (date === w.date ? ' class="on" disabled' : '') + '>' + DOW[i] + '</button>';
    }
    openSheet(h + '</div><p class="hint">Když je v cílovém dni jiný běh, prohodí se.</p></section>');
  }
  function openSheet(html) { sheet.innerHTML = html; sheet.hidden = false; }
  function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; }

  // ---------- Plán ----------
  function cell(c, today) {
    if (!c) return '<span class="c rest"></span>';
    return '<span class="c e' + lvlOfType(c[0]) + ' s-' + c[1] + (today ? ' today' : '') + '"></span>';
  }
  function matrix(weeks, opts) {
    var h = '<table class="mx"><thead><tr><th></th>' + DOW.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '<th class="vol">km</th></tr></thead><tbody>';
    var phase = null, today = todayIso();
    weeks.forEach(function (w) {
      var ph = (w.phase || '').toLowerCase();
      if (ph && ph !== phase) h += '<tr class="ph"><td colspan="9">' + esc(ph) + '</td></tr>';
      phase = ph || phase;
      var flag = opts.stage && (w.issues.length || w.totals === 'off'), open = opts.stage && S.sweek === w.index;
      var cls = 'w' + (w.isCurrent ? ' cur' : '') + (w.isPast ? ' past' : '') + (flag ? ' flag' : '') + (open ? ' open' : '');
      var target = opts.link ? ' data-do="week" data-v="' + w.weekStart + '"' : opts.stage ? ' data-do="sweek" data-v="' + w.index + '" aria-expanded="' + open + '"' : '';
      h += '<tr class="' + cls + '"' + target + '><td class="wk">' + (w.sourceWeek != null ? w.sourceWeek : w.index != null ? w.index : '–') + '</td>';
      w.cells.forEach(function (c, i) { h += '<td>' + cell(c, opts.link && w.weekStart && addDays(w.weekStart, i) === today) + '</td>'; });
      var plannedKm = w.plannedKmMax != null ? w.plannedKmMax : w.kmMax, vol;
      if (opts.link && (w.isPast || w.isCurrent)) vol = num(w.doneKm) + '<span class="mute"> / ' + Math.round(plannedKm) + '</span>';
      // Při kontrole součet přepisu vedle součtu, který uvádí autor plánu.
      else if (opts.stage && w.declaredKm != null) vol = '<span' + (w.totals === 'off' ? ' class="bad"' : '') + '>' + Math.round(w.kmMax) + '</span><span class="mute"> / ' + Math.round(w.declaredKm) + '</span>';
      else vol = Math.round(plannedKm);
      h += '<td class="vol">' + vol + '</td></tr>';
      if (open) h += '<tr class="wd"><td colspan="9">' + weekDetail(w) + '</td></tr>';
    });
    return h + '</tbody></table>' + legend();
  }
  function legend() {
    return '<div class="legend"><span><i class="c e1 s-completed"></i>volně</span><span><i class="c e2 s-completed"></i>dlouhý</span><span><i class="c e3 s-completed"></i>tempo</span><span><i class="c e4 s-completed"></i>rychlost</span><span><i class="c e5 s-completed"></i>závod</span></div>';
  }
  function renderPlan() {
    if (S.sub === 'new') return renderForm();
    if (S.sub === 'staged' && S.staged) return renderStaged();
    var d = S.plan;
    // Plán se ještě načítá: místo formuláře nového plánu (problikl by) jen prázdná plocha.
    if (!d && S.week && S.week.view === 'week') return '<p class="blank">Načítám…</p>';
    if (!d || d.view !== 'plan') return renderForm();
    var t = d.totals;
    var h = '<header class="hd"><h1>' + esc(d.planName) + '</h1><button type="button" class="tb" data-do="new">Nový</button></header>';
    h += '<p class="meta"><b>' + t.doneKm + '</b> z ' + t.plannedKm + ' km<span>' + (d.last ? 'do ' + dm(d.last) : '') + '</span></p>';
    if (S.week && S.week.staged) h += '<button type="button" class="pending" data-do="staged"><span>Rozpracovaný plán „' + esc(S.week.staged.name) + '“ čeká na schválení.</span><b>Zkontrolovat ›</b></button>';
    return h + matrix(d.weeks, { link: true });
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
    h += '<button type="button" class="doc main" data-do="doc"><b>Plán od trenéra</b><span>PDF, fotka nebo tabulka. Otevře se Claude s připravenou zprávou, přiložíš soubor a odešleš. Přepsaný plán se objeví tady ke kontrole.</span></button>';
    h += '<button type="button" class="doc" data-do="strava"><b>Plán podle mé Stravy</b><span>Claude projde tvoje běhy za poslední 2–3 měsíce, zeptá se na cíl a postaví plán ke kontrole.</span></button>';
    h += '<p class="hint">Obojí potřebuje adresu RPM přidanou v Claude jako konektor; pro Stravu i oficiální konektor Strava.</p>';
    return h + '<button type="button" class="row-link" data-do="manual">Sestavit bez Clauda</button></div>';
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
      h += '<li><span class="dw">' + x.day + '</span><div><p class="t"><b>' + esc(x.title) + '</b><span class="n">' + (x.kmMax ? num(x.kmMax) + ' km' : '') + (x.kmUnknown ? ' +' : '') + '</span></p>';
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
      h += '<div class="goal"><span class="lab">Cílový čas' + (dist ? ' · ' + dist[1] + (dist[0] > 10000 ? ' km' : '') : '') + '</span><div class="step"><button type="button" data-do="goal" data-v="-60" aria-label="O minutu rychleji"' + (gs <= goal.minSec ? ' disabled' : '') + '>−</button><output class="n">' + hms(gs) + '</output><button type="button" data-do="goal" data-v="60" aria-label="O minutu pomaleji"' + (gs >= goal.maxSec ? ' disabled' : '') + '>+</button></div>';
      h += '<p class="hint">' + (goal.source === 'table' ? 'Podle tabulky temp z plánu, v jejím rozsahu ' + hms(goal.minSec) + '–' + hms(goal.maxSec) + '.' : 'Tempa spočítaná z cílového času (VDOT).') + '</p></div>';
    }
    if (!d || !d.paces || !d.paces.length) h += '<p class="blank">Tempa zatím nejsou. Spočítej je z čerstvého závodu.</p>';
    else {
      h += '<table class="pt"><tbody>' + d.paces.map(function (p) {
        var lvl = INT_LVL[p.key] == null ? 1 : INT_LVL[p.key];
        return '<tr><td><i class="sw e' + lvl + '"></i>' + esc(p.label.charAt(0).toUpperCase() + p.label.slice(1)) + '</td><td>' + pace(p.fromSec) + '–' + pace(p.toSec) + '<small> /km</small></td></tr>';
      }).join('') + '</tbody></table>';
    }
    var c = S.calcForm || (S.calcForm = { dist: 21097.5, time: '', open: false });
    if (S.calc) return h + '<div class="sticky"><button type="button" class="btn" data-do="calcback">Zpět</button><button type="button" class="btn go accent" data-do="calcsave">Uložit tempa</button></div>';
    if (!c.open && d && d.paces && d.paces.length) return h + '<button type="button" class="row-link" data-do="calcopen">Přepočítat z čerstvého závodu</button>';
    h += '<div class="form"><div class="f"><span class="lab">Čerstvý závod</span>' + seg('cdist', RACES, c.dist, 'n') + '<input class="in n gap" inputmode="numeric" placeholder="čas, např. 1:32:00" data-f="ctime" value="' + esc(c.time) + '" aria-label="Čas"></div></div>';
    return h + '<div class="sticky"><button type="button" class="btn go" data-do="calc">Spočítat tempa</button></div>';
  }
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
  }
  function render() {
    view.innerHTML = S.tab === 'week' ? renderWeek() : S.tab === 'plan' ? renderPlan() : renderPaces();
    sizes(view);
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
      case 'done': S.open = id; act('set_status', { workoutId: id, status: 'completed' }, 'Odběhnuto', true); break;
      case 'unset': act('set_status', { workoutId: id, status: 'scheduled' }, 'Zápis zrušen', true); break;
      case 'restore': act('restore_workout', { workoutId: id, reason: '' }, 'Obnoveno', true); break;
      case 'eval': var ew = findW(id)[0]; toClaude('Zhodnoť můj běh „' + ew.title + '“ z ' + dm(ew.date) + ' podle Stravy (konektor RPM, show_result) a zapiš ho.'); break;
      case 'close': closeSheet(); break;
      case 'partial': closeSheet(); S.open = id; act('set_status', { workoutId: id, status: 'partial' }, 'Zapsáno jako částečně', true); break;
      case 'skip': closeSheet(); act('skip_workout', { workoutId: id, reason: '' }, 'Vynecháno', true); break;
      case 'move': moveMenu(id); break;
      case 'moveto': closeSheet(); act('move_workout', { workoutId: id, toDate: v, reason: '' }, 'Přesunuto na ' + DOW[(new Date(v + 'T12:00:00Z').getUTCDay() + 6) % 7], true); break;
      case 'fit': closeSheet(); call('export_garmin', { workoutId: id }).then(function (d) { if (d.url) location.href = d.url; else toast('Soubor se nepovedlo připravit.'); }, fail); break;
      case 'tab': S.tab = v; S.sub = 'new'; render(); break;
      case 'week': S.open = null; window.scrollTo(0, 0); load('week', { date: v }); break;
      case 'new': S.sub = 'new'; window.scrollTo(0, 0); render(); break;
      case 'cancel': S.sub = null; S.fromForm = false; render(); break;
      case 'staged': call('show_week', { tab: 'staged' }).then(function (d) { S.fromForm = false; take(d); render(); }, fail); break;
      case 'km': S.form.km = Math.min(200, Math.max(10, S.form.km + +v)); render(); break;
      case 'rest': var r = S.form.rest, i = r.indexOf(+v); if (i >= 0) r.splice(i, 1); else r.push(+v); render(); break;
      case 'draft': draft(); break;
      case 'doc': toClaude('Přikládám svůj tréninkový plán. Přepiš ho přes konektor RPM do rozpracovaného importu (import_plan_weeks): když je v dokumentu verze v mílích i v km, vezmi jen kilometrovou, a týdny, kde nesedí součet, oprav podle dokumentu. Do kalendáře ho nezařazuj, zkontroluju ho v appce RPM.'); break;
      case 'strava': toClaude('Postav mi nový běžecký plán podle mé Stravy. Postupuj podle instrukcí RPM pro nový plán: načti profil a historii, projdi Stravu za posledních 8–12 týdnů, zeptej se jen na to, co chybí, a kostru nech v rozpracovaném importu; zkontroluju ji v appce RPM.'); break;
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
        render();
        // Klepání za sebou se uloží jednou, až prst přestane.
        clearTimeout(S.goalTimer);
        S.goalTimer = setTimeout(function () {
          var want = S.goalSec;
          call('set_goal_time', { goalSec: want }).then(function (d) { weeks = {}; if (S.goalSec === want) S.goalSec = null; take(d); render(); }, fail);
        }, 600);
        break;
      case 'calcback': S.calc = null; render(); break;
      case 'calcopen': S.calcForm.open = true; render(); break;
      case 'calcsave': call('calculate_paces', { distanceM: S.calc.calc.distanceM, timeSec: S.calc.calc.timeSec, save: true }).then(function () { S.calc = null; toast('Tempa uložena'); load('paces'); }, fail); break;
    }
  });
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
  function goWeek(dir, gh) {
    var el = view.querySelector('.days');
    if (busy || !hasWeek(dir)) { if (el) slide(el, 0, BACK_MS); if (gh) slide(gh, dir * (el ? el.clientWidth : 0), BACK_MS); setTimeout(function () { if (gh) gh.remove(); }, BACK_MS); return; }
    busy = true; S.open = null;
    var key = addDays(S.week.weekStart, dir * 7), cached = weeks[key];
    var show = function (d) { take(d); render(); busy = false; };
    if (cached) {
      if (!el || reduced()) { if (gh) gh.remove(); show(cached); }
      else {
        if (!gh) { gh = ghostFor(dir); slide(gh, dir * el.clientWidth, 0); void gh.offsetWidth; }
        slide(el, -dir * el.clientWidth, OUT_MS);
        slide(gh, 0, OUT_MS);
        setTimeout(function () { show(cached); }, OUT_MS);
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
      slide(el, -dir * el.clientWidth, OUT_MS, 0); setTimeout(ok, OUT_MS);
    });
    Promise.all([data, out]).then(function (r) { take(r[0]); render(); slideIn(dir); }, fail).then(function () { busy = false; });
  }
  view.addEventListener('touchstart', function (e) {
    g = null;
    if (busy || S.tab !== 'week' || !S.week || S.week.view !== 'week' || e.touches.length !== 1) return;
    var t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, dx: 0, el: view.querySelector('.days'), ghost: null, gdir: 0 };
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
    g.dx = hasWeek(dir) ? dx : dx * 0.2;
    if (g.gdir !== dir) { if (g.ghost) g.ghost.remove(); g.ghost = hasWeek(dir) ? ghostFor(dir) : null; g.gdir = dir; }
    slide(g.el, g.dx, 0);
    if (g.ghost) slide(g.ghost, dir * g.el.clientWidth + g.dx, 0);
  }, { passive: false });
  function swipeEnd(e) {
    var s = g; g = null;
    if (!s || s.axis !== 'x' || !s.el) return;
    var speed = Math.abs(s.dx) / Math.max(1, e.timeStamp - s.t), dir = s.dx < 0 ? 1 : -1;
    var gh = s.gdir === dir ? s.ghost : null;
    if (Math.abs(s.dx) > s.el.clientWidth * 0.25 || (speed > 0.3 && Math.abs(s.dx) > 24)) goWeek(dir, gh);
    else {
      slide(s.el, 0, BACK_MS);
      if (gh) { slide(gh, dir * s.el.clientWidth, BACK_MS); setTimeout(function () { gh.remove(); }, BACK_MS); }
    }
  }
  view.addEventListener('touchend', swipeEnd);
  view.addEventListener('touchcancel', swipeEnd);

  // ---------- Bez klíče ----------
  function setup(msg) {
    view.innerHTML = '<div class="setup"><h1>Připoj svůj plán</h1><p>' + esc(msg || 'Vlož adresu konektoru z úvodní stránky. Zůstane jen v tomhle prohlížeči.') + '</p><form id="kf"><input class="in n" id="ki" placeholder="https://…/mcp/…" autocomplete="off" aria-label="Adresa konektoru"><div class="acts"><button class="btn go accent">Připojit</button></div></form></div>';
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
      if (r[0].view === 'week') call('show_week', { tab: 'plan' }).then(function (d) { if (d.view === 'plan' && !S.plan) { S.plan = d; if (S.tab === 'plan' && !S.sub) render(); } }, function () { /* načte se při otevření */ });
      // Poslední týden a tempa pro start bez signálu (třeba na trati).
      try { localStorage.setItem(CACHE_KEY, JSON.stringify([r[0], r[1]])); } catch (e) { /* plné úložiště */ }
      if (firstTab === 'new') { S.tab = 'plan'; S.sub = 'new'; } else if (firstTab && firstTab !== 'week') return load(firstTab);
      if (r[0].view !== 'week') { S.tab = 'plan'; S.sub = r[0].staged ? null : 'new'; if (r[0].staged) return call('show_week', { tab: 'staged' }).then(take); }
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
