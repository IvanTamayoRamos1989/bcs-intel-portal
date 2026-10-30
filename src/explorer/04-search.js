
  // ---------- spatial index & global search ----------
  async function loadIndex() {
    if (S.index) return S.index;
    if (!S.indexLoading) S.indexLoading = getJSON('index.json').then(d => {
      S.index = d.rows.map(r => ({ layer: d.layers[r[0]], key: r[1], name: r[2], muni: r[3], ref: r[4], cat: r[5], pop: r[6], q: norm(`${r[2]} ${r[3]} ${r[4]} ${r[5]}`) }));
      return S.index;
    });
    return S.indexLoading;
  }
  function score(q, text, name) {
    const n = norm(name);
    if (n === q) return 100; if (n.startsWith(q)) return 80; if (n.includes(` ${q}`)) return 60; if (text.includes(q)) return 40; return 0;
  }
  async function search(qRaw) {
    const q = norm(qRaw).trim(); if (q.length < 2) return [];
    const out = [];
    for (const f of S.base.municipalities.features) { const s = score(q, norm(f.properties.name), f.properties.name); if (s) out.push({ s: s + 30, type: 'muni', label: f.properties.name, meta: 'Municipio', id: f.properties.name }); }
    for (const L of S.layers.values()) { const s = score(q, norm(`${L.meta.label} ${L.meta.unit}`), L.meta.label); if (s) out.push({ s: s + 20, type: 'layer', label: L.meta.label, meta: `Capa · ${fmt(L.meta.count)} ${L.meta.unit}`, id: L.meta.id }); }
    for (const t of S.knowledge.topics) { const s = score(q, norm(`${t.title} ${t.text} ${t.group}`), t.title); if (s) out.push({ s: s + 15, type: 'topic', label: t.title, meta: `Tema · ${t.group}`, id: t.id }); }
    const idx = await loadIndex();
    for (const r of idx) { const s = score(q, r.q, r.name); if (s) out.push({ s: s + Math.min(10, Math.log10((r.pop || 0) + 1) * 2), type: 'feature', label: r.name, meta: `${S.layers.get(r.layer).meta.label}${r.muni ? ' · ' + r.muni : ''}`, id: `${r.layer}|${r.key}` }); }
    for (const u of S.knowledge.unlocated) { const s = score(q, norm(`${u.name} ${u.kind} ${u.muni} ${u.ref || ''}`), u.name); if (s) out.push({ s: s - 5, type: 'unlocated', label: u.name, meta: `Por ubicar · ${u.kind}`, id: u.id }); }
    for (const i of S.knowledge.items) { const s = score(q, norm(`${i.title} ${i.text || ''} ${i.kind}`), i.title); if (s) out.push({ s: s - 10, type: 'item', label: i.title, meta: i.kind, href: i.url || i.href, ext: !!i.url }); }
    out.sort((a, b) => b.s - a.s);
    const cap = { muni: 5, layer: 4, topic: 5, feature: 10, unlocated: 4, item: 6 }, cnt = {};
    return out.filter(r => (cnt[r.type] = (cnt[r.type] || 0) + 1) <= cap[r.type]).slice(0, 26);
  }
  const TYPE_LABEL = { muni: 'Lugares', feature: 'En el mapa', layer: 'Capas', topic: 'Temas', unlocated: 'Información por ubicar', item: 'Documentos, noticias y conocimiento' };
  let searchSeq = 0, searchActive = -1;
  async function runSearch() {
    const input = $('#ex-search'), box = $('#ex-search-results'), seq = ++searchSeq;
    const res = await search(input.value);
    if (seq !== searchSeq) return;
    searchActive = -1;
    if (!input.value.trim()) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    const groups = {};
    res.forEach(r => (groups[r.type] = groups[r.type] || []).push(r));
    let i = 0;
    box.innerHTML = res.length ? Object.keys(TYPE_LABEL).filter(t => groups[t]).map(t => `<li class="ex-res-group" role="presentation">${TYPE_LABEL[t]}</li>` + groups[t].map(r =>
      `<li role="option" id="ex-opt-${i}" class="ex-res" data-idx="${i++}" data-type="${r.type}" data-id="${esc(r.id || '')}" data-href="${esc(r.href || '')}" data-ext="${r.ext ? 1 : ''}" aria-selected="false"><span class="ex-res-label">${esc(r.label)}</span><span class="ex-res-meta">${esc(r.meta)}</span></li>`).join('')).join('')
      : '<li class="ex-res-empty" role="presentation">Sin resultados en el inventario. Prueba otro nombre o abre «Información por ubicar».</li>';
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function pickResult(li) {
    const { type, id, href, ext } = li.dataset;
    $('#ex-search-results').hidden = true; $('#ex-search').setAttribute('aria-expanded', 'false');
    if (type === 'muni') selectMunicipality(id);
    else if (type === 'feature') { const [l, k] = id.split('|'); locate(l, k); }
    else if (type === 'layer') { setActive(id, true); openPanel('ex-capas', { focus: false }); setTimeout(() => $(`.ex-row[data-layer="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }), 50); }
    else if (type === 'topic') selectTopic(id);
    else if (type === 'unlocated') selectUnlocated(id);
    else if (type === 'item' && href) { if (ext) window.open(href, '_blank', 'noopener'); else location.href = href; }
  }
  function moveActive(d) {
    const opts = $$('#ex-search-results .ex-res'); if (!opts.length) return;
    searchActive = (searchActive + d + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === searchActive)));
    $('#ex-search').setAttribute('aria-activedescendant', opts[searchActive].id);
    opts[searchActive].scrollIntoView({ block: 'nearest' });
  }

  // ---------- inventory dialog ----------
  async function openInventory(layer = 'all', tab = 'located') {
    S.invFilter = layer; S.invTab = tab; S.invPage = 1;
    const sel = $('#ex-inv-layer');
    sel.innerHTML = '<option value="all">Todas las capas</option>' + S.order.map(id => `<option value="${id}">${esc(S.layers.get(id).meta.label)} (${fmt(S.layers.get(id).meta.count)})</option>`).join('');
    sel.value = layer;
    const usel = $('#ex-unl-kind'); const kinds = [...new Set(S.knowledge.unlocated.map(u => u.kind))];
    usel.innerHTML = '<option value="all">Todos los tipos</option>' + kinds.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    const topic = S.knowledge.topics.find(t => t.id === layer && S.knowledge.unlocated.some(u => u.topic === t.id));
    if (topic) usel.insertAdjacentHTML('beforeend', `<option value="${esc(topic.id)}">Tema: ${esc(topic.title)}</option>`);
    usel.value = kinds.includes(layer) || topic ? layer : 'all';
    openDialog('ex-inventory');
    setInvTab(tab);
    await loadIndex(); renderInventory();
  }
  function setInvTab(tab) {
    S.invTab = tab;
    $$('[data-inv-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.invTab === tab)));
    $('#ex-inv-located').hidden = tab !== 'located'; $('#ex-inv-unlocated').hidden = tab !== 'unlocated';
    renderInventory();
  }
  function renderInventory() {
    if (S.invTab === 'unlocated') {
      const k = $('#ex-unl-kind').value, q = norm($('#ex-unl-q').value);
      const rows = S.knowledge.unlocated.filter(u => (k === 'all' || u.kind === k || u.topic === k) && (!q || norm(`${u.name} ${u.muni} ${u.ref || ''}`).includes(q)));
      $('#ex-unl-count').textContent = `${fmt(rows.length)} registros sin geometría confirmada. No se dibujan en el mapa.`;
      $('#ex-unl-list').innerHTML = rows.map(u => `<li><button type="button" class="ex-rel" data-unlocated="${esc(u.id)}"><span class="ex-rel-kind">${esc(u.kind)} · ${esc(u.muni)}</span>${esc(u.name)}</button></li>`).join('');
      return;
    }
    if (!S.index) { $('#ex-inv-count').textContent = 'Cargando inventario…'; $('#ex-inv-list').innerHTML = ''; return; }
    const layer = $('#ex-inv-layer').value, q = norm($('#ex-inv-q').value);
    const rows = S.index.filter(r => (layer === 'all' || r.layer === layer) && (!q || r.q.includes(q)));
    const per = 60, pages = Math.max(1, Math.ceil(rows.length / per)); S.invPage = Math.min(S.invPage, pages);
    $('#ex-inv-count').textContent = `${fmt(rows.length)} elementos con geometría · página ${S.invPage} de ${pages}`;
    $('#ex-inv-list').innerHTML = rows.slice((S.invPage - 1) * per, S.invPage * per).map(r => `<li><span class="ex-inv-name">${esc(r.name)}</span><span class="ex-inv-meta">${esc(S.layers.get(r.layer).meta.label)}${r.muni ? ' · ' + esc(r.muni) : ''}${r.pop ? ' · ' + fmt(r.pop) + ' hab.' : ''}</span><button type="button" class="ex-btn small" data-locate="${r.layer}|${esc(r.key)}" data-close-dialog="ex-inventory">Localizar</button></li>`).join('');
    $('#ex-inv-prev').disabled = S.invPage <= 1; $('#ex-inv-next').disabled = S.invPage >= pages;
  }

  // ---------- topics dialog & help/sources ----------
  function buildTopics() {
    const groups = {};
    S.knowledge.topics.forEach(t => (groups[t.group] = groups[t.group] || []).push(t));
    $('#ex-topics-list').innerHTML = Object.entries(groups).map(([g, ts]) => `<section class="ex-topic-group"><h3>${esc(g)}</h3><ul>${ts.map(t => `<li><button type="button" class="ex-topic" data-topic="${esc(t.id)}" data-close-dialog="ex-topics"><strong>${esc(t.title)}</strong><span>${esc(t.text)}</span>${(t.layers || []).length ? `<em>${t.layers.length} capa${t.layers.length > 1 ? 's' : ''} en el mapa</em>` : '<em>Sin geometría: rama de conocimiento</em>'}</button></li>`).join('')}</ul></section>`).join('');
  }
  function buildSources() {
    const all = S.order.map(id => S.layers.get(id).meta).map(m => ({ label: m.label, n: `${fmt(m.count)} ${m.unit}`, ...m.source }))
      .concat(S.manifest.base_sources.map(b => ({ ...b, n: '' })));
    all.push({ label: 'Imagen satelital (modo Satélite)', title: 'Sentinel-2 cloudless 2016 (EOxCloudless)', owner: 'EOX IT Services GmbH · datos Copernicus Sentinel 2016 modificados', date: '2016', license: 'CC BY 4.0', resolution: '~10 m (mosaico)', method: 'Mosaico sin nubes servido por WMTS de EOX.', limits: 'Imagen de 2016: no refleja obras posteriores. Los mosaicos 2018–2025 tienen licencia no comercial (CC BY-NC-SA) y requieren licencia comercial para usarse aquí.', url: 'https://cloudless.eox.at', n: '' });
    all.push({ label: 'Luces nocturnas (modo Nocturno)', title: 'VIIRS Night Lights 2016 (Black Marble)', owner: 'NASA (GIBS / Black Marble)', date: '2016', license: 'Dominio público (NASA)', resolution: '~500 m', method: 'Compuesto anual de luz nocturna (solo luces, fondo transparente) servido por GIBS sobre el relieve.', limits: 'Mide luz emitida, no población ni consumo eléctrico. Resolución gruesa.', url: 'https://earthdata.nasa.gov/gibs', n: '' });
    $('#ex-sources-layers').innerHTML = all.map(s => `<li><details><summary><strong>${esc(s.label)}</strong>${s.n ? ` · ${esc(s.n)}` : ''}<span>${esc(s.owner)} · ${esc(s.date)}</span></summary><dl class="ex-attrs">
      <div class="ex-attr"><dt>Fuente</dt><dd>${esc(s.title)}</dd></div><div class="ex-attr"><dt>Licencia</dt><dd>${esc(s.license)}</dd></div>
      <div class="ex-attr"><dt>Resolución</dt><dd>${esc(s.resolution)}</dd></div><div class="ex-attr"><dt>Método</dt><dd>${esc(s.method)}</dd></div>
      <div class="ex-attr"><dt>Límites</dt><dd>${esc(s.limits)}</dd></div></dl>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Consultar fuente</a>` : ''}</details></li>`).join('');
  }

  // ---------- chat docking (same widget and /api/chat) ----------
  function contextPlace() {
    const names = S.selection?.munis?.length ? S.selection.munis : [];
    const name = names[0] || (S.ready ? muniAt(S.map.getCenter()) : null);
    if (name === 'Mulegé' && S.ready) { const c = S.map.getCenter(); if (c.lat < 27.0 && c.lng > -112.3) return 'mulege_north'; }
    return name ? PLACE[name] || null : null;
  }
  function hookPlace() {
    const orig = window.BCSPlace;
    if (!orig || orig.__explorar) return;
    window.BCSPlace = Object.assign({}, orig, { __explorar: true, get: () => (S.chatContextPlace || (orig.get ? orig.get() : null)) });
  }
  function openChat(prefill) {
    if (!window.BCSChat) { toast('El asistente aún se está cargando. Inténtalo de nuevo en un momento.'); return; }
    document.body.classList.add('chat-open'); S.chatOpen = true;
    $('#ex-chat-btn').setAttribute('aria-expanded', 'true');
    S.chatContextPlace = contextPlace();
    window.BCSChat.open();
    if (prefill) window.BCSChat.prefill(prefill);
  }
  function closeChat() {
    document.body.classList.remove('chat-open'); S.chatOpen = false;
    $('#ex-chat-btn').setAttribute('aria-expanded', 'false');
    window.BCSChat?.close();
  }
  function askAbout() {
    const s = S.selection; if (!s) { openChat(); return; }
    let text = '';
    if (s.type === 'feature') {
      const L = S.layers.get(s.layer), p = L.byKey.get(s.key).properties, m = mainMetric(L, p);
      const keep = ['NOM_LOC', 'POBTOT', 'CAT_MANEJO', 'SUPERFICIE', 'CLAVE_UGA', 'CLASIFICAC', 'highway', 'ref', 'voltage', 'operator', 'plant:source', 'generator:source', 'ORD_STRA', 'NOM_NUC'];
      const attrs = keep.filter(k => p[k] !== undefined && p[k] !== '').map(k => `${LABELS[k] || k}: ${k === 'voltage' ? formatVoltage(p[k]) : p[k]}`).join('; ');
      text = `Sobre «${s.name}» (${L.meta.label}${s.munis.length ? `, municipio de ${s.munis.join(' / ')}` : ''}${m ? `; ${m.v} ${m.l}` : ''}${attrs ? `; ${attrs}` : ''}): ¿qué dice el portal y qué implicaciones tiene para el territorio?`;
    } else if (s.type === 'muni') text = `¿Cuáles son los principales retos y oportunidades territoriales de ${s.name} según el portal?`;
    else if (s.type === 'topic') text = `Resume lo que sabe el portal sobre ${s.name} en Baja California Sur y sus principales fuentes.`;
    else text = `¿Qué sabe el portal sobre «${s.name}»?`;
    openChat(text);
  }
  function askZone() {
    if (!S.ready) return;
    const name = muniAt(S.map.getCenter());
    if (!name) { toast('El centro de la vista está en el mar o fuera de BCS. Mueve el mapa sobre un municipio.'); return; }
    S.selection = S.selection || null;
    openChat(`¿Qué está pasando en ${name} (zona que estoy viendo en el mapa): agua, energía, crecimiento y ordenamiento? Indica las fuentes.`);
    S.chatContextPlace = PLACE[name] || null;
  }
  let chipDict = null;
  async function buildChipDict() {
    if (chipDict) return chipDict;
    await loadIndex();
    const d = [];
    for (const f of S.base.municipalities.features) d.push({ re: f.properties.name, type: 'muni', id: f.properties.name, label: f.properties.name });
    for (const r of S.index) {
      if (r.layer === 'cities' && (r.pop || 0) >= 1000 && r.name.length >= 5) d.push({ re: r.name, type: 'feature', id: `${r.layer}|${r.key}`, label: r.name, pop: r.pop });
      if ((r.layer === 'protected' || r.layer === 'priority') && r.name.length >= 5) d.push({ re: r.name, type: 'feature', id: `${r.layer}|${r.key}`, label: r.name });
      if ((r.layer === 'substations' || r.layer === 'plants') && !/sin nombre/i.test(r.name) && r.name.length >= 4) d.push({ re: r.name, prefix: r.layer === 'substations' ? 'subestaci[oó]n' : 'central', type: 'feature', id: `${r.layer}|${r.key}`, label: r.name });
      if (r.layer === 'transport' && /^[A-Z]{3}$/.test(r.ref || '')) d.push({ re: r.ref, exact: true, type: 'feature', id: `${r.layer}|${r.key}`, label: `${r.name} (${r.ref})` });
    }
    // longest names first so "Cabo San Lucas" wins over "San Lucas"
    const seen = new Set();
    chipDict = d.sort((a, b) => b.re.length - a.re.length || (b.pop || 0) - (a.pop || 0)).filter(x => { const k = norm(x.re) + x.type; if (seen.has(k)) return false; seen.add(k); return true; });
    return chipDict;
  }
  async function addChips(detail) {
    const bubble = detail?.bubble; if (!bubble || !detail.answer) return;
    const dict = await buildChipDict();
    let text = String(detail.answer); const hits = [];
    const nText = norm(text);
    let masked = nText;
    for (const e of dict) {
      if (hits.length >= 8) break;
      const term = e.exact ? e.re : norm(e.re);
      const src = e.exact ? text : masked;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${e.prefix ? `(?:${norm(e.prefix)})\\s+(?:de\\s+)?` : ''}${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u');
      const m = src.match(re);
      if (!m) continue;
      hits.push(e);
      if (!e.exact) masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
    }
    if (!hits.length) return;
    const wrap = document.createElement('div'); wrap.className = 'ex-chat-chips';
    wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Localizar en el mapa lo mencionado');
    wrap.innerHTML = `<span class="ex-chat-chips-label">Localizar en el mapa</span>` + hits.map(h => `<button type="button" class="ex-chip" data-chip-type="${h.type}" data-chip-id="${esc(h.id)}">${esc(h.label)}</button>`).join('');
    bubble.appendChild(wrap);
  }
