/* Radio BCS2050 — a 24/7 station from static files. /radio/station_{es,en}.json is one deterministic loop
   (station IDs, ~10 min deep dives in chapters, short transitions, ~30 s music breaks). Pressing play joins
   at the live position: (now - epoch) mod loop length. No streaming server. */
(function () {
  var root = document.getElementById('radio-bcs');
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.radio-btn'), panel = $('.radio-panel'), playB = $('.radio-play');
  var st = {}, credits = null, eds = {}, lang = null, i = 0, live = true, pending = 0;
  var audio = new Audio(); audio.preload = 'none';
  var T = {
    es: { play: 'Reproducir', pause: 'Pausa', prev: 'Anterior', next: 'Siguiente', notes: 'Notas y fuentes', music: 'Música',
          sources: 'Fuentes de este programa', err: 'No se pudo cargar el audio.', up: 'A continuación', golive: '● Volver al vivo',
          made: 'Radio continua 24/7. Guiones con fuentes del portal; voces sintéticas Grok TTS.', id: 'Radio BCS2050',
          mus: '♪ Música', none: 'La radio aún no tiene programas.' },
    en: { play: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next', notes: 'Notes & sources', music: 'Music',
          sources: 'Sources for this show', err: 'Could not load audio.', up: 'Up next', golive: '● Back to live',
          made: 'Continuous 24/7 radio. Scripts from portal sources; synthetic voices by Grok TTS.', id: 'Radio BCS2050',
          mus: '♪ Music', none: 'No shows yet.' }
  };
  function pageLang() { return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'es'; }
  function S() { return st[lang]; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function get(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); }
  function load() {
    var jobs = [st[lang] ? null : get('/radio/station_' + lang + '.json').then(function (j) {
      // a station file holds the running loop and, after a daily build, the next one with its on-air time
      var sc = (j.schedules || [{ start: j.epoch, items: j.items }]).map(function (x) {
        var c = 0; x.items.forEach(function (y) { y.t0 = c; c += y.d; }); x.total = c; x.at = Date.parse(x.start); return x;
      });
      st[lang] = { list: sc };
    })];
    if (!credits) jobs.push(get('/radio/credits.json').then(function (c) { credits = c; }).catch(function () {}));
    return Promise.all(jobs).then(pick);
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
    $('.radio-title').textContent = prog ? prog.name + ' · ' + day(prog.date) : 'Radio BCS2050';
    $('.radio-seg').textContent = label(x);
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
          out.push('<li><button type="button" data-j="' + ((i + n) % s.items.length) + '"><span>' + esc(z.name) + ' · ' + esc(day(z.date)) +
            '</span><span>' + new Date(now + acc * 1000).toLocaleTimeString(lang === 'es' ? 'es-MX' : 'en-US', { hour: '2-digit', minute: '2-digit' }) + '</span></button></li>');
        }
      }
      acc += y.d;
    }
    $('.radio-tracks').innerHTML = out.join('');
    state();
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
    p.then(function (e) { var ep = (e.episodes || []).filter(function (z) { return z.topic === prog.topic; })[0]; fill(ep && ep.sources); }).catch(function () { fill(null); });
  }
  function state() {
    var on = !audio.paused;
    btn.classList.toggle('is-playing', on);
    playB.textContent = on ? '❚❚' : '▶';
    playB.setAttribute('aria-label', on ? T[lang].pause : T[lang].play);
    $('.radio-dot').textContent = on ? '❚❚' : '▶';
    $('.radio-live').hidden = !live || !on;
  }
  function playItem(j, offset) {
    var s = S(); if (!s || !s.items.length) return;
    i = ((j % s.items.length) + s.items.length) % s.items.length;
    pending = offset || 0;
    audio.src = s.items[i].src;
    $('.radio-msg').textContent = '';
    audio.play().catch(function () { $('.radio-msg').textContent = T[lang].err; });
    render();
    if (!$('.radio-notes').hidden) notes();
  }
  audio.addEventListener('loadedmetadata', function () {
    if (pending > 0.5 && pending < (audio.duration || 0) - 0.5) audio.currentTime = pending;
    pending = 0;
  });
  audio.addEventListener('ended', function () { if (live && pick()) goLive(); else playItem(i + 1, 0); });
  audio.addEventListener('play', state); audio.addEventListener('pause', state);
  audio.addEventListener('error', function () { if (audio.getAttribute('src')) { $('.radio-msg').textContent = T[lang].err; setTimeout(function () { playItem(i + 1, 0); }, 1500); } });
  audio.addEventListener('timeupdate', function () {
    var x = S() && S().items[i]; if (!x) return;
    $('.radio-bar i').style.width = Math.min(100, 100 * audio.currentTime / (x.d || audio.duration || 1)) + '%';
  });
  function goLive() { load().then(function () { live = true; var p = livePos(); playItem(p[0], p[1]); }); }
  function toggle() {
    if (!audio.getAttribute('src')) return goLive();
    if (audio.paused) { if (live) goLive(); else audio.play(); }  // a live station resumes at the live point
    else audio.pause();
  }
  btn.addEventListener('click', function () {
    var closed = panel.hasAttribute('hidden');
    if (closed) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    if (!audio.getAttribute('src') || (closed && audio.paused)) goLive(); else if (!closed) toggle();
  });
  playB.addEventListener('click', toggle);
  $('.radio-prev').addEventListener('click', function () { live = false; playItem(i - 1, 0); });
  $('.radio-next').addEventListener('click', function () { live = false; playItem(i + 1, 0); });
  $('.radio-golive').addEventListener('click', goLive);
  $('.radio-close').addEventListener('click', function () { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); });
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
})();
