/* Radio BCS2050 — static player. Reads /radio/latest.json; voice tracks + short licensed stingers. */
(function () {
  var root = document.getElementById('radio-bcs');
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.radio-btn'), panel = $('.radio-panel'), playB = $('.radio-play');
  var ed = null, credits = null, lang = null, idx = 0, inSting = false, loading = null;
  var audio = new Audio(); audio.preload = 'none';
  var T = {
    es: { play: 'Reproducir', pause: 'Pausa', prev: 'Anterior', next: 'Siguiente', notes: 'Notas y fuentes', tracks: 'Segmentos',
          music: 'Música', sources: 'Fuentes', none: 'La radio aún no tiene edición.', err: 'No se pudo cargar el audio.',
          made: 'Guion con fuentes del portal; voces sintéticas Grok TTS.', interlude: 'Interludio musical' },
    en: { play: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next', notes: 'Notes & sources', tracks: 'Segments',
          music: 'Music', sources: 'Sources', none: 'No edition yet.', err: 'Could not load audio.',
          made: 'Script from portal sources; synthetic voices by Grok TTS.', interlude: 'Musical interlude' }
  };
  function pageLang() { return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'es'; }
  function L() { return (ed && ed.languages[lang]) || null; }
  function fmt(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('/radio/latest.json', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }),
      fetch('/radio/credits.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (x) { ed = x[0]; credits = x[1]; if (!ed.languages[lang]) lang = Object.keys(ed.languages)[0]; render(); });
    return loading;
  }
  function render() {
    var t = T[lang], l = L();
    root.querySelectorAll('.radio-langs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.l === lang)); });
    $('.radio-prev').setAttribute('aria-label', t.prev); $('.radio-next').setAttribute('aria-label', t.next);
    $('.radio-notes-btn').textContent = t.notes;
    if (!l) { $('.radio-title').textContent = t.none; return; }
    var d = new Date(ed.date + 'T12:00:00');
    $('.radio-date').textContent = d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    $('.radio-title').textContent = l.title;
    $('.radio-tracks').innerHTML = l.tracks.map(function (k, i) {
      return '<li><button type="button" data-i="' + i + '"' + (i === idx ? ' aria-current="true"' : '') + '><span>' + (i + 1) + '. ' + esc(k.title) +
        '</span><span>' + fmt(k.duration) + '</span></button></li>';
    }).join('');
    var mus = (credits && credits.music || []).map(function (m) {
      return '<p>♪ ' + esc(m.title) + ' — ' + esc(m.artist) + ' · <a href="' + esc(m.license_url) + '" target="_blank" rel="noopener">' + esc(m.license) +
        '</a> · <a href="' + esc(m.source) + '" target="_blank" rel="noopener">Wikimedia Commons</a></p>';
    }).join('');
    var src = (ed.sources || []).map(function (s) {
      return '<p>' + esc(s.outlet) + (s.url ? ' — <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : ' — ' + esc(s.title)) + '</p>';
    }).join('');
    $('.radio-notes').innerHTML = '<p><em>' + t.made + '</em></p><p><strong>' + t.sources + '</strong></p>' + src + '<p><strong>' + t.music + '</strong></p>' + mus;
    seg();
  }
  function seg() {
    var l = L(); if (!l) return;
    var k = l.tracks[idx];
    $('.radio-seg').textContent = inSting ? '♪ ' + T[lang].interlude : (idx + 1) + '/' + l.tracks.length + ' · ' + (k ? k.title : '');
    root.querySelectorAll('.radio-tracks button').forEach(function (b) { b.setAttribute('aria-current', String(+b.dataset.i === idx)); });
  }
  function state() {
    var on = !audio.paused;
    btn.classList.toggle('is-playing', on);
    playB.textContent = on ? '❚❚' : '▶';
    playB.setAttribute('aria-label', on ? T[lang].pause : T[lang].play);
    $('.radio-dot').textContent = on ? '❚❚' : '▶';
  }
  function playAt(i, sting) {
    var l = L(); if (!l || i < 0 || i >= l.tracks.length) { audio.pause(); state(); return; }
    idx = i; inSting = !!sting;
    audio.src = sting ? l.tracks[i].sting : l.tracks[i].src;
    $('.radio-msg').textContent = '';
    audio.play().catch(function () { $('.radio-msg').textContent = T[lang].err; });
    seg();
  }
  audio.addEventListener('ended', function () {
    var l = L(); if (!l) return;
    var k = l.tracks[idx];
    if (!inSting && k && k.sting) playAt(idx, true); else playAt(idx + 1, false);
  });
  audio.addEventListener('play', state); audio.addEventListener('pause', state);
  audio.addEventListener('error', function () { if (audio.src) $('.radio-msg').textContent = T[lang].err; });
  audio.addEventListener('timeupdate', function () {
    var l = L(); if (!l || inSting) return;
    var done = 0; for (var j = 0; j < idx; j++) done += l.tracks[j].duration || 0;
    $('.radio-bar i').style.width = Math.min(100, 100 * (done + audio.currentTime) / (l.duration || 1)) + '%';
  });
  function toggle() {
    if (!audio.src || audio.ended) { load().then(function () { playAt(idx, false); }); return; }
    if (audio.paused) audio.play(); else audio.pause();
  }
  btn.addEventListener('click', function () {
    var open = panel.hasAttribute('hidden');
    if (open) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    if (!audio.src) { lang = lang || pageLang(); load().then(function () { playAt(0, false); }); }
    else if (!open) toggle();
  });
  playB.addEventListener('click', toggle);
  $('.radio-prev').addEventListener('click', function () { playAt(Math.max(0, idx - (inSting ? 0 : 1)), false); });
  $('.radio-next').addEventListener('click', function () { playAt(idx + 1, false); });
  $('.radio-close').addEventListener('click', function () { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); });
  $('.radio-tracks').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) playAt(+b.dataset.i, false); });
  $('.radio-notes-btn').addEventListener('click', function () { var n = $('.radio-notes'); if (n.hasAttribute('hidden')) n.removeAttribute('hidden'); else n.setAttribute('hidden', ''); });
  root.querySelectorAll('.radio-langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.l === lang) return;
      var was = !audio.paused; lang = b.dataset.l; inSting = false;
      load().then(function () { render(); if (was) playAt(Math.min(idx, L().tracks.length - 1), false); else { audio.removeAttribute('src'); audio.load(); state(); } });
    });
  });
  document.addEventListener('bcs:lang', function (e) { if (!audio.src || audio.paused) { lang = e.detail.lang === 'en' ? 'en' : 'es'; if (ed) render(); state(); } });
  lang = pageLang();
})();
