/* Radio BCS2050 — a 24/7 station from static files. /radio/station_{es,en}.json is one deterministic loop
   (station IDs, ~20 min conversations in chapters under a music bed, music breaks between programs). Pressing play joins
   at the live position: (now - epoch) mod loop length. No streaming server. */
(function () {
  var root = document.getElementById('radio-bcs');
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.radio-btn'), panel = $('.radio-panel'), playB = $('.radio-play');
  var SIL = 'data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/4zjAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAAB+ACSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpK2tra2tra2tra2tra2tra2tra2tra2tra229vb29vb29vb29vb29vb29vb29vb29vb2/////////////////////////////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJAOgAAAAAAAAAfhBGl4cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4xjEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xjEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xjEdgAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xjEsQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=', unlocked = false;
  var filt = '', ORDER = ['noticias', 'datos', 'tendencia', 'vision'];
  var st = {}, credits = null, eds = {}, lang = null, i = 0, live = true, pending = 0, tries = 0;
  var audio = new Audio(); audio.preload = 'none';
  var T = {
    es: { play: 'Reproducir', pause: 'Pausa', prev: 'Anterior', next: 'Siguiente', notes: 'Notas y fuentes', music: 'Música',
          sources: 'Fuentes de este programa', err: 'No se pudo cargar el audio.', tap: 'Toca ▶ para escuchar.', up: 'A continuación', eps: 'Catálogo de episodios', ep: 'Ep.', with: 'con', and: 'y', all: 'Todos', kinds: { noticias: 'Noticias', datos: 'Datos del portal', tendencia: 'Tendencia 2050', vision: 'Visión 2050' }, golive: '● Volver al vivo',
          made: 'Radio continua 24/7. Guiones con fuentes del portal; voces sintéticas Grok TTS.', id: 'Radio BCS2050',
          mus: '♪ Música', none: 'La radio aún no tiene programas.' },
    en: { play: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next', notes: 'Notes & sources', music: 'Music',
          sources: 'Sources for this show', err: 'Could not load audio.', tap: 'Tap ▶ to listen.', up: 'Up next', eps: 'Episode catalog', ep: 'Ep.', with: 'with', and: 'and', all: 'All', kinds: { noticias: 'News', datos: 'Portal data', tendencia: 'Trend 2050', vision: 'Vision 2050' }, golive: '● Back to live',
          made: 'Continuous 24/7 radio. Scripts from portal sources; synthetic voices by Grok TTS.', id: 'Radio BCS2050',
          mus: '♪ Music', none: 'No shows yet.' }
  };
  function pageLang() { return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'es'; }
  function S() { return st[lang]; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function get(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); }
  function load(L) {
    L = L || lang;
    if (st[L] && Date.now() - st[L].got > 3600e3) st[L] = null;
    var jobs = [st[L] ? null : get('/radio/station_' + L + '.json').then(function (j) {
      // a station file holds the running loop and, after a daily build, the next one with its on-air time
      var sc = (j.schedules || [{ start: j.epoch, items: j.items }]).map(function (x) {
        var c = 0; x.items.forEach(function (y) { y.t0 = c; c += y.d; }); x.total = c; x.at = Date.parse(x.start); return x;
      });
      st[L] = { list: sc, got: Date.now() };
    })];
    if (!credits) jobs.push(get('/radio/credits.json').then(function (c) { credits = c; }).catch(function () { credits = {}; }));
    return Promise.all(jobs).then(function () { if (L === lang) return pick(); });
  }
  function pick() {  // the schedule on air now (latest whose start has passed)
    var s = st[lang]; if (!s) return;
    var now = Date.now(), on = s.list[0];
    s.list.forEach(function (x) { if (x.at <= now && x.at >= on.at) on = x; });
    if (s.cur !== on) { s.cur = on; s.items = on.items; s.total = on.total; s.epoch = on.start; return true; }
  }
  function livePos() {  // [item index, offset seconds]
    var s = S(), t = ((Date.now() - Date.parse(s.epoch)) / 1000) % s.total;
    if (t < 0) t += s.total;
    var lo = 0, hi = s.items.length - 1;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (s.items[m].t0 <= t) lo = m; else hi = m - 1; }
    return [lo, t - s.items[lo].t0];
  }
  function label(x) {
    if (!x) return '';
    if (x.kind === 'id') return T[lang].id;
    if (x.kind === 'music') return T[lang].mus + (x.name ? ' · ' + x.name : '');
    return x.ch;
  }
  function day(d) { return new Date(d + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'short' }); }
  function render() {
    var t = T[lang], s = S();
    root.querySelectorAll('.radio-langs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.l === lang)); });
    $('.radio-prev').setAttribute('aria-label', t.prev); $('.radio-next').setAttribute('aria-label', t.next);
    $('.radio-notes-btn').textContent = t.notes; $('.radio-golive').textContent = t.golive; $('.radio-up').textContent = t.up;
    if (!s || !s.items.length) { $('.radio-title').textContent = t.none; return; }
    var x = s.items[i], prog = null;
    for (var k = i; k < s.items.length && !prog; k++) if (s.items[k].name) prog = s.items[k];
    $('.radio-title').textContent = prog ? (prog.title || prog.name + ' · ' + day(prog.date)) : 'Radio BCS2050';
    $('.radio-seg').textContent = (prog && prog.title ? (prog.num ? t.ep + ' ' + prog.num + ' · ' : '') + prog.name + ' · ' : '') + label(x);
    $('.radio-live').hidden = !live || audio.paused;
    $('.radio-golive').hidden = live;
    // up next: the next programs in the loop with local start times
    var out = [], seen = prog ? prog.date + prog.topic : '', now = Date.now(), off = audio.currentTime || 0, acc = (x ? x.d : 0) - off;
    for (var n = 1; n < s.items.length && out.length < 4; n++) {
      var y = s.items[(i + n) % s.items.length];
      if (y.kind === 'id') {
        var z = s.items[(i + n + 1) % s.items.length];
        if (z && z.name && z.date + z.topic !== seen) {
          seen = z.date + z.topic;
          out.push('<li><button type="button" data-j="' + ((i + n) % s.items.length) + '"><span>' + esc(z.title || z.name) + ' · ' + esc(day(z.date)) +
            '</span><span>' + new Date(now + acc * 1000).toLocaleTimeString(lang === 'es' ? 'es-MX' : 'en-US', { hour: '2-digit', minute: '2-digit' }) + '</span></button></li>');
        }
      }
      acc += y.d;
    }
    $('.radio-tracks').innerHTML = out.join('');
    episodes(prog);
    state();
  }
  function episodes(prog) {  // podcast-style list of every episode in the loop; tap one to play it from the start
    var s = S(), t = T[lang], list = [], cur = null;
    $('.radio-eps-h').textContent = t.eps;
    s.items.forEach(function (y, k) {
      if (!y.name) return;
      var key = y.date + y.topic;
      if (!cur || cur.key !== key) {
        var st0 = k > 0 && s.items[k - 1].kind === 'id' ? k - 1 : k;
        cur = { key: key, j: st0, y: y, d: 0 }; list.push(cur);
      }
      if (y.kind === 'talk') cur.d += y.d;
    });
    var on = prog ? prog.date + prog.topic : '';
    var present = ORDER.filter(function (k) { return list.some(function (e) { return e.y.type === k; }); });
    $('.radio-filter').innerHTML = present.length > 1 ? [''].concat(present).map(function (k) {
      return '<button type="button" data-k="' + k + '" aria-pressed="' + (filt === k) + '">' + esc(k ? t.kinds[k] : t.all) + '</button>';
    }).join('') : '';
    // grouped by type (news, portal data, trend, vision), newest first inside each group
    list = list.filter(function (e) { return !filt || e.y.type === filt; }).sort(function (a, b) {
      var ka = ORDER.indexOf(a.y.type), kb = ORDER.indexOf(b.y.type);
      return (ka < 0 ? 9 : ka) - (kb < 0 ? 9 : kb) || (b.y.date > a.y.date ? 1 : b.y.date < a.y.date ? -1 : (a.y.num || 0) - (b.y.num || 0));
    });
    var lastK = null;
    $('.radio-eps').innerHTML = list.map(function (e) {
      var y = e.y, head = '';
      if (!filt && y.type && y.type !== lastK) { lastK = y.type; head = '<li class="radio-eps-g">' + esc(t.kinds[y.type] || '') + '</li>'; }
      return head + '<li><button type="button" data-j="' + e.j + '"' + (e.key === on ? ' aria-current="true"' : '') + '><b>' +
        esc(y.title || y.name) + '</b><span>' + (y.num ? t.ep + ' ' + y.num + ' · ' : '') + esc(y.name) + ' · ' + esc(day(y.date)) +
        ' · ' + Math.round(e.d / 60) + ' min' +
        (y.hosts && y.hosts.length === 2 ? ' · ' + t.with + ' ' + esc(y.hosts[0]) + ' ' + t.and + ' ' + esc(y.hosts[1]) : '') + '</span></button></li>';
    }).join('');
  }
  function notes() {
    var s = S(), x = s && s.items[i], t = T[lang];
    var mus = (credits && credits.music || []).map(function (m) {
      return '<p>♪ ' + esc(m.title) + ' — ' + esc(m.artist) + ' · <a href="' + esc(m.license_url) + '" target="_blank" rel="noopener">' + esc(m.license) +
        '</a> · <a href="' + esc(m.source) + '" target="_blank" rel="noopener">Wikimedia Commons</a></p>';
    }).join('');
    var head = '<p><em>' + t.made + '</em></p>';
    var fill = function (srcs) {
      $('.radio-notes').innerHTML = head + (srcs ? '<p><strong>' + t.sources + '</strong></p>' + srcs.map(function (s) {
        return '<p>' + esc(s.outlet) + (s.url ? ' — <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : ' — ' + esc(s.title)) + '</p>';
      }).join('') : '') + '<p><strong>' + t.music + '</strong></p>' + mus;
    };
    var prog = null;
    for (var k = i; s && k < s.items.length && !prog; k++) if (s.items[k].name) prog = s.items[k];
    if (!prog) return fill(null);
    var p = eds[prog.date] || (eds[prog.date] = get('/radio/editions/' + prog.date + '/edition.json'));
    p.then(function (e) {
      var ep = (e.episodes || []).filter(function (z) { return z.topic === prog.topic; })[0];
      fill(ep && ep.sources);
      var dsc = ep && ep['desc_' + lang];
      if (dsc) $('.radio-notes').insertAdjacentHTML('afterbegin', '<p><strong>' + esc(ep['title_' + lang] || '') + '</strong><br>' + esc(dsc) + '</p>');
    }).catch(function () { fill(null); });
  }
  function state() {
    var on = !audio.paused;
    btn.classList.toggle('is-playing', on);
    playB.textContent = on ? '❚❚' : '▶';
    playB.setAttribute('aria-label', on ? T[lang].pause : T[lang].play);
    $('.radio-dot').textContent = on ? '❚❚' : '▶';
    $('.radio-live').hidden = !live || !on;
  }
  function playItem(j, offset, retry) {
    var s = S(); if (!s || !s.items.length) return;
    i = ((j % s.items.length) + s.items.length) % s.items.length;
    pending = offset || 0;
    if (!retry) tries = 0;
    audio.src = s.items[i].src;
    $('.radio-msg').textContent = '';
    // mobile browsers reject play() outside a tap (NotAllowedError) and when the source changes mid-load
    // (AbortError); neither means the file is missing
    audio.play().catch(function (e) {
      var n = e && e.name;
      if (n === 'AbortError') return;
      $('.radio-msg').textContent = n === 'NotAllowedError' ? T[lang].tap : T[lang].err;
      state();
    });
    render();
    if (!$('.radio-notes').hidden) notes();
  }
  audio.addEventListener('loadedmetadata', function () {
    if (pending > 0.5 && pending < (audio.duration || 0) - 0.5) audio.currentTime = pending;
    pending = 0;
  });
  audio.addEventListener('ended', function () { if (audio.src.indexOf('data:') === 0) return; if (live && pick()) goLive(); else playItem(i + 1, 0); });
  audio.addEventListener('playing', function () { if (audio.src.indexOf('data:') !== 0) unlocked = true; });
  audio.addEventListener('play', state); audio.addEventListener('pause', state);
  audio.addEventListener('error', function () {
    if (!audio.getAttribute('src') || audio.src.indexOf('data:') === 0) return;
    // a transient CDN/edge error: retry the same file once at the same point, then move on
    if (tries++ < 1) { var at = audio.currentTime || pending || 0; setTimeout(function () { playItem(i, at, true); }, 800); return; }
    $('.radio-msg').textContent = T[lang].err; setTimeout(function () { playItem(i + 1, 0); }, 1500);
  });
  audio.addEventListener('timeupdate', function () {
    var x = S() && S().items[i]; if (!x) return;
    $('.radio-bar i').style.width = Math.min(100, 100 * audio.currentTime / (x.d || audio.duration || 1)) + '%';
  });
  function goLive() {
    var now = function () { pick(); live = true; var p = livePos(); playItem(p[0], p[1]); };
    var s = st[lang];
    if (s && Date.now() - s.got < 3600e3 && credits) return now();  // keeps play() inside the user's tap (iOS)
    // not loaded yet: unlock the audio element inside this tap with a silent clip, then start once the file arrives
    if (!unlocked) { audio.src = SIL; audio.play().catch(function () {}); }
    load().then(now);
  }
  function toggle() {
    if (!audio.getAttribute('src')) return goLive();
    if (audio.paused) { if (live) goLive(); else audio.play(); }  // a live station resumes at the live point
    else audio.pause();
  }
  btn.addEventListener('click', function () {
    if (audio.paused) lang = pageLang();
    var closed = panel.hasAttribute('hidden');
    if (closed) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    if (!audio.getAttribute('src') || (closed && audio.paused)) goLive(); else if (!closed) toggle();
  });
  playB.addEventListener('click', toggle);
  $('.radio-prev').addEventListener('click', function () { live = false; playItem(i - 1, 0); });
  $('.radio-next').addEventListener('click', function () { live = false; playItem(i + 1, 0); });
  $('.radio-golive').addEventListener('click', goLive);
  $('.radio-close').addEventListener('click', function () { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); });
  $('.radio-filter').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { filt = b.dataset.k; render(); } });
  $('.radio-eps').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { live = false; playItem(+b.dataset.j, 0); } });
  $('.radio-tracks').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { live = false; playItem(+b.dataset.j, 0); } });
  $('.radio-notes-btn').addEventListener('click', function () { var n = $('.radio-notes'); if (n.hasAttribute('hidden')) { n.removeAttribute('hidden'); notes(); } else n.setAttribute('hidden', ''); });
  root.querySelectorAll('.radio-langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.l === lang) return;
      var was = !audio.paused; lang = b.dataset.l;
      if (was) goLive(); else load().then(function () { var p = livePos(); i = p[0]; render(); });
    });
  });
  document.addEventListener('bcs:lang', function (e) { if (audio.paused) { lang = e.detail.lang === 'en' ? 'en' : 'es'; if (S()) render(); } });
  setInterval(function () { if (!panel.hidden && S()) render(); }, 30000);
  lang = pageLang();
  load('es').catch(function () {}); load('en').catch(function () {});  // prefetch both (~26 KB each) the small station file so the first tap can start audio at once
})();
