/* BCS 2050 chat rich renderer (2026-10-26). Tiny, safe markdown subset + media blocks.
   Model text is never injected as HTML: everything is built with DOM nodes / textContent. */
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeHref(h) {
    h = String(h || '').trim();
    if (/^https?:\/\//i.test(h)) return h;
    if (/^\/(?!\/)[^\s]*$/.test(h)) return h;
    return null;
  }
  function isExternal(h) { return /^https?:\/\//i.test(h) && h.indexOf(location.origin) !== 0; }
  function mkLink(href, label) {
    var a = el('a', 'bcs-rt-link', label);
    a.href = href;
    if (isExternal(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }
  // Inline: **bold**, *em*, `code`, [label](url), bare http(s) URLs and internal /paths
  var INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])|((?:^|(?<=[\s(]))\/(?:[a-z0-9_-]+\/?)+(?:\?[^\s)]*)?(?:#[\w-]+)?)|(\*([^*\s][^*]*)\*)/gi;
  function inline(parent, text) {
    text = String(text || '');
    var last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) parent.appendChild(el('strong', null, m[2]));
      else if (m[3]) parent.appendChild(el('code', null, m[4]));
      else if (m[5]) { var h = safeHref(m[7]); parent.appendChild(h ? mkLink(h, m[6]) : document.createTextNode(m[6])); }
      else if (m[8]) parent.appendChild(mkLink(m[8], m[8].replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)));
      else if (m[9]) { var p = m[9]; parent.appendChild(p.length > 1 ? mkLink(p, p) : document.createTextNode(p)); }
      else if (m[10]) parent.appendChild(el('em', null, m[11]));
      last = INLINE.lastIndex;
      if (m[0].length === 0) INLINE.lastIndex++;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.trim(); });
  }
  function isSep(line) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line); }
  function tableEl(title, headers, rows) {
    var wrap = el('div', 'bcs-rt-table-wrap');
    if (title) wrap.appendChild(el('div', 'bcs-rt-table-title', title));
    var t = el('table', 'bcs-rt-table');
    if (headers && headers.length) {
      var th = el('thead'), tr = el('tr');
      headers.forEach(function (h) { var c = el('th'); inline(c, h); tr.appendChild(c); });
      th.appendChild(tr); t.appendChild(th);
    }
    var tb = el('tbody');
    (rows || []).forEach(function (r) {
      var tr = el('tr');
      (r || []).forEach(function (v) { var c = el('td'); inline(c, v == null ? '' : String(v)); if (/^[\s+\-−~≈]?[\d.,]+\s*(%|mw|hm3|hab)?/i.test(String(v))) c.className = 'num'; tr.appendChild(c); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }
  function renderMarkdown(text) {
    var root = el('div', 'bcs-rt');
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var i = 0, para = [];
    function flush() {
      if (!para.length) return;
      var p = el('p'); inline(p, para.join(' ')); root.appendChild(p); para = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*```/.test(line)) { // fenced block → if it is a pipe table, render as table; else <pre>
        flush(); var buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        if (buf.length > 1 && /\|/.test(buf[0]) && isSep(buf[1] || '')) root.appendChild(tableEl(null, splitRow(buf[0]), buf.slice(2).map(splitRow)));
        else root.appendChild(el('pre', 'bcs-rt-pre', buf.join('\n')));
        continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush(); var head = splitRow(line); i += 2; var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
        root.appendChild(tableEl(null, head, rows));
        continue;
      }
      var h = line.match(/^\s*#{1,4}\s+(.*)$/);
      if (h) { flush(); var hh = el('p', 'bcs-rt-h'); inline(hh, h[1]); root.appendChild(hh); i++; continue; }
      var gap = line.match(/^\s*\**\s*(Dato faltante|Data[- ]gap)\s*:?\**\s*:?\s*(.*)$/i);
      if (gap) { flush(); var g = el('p', 'bcs-rt-gap'); g.appendChild(el('strong', null, gap[1] + ': ')); inline(g, gap[2]); root.appendChild(g); i++; continue; }
      var nx = line.match(/^\s*\**\s*👉\s*(.*)$/);
      if (nx) { flush(); var np = el('p', 'bcs-rt-next'); inline(np, nx[1].replace(/\*+\s*$/, '')); root.appendChild(np); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        flush(); var ordered = /^\s*\d/.test(line); var list = el(ordered ? 'ol' : 'ul');
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          var li = el('li'); inline(li, lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); list.appendChild(li); i++;
        }
        root.appendChild(list); continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line.trim()); i++;
    }
    flush();
    return root;
  }
  function fmt(v, en) { try { return Number(v).toLocaleString(en ? 'en-US' : 'es-MX'); } catch (e) { return String(v); } }
  function chartEl(b, en) {
    var box = el('figure', 'bcs-rb-chart');
    box.appendChild(el('figcaption', 'bcs-rb-chart-t', b.title || ''));
    var vals = b.series.map(function (s) { return Math.abs(Number(s.value) || 0); });
    var max = Math.max.apply(null, vals.concat([1]));
    b.series.forEach(function (s, i) {
      var v = Number(s.value) || 0;
      var row = el('div', 'bcs-rb-bar' + (v < 0 ? ' neg' : ''));
      row.appendChild(el('span', 'bcs-rb-bar-l', s.label));
      var track = el('span', 'bcs-rb-bar-track');
      var fill = el('span', 'bcs-rb-bar-fill');
      fill.style.setProperty('--w', (Math.abs(v) / max * 100).toFixed(1) + '%');
      fill.style.animationDelay = (i * 80) + 'ms';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('span', 'bcs-rb-bar-v', (v > 0 && b.signed ? '+' : '') + fmt(v, en)));
      box.appendChild(row);
    });
    if (b.source) box.appendChild(el('span', 'bcs-rb-chart-src', (en ? 'Source: ' : 'Fuente: ') + b.source + (b.unit ? ' · ' + b.unit : '')));
    return box;
  }
  function renderBlocks(blocks, lang) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    var en = lang === 'en';
    var wrap = el('div', 'bcs-rb');
    var media = el('div', 'bcs-rb-media');
    var links = el('div', 'bcs-rb-links');
    blocks.forEach(function (b) {
      if (!b || !b.type) return;
      if (b.type === 'table' && Array.isArray(b.rows) && b.rows.length) {
        wrap.appendChild(tableEl(b.title, b.headers || [], b.rows));
      } else if (b.type === 'chart' && Array.isArray(b.series) && b.series.length) {
        wrap.appendChild(chartEl(b, en));
      } else if ((b.type === 'image' || b.type === 'map') && safeHref(b.thumb || b.src)) {
        var fig = el('figure', 'bcs-rb-card bcs-rb-' + b.type);
        var href = safeHref(b.full || b.href) || safeHref(b.thumb || b.src);
        var ia = el('a', 'bcs-rb-img'); ia.href = href; if (b.full) { ia.target = '_blank'; ia.rel = 'noopener'; }
        var img = el('img'); img.src = b.thumb || b.src; img.alt = b.alt || b.title || ''; img.loading = 'lazy'; img.decoding = 'async';
        img.onerror = function () { fig.remove(); };
        ia.appendChild(img); fig.appendChild(ia);
        var cap = el('figcaption');
        cap.appendChild(el('span', 'bcs-rb-kind', b.type === 'map' ? (en ? 'Map' : 'Mapa') : (en ? 'Aerial view' : 'Vista aérea')));
        cap.appendChild(el('strong', null, b.title || b.caption || b.alt || ''));
        if (b.title && b.caption) cap.appendChild(el('span', 'bcs-rb-cap', b.caption));
        var row = el('span', 'bcs-rb-acts');
        if (safeHref(b.href)) row.appendChild(mkLink(b.href, b.type === 'map' ? (en ? 'See in maps →' : 'Ver en mapas →') : (en ? 'See in atlas →' : 'Ver en explorar →')));
        if (safeHref(b.maps_url)) row.appendChild(mkLink(b.maps_url, 'Google Maps ↗'));
        cap.appendChild(row); fig.appendChild(cap);
        media.appendChild(fig);
      } else if (b.type === 'map' && safeHref(b.href)) {
        var a = el('a', 'bcs-rb-pill bcs-rb-pill-map'); a.href = b.href;
        a.appendChild(el('span', null, '🗺️ ')); a.appendChild(document.createTextNode(b.title || (en ? 'Open map' : 'Abrir mapa')));
        links.appendChild(a);
      } else if (b.type === 'link' && safeHref(b.href)) {
        var l = el('a', 'bcs-rb-pill'); l.href = b.href;
        if (isExternal(b.href)) { l.target = '_blank'; l.rel = 'noopener noreferrer'; }
        l.appendChild(el('span', null, b.kind === 'document' ? '📄 ' : '🔗 '));
        var lab = String(b.label || b.href); if (lab.length > 70) lab = lab.slice(0, 68) + '…';
        l.appendChild(document.createTextNode(lab));
        links.appendChild(l);
      }
    });
    if (media.childNodes.length) wrap.appendChild(media);
    if (links.childNodes.length) wrap.appendChild(links);
    return wrap.childNodes.length ? wrap : null;
  }
  window.BCSChatRender = { renderMarkdown: renderMarkdown, renderBlocks: renderBlocks };
})();
