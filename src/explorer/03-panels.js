
  // ---------- panels: focus management, Escape keeps map state ----------
  function openPanel(id, { focus = true } = {}) {
    const p = document.getElementById(id); if (!p) return;
    if (!p.hidden && p.classList.contains('open')) { if (focus) focusIn(p); return; }
    S.lastFocus = document.activeElement;
    p.hidden = false; requestAnimationFrame(() => p.classList.add('open'));
    document.body.classList.add(`${id}-open`);
    $$(`[aria-controls="${id}"]`).forEach(b => b.setAttribute('aria-expanded', 'true'));
    if (focus) focusIn(p);
  }
  function focusIn(p) {
    const t = p.querySelector('[data-autofocus]') || p.querySelector('h2[tabindex], h1[tabindex]') || p.querySelector('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (t) setTimeout(() => t.focus({ preventScroll: true }), 30);
  }
  function closePanel(id, { restore = true } = {}) {
    const p = document.getElementById(id); if (!p || p.hidden) return;
    p.classList.remove('open'); document.body.classList.remove(`${id}-open`);
    $$(`[aria-controls="${id}"]`).forEach(b => b.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!p.classList.contains('open')) p.hidden = true; }, dur(220));
    if (id === 'ex-ficha') { document.body.classList.remove('ficha-wide'); clearSelectionHighlight(); S.selection = null; S.history = []; }
    if (restore && S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus({ preventScroll: true });
    else if (restore) $('#ex-map-focus')?.focus({ preventScroll: true });
  }
  function openDialog(id) {
    const d = document.getElementById(id); if (!d) return;
    S.lastFocus = document.activeElement;
    if (!d.open) d.showModal();
    focusIn(d);
  }

  // ---------- Capas panel ----------
  function buildLayerPanel() {
    const host = $('#ex-groups'); host.innerHTML = '';
    for (const g of S.manifest.groups) {
      const ids = S.order.filter(id => S.layers.get(id).meta.group === g.id);
      const missing = (S.manifest.missing || []).filter(x => x.group === g.id);
      const det = document.createElement('details'); det.className = 'ex-group'; det.open = true; det.dataset.group = g.id;
      det.innerHTML = `<summary><span class="ex-group-title">${esc(g.label)}</span><span class="ex-group-count" data-group-count="${g.id}"></span></summary>
        <ul class="ex-rows" role="list">${ids.map(id => rowHTML(S.layers.get(id))).join('')}${missing.map(x => `
          <li class="ex-row is-missing"><div class="ex-row-main"><span class="ex-swatch" data-kind="none" aria-hidden="true"></span>
          <span class="ex-row-text"><span class="ex-row-name">${esc(x.label)}</span><span class="ex-row-meta">${fmt(x.count)} registros sin polígono oficial</span></span>
          <button type="button" class="ex-chip-btn" data-open-unlocated="${esc(x.id)}">Por ubicar</button></div>
          <p class="ex-row-note">${esc(x.note)}</p></li>`).join('')}</ul>`;
      host.appendChild(det);
    }
    renderLayerRows();
  }
  function swatch(L) {
    const id = L.meta.id, [c0, c1] = COLORS[id];
    if (L.meta.geom === 'line') return `<span class="ex-swatch line${DASH[id] ? ' dashed' : ''}" style="--c:${c0}" aria-hidden="true"></span>`;
    if (L.meta.geom === 'polygon') return `<span class="ex-swatch poly${DASH[id] ? ' dashed' : ''}" style="--c:${c0};--f:${c1}" aria-hidden="true"></span>`;
    return `<span class="ex-swatch point" style="--c:${c0};--f:${c1}" aria-hidden="true"></span>`;
  }
  function rowHTML(L) {
    const m = L.meta, badge = m.source.owner.includes('OpenStreetMap') ? '<span class="ex-badge">OSM · parcial</span>' : m.id === 'runoff' ? '<span class="ex-badge">Modelo</span>' : '';
    return `<li class="ex-row" data-layer="${m.id}">
      <div class="ex-row-main">${swatch(L)}
        <span class="ex-row-text"><span class="ex-row-name" id="lbl-${m.id}">${esc(m.label_ciudadano || m.label)}</span>
        ${m.que_significa ? `<span class="ex-row-what">${esc(m.que_significa)}</span>` : ''}
        <span class="ex-row-meta">${fmt(m.count)} ${esc(m.unit)} ${badge}</span></span>
        <button type="button" class="ex-toggle" data-toggle="${m.id}" aria-pressed="false" aria-labelledby="lbl-${m.id}"><span class="ex-toggle-track" aria-hidden="true"><span class="ex-toggle-dot"></span></span><span class="sr-only">Mostrar capa</span></button>
      </div>
      <div class="ex-row-extra">
        <label class="ex-opacity"><span>Opacidad</span><input type="range" min="10" max="100" step="5" value="100" data-opacity="${m.id}" aria-label="Opacidad de ${esc(m.label)}"><output data-opacity-out="${m.id}">100 %</output></label>
        <span class="ex-row-actions"><button type="button" class="ex-link-btn" data-inventory="${m.id}">Inventario</button><button type="button" class="ex-link-btn" data-layer-source="${m.id}">Fuente</button></span>
      </div>
    </li>`;
  }
  function renderLayerRows() {
    if (!S.manifest) return;
    let active = 0;
    for (const L of S.layers.values()) {
      const row = $(`.ex-row[data-layer="${L.meta.id}"]`); if (L.active) active++;
      if (!row) continue;
      row.classList.toggle('is-active', !!L.active); row.classList.toggle('is-loading', !!(L.active && !L.data));
      const b = row.querySelector('[data-toggle]'); b.setAttribute('aria-pressed', String(!!L.active));
      b.querySelector('.sr-only').textContent = L.active ? 'Ocultar capa' : 'Mostrar capa';
    }
    for (const g of S.manifest.groups) {
      const n = S.order.filter(id => S.layers.get(id).meta.group === g.id && S.layers.get(id).active).length;
      const el = $(`[data-group-count="${g.id}"]`); if (el) el.textContent = n ? `${n} activas` : '';
    }
    const c = $('#ex-capas-count'); if (c) { c.textContent = active; c.hidden = !active; }
    const presetOn = Object.entries(S.manifest.presets).find(([, ids]) => ids.length === active && ids.every(id => S.layers.get(id)?.active));
    $$('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(!!presetOn && presetOn[0] === b.dataset.preset)));
    renderLegend();
  }
  function renderLegend() {
    const host = $('#ex-legend'); if (!host) return;
    const act = S.order.map(id => S.layers.get(id)).filter(L => L.active);
    host.hidden = !act.length;
    host.innerHTML = act.length ? `<p class="ex-legend-title">En el mapa</p><ul>${act.map(L => `<li>${swatch(L)}<span>${esc(L.meta.label_ciudadano || L.meta.label)}</span></li>`).join('')}</ul>` : '';
  }

  // ---------- selection & context panel ----------
  function setSelectionHighlight(f) {
    if (!S.ready) return;
    S.map.getSource('sel').setData({ type: 'FeatureCollection', features: f ? [{ type: 'Feature', properties: {}, geometry: f.geometry }] : [] });
  }
  function clearSelectionHighlight() { setSelectionHighlight(null); }
  function frame(geom, { maxZoom = 12.5 } = {}) {
    if (!S.ready || !geom) return;
    const pad = framePadding();
    if (geom.type === 'Point') S.map.flyTo({ center: geom.coordinates, zoom: Math.max(S.map.getZoom(), Math.min(maxZoom, 11.5)), pitch: Math.max(S.map.getPitch(), 45), padding: pad, duration: dur(1400), essential: true });
    else S.map.fitBounds(bboxOf(geom), { padding: pad, maxZoom, duration: dur(1400), pitch: Math.max(S.map.getPitch(), 40) });
  }
  function framePadding() {
    const r = document.body.classList.contains('ex-ficha-open') && !isMobile() ? Math.min($('#ex-ficha').offsetWidth, innerWidth * 0.6) : 0;
    const l = document.body.classList.contains('ex-capas-open') && !isMobile() ? $('#ex-capas').offsetWidth : 0;
    const b = isMobile() && (document.body.classList.contains('ex-ficha-open') || document.body.classList.contains('ex-capas-open')) ? innerHeight * 0.55 : 0;
    const chat = document.body.classList.contains('chat-open') && !isMobile() ? 340 : 0;
    return { top: 80, bottom: 60 + b, left: 40 + l, right: 40 + Math.max(r, chat) };
  }
  function attrRows(props) {
    return Object.entries(props).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== '' && v !== undefined && !['osm_url'].includes(k))
      .map(([k, v]) => {
        let val = Array.isArray(v) ? v.join(', ') : v;
        if (k === 'voltage') val = `${formatVoltage(v)} (etiqueta original: ${v})`;
        else if (typeof v === 'number') val = fmt(v, 4);
        return `<div class="ex-attr"><dt>${esc(LABELS[k] || k)}</dt><dd>${esc(val)}</dd></div>`;
      }).join('');
  }
  function mainMetric(L, p) {
    const id = L.meta.id;
    if (id === 'cities') return p.pop ? { v: fmt(p.pop), l: 'habitantes (Censo 2020)' } : null;
    if (id === 'substations' || id === 'transmission') return p.voltage ? { v: formatVoltage(p.voltage), l: 'tensión etiquetada en OSM' } : { v: 'Sin dato', l: 'tensión no etiquetada en OSM' };
    if (id === 'plants' || id === 'generators') { const o = p['plant:output:electricity'] || p['generator:output:electricity']; return o ? { v: o, l: 'potencia etiquetada en OSM (no verificada)' } : { v: 'Sin dato', l: 'potencia no etiquetada en OSM' }; }
    if (id === 'protected') return p.SUPERFICIE ? { v: `${fmt(p.SUPERFICIE)} ha`, l: p.S_MARINA ? `superficie de la fuente · ${fmt(100 * p.S_MARINA / p.SUPERFICIE)} % marina` : 'superficie de la fuente' } : null;
    if (id === 'zoning') return p.sup_Ha ? { v: `${fmt(p.sup_Ha)} ha`, l: 'superficie de la fuente' } : null;
    if (id === 'agrarian') return null;
    if (id === 'rivers') return p.LENGTH_KM ? { v: `${fmt(p.LENGTH_KM, 1)} km`, l: `tramo · orden Strahler ${p.ORD_STRA ?? 's/d'}` } : null;
    if (id === 'runoff') return p.FULL_PATH_KM ? { v: `${fmt(p.FULL_PATH_KM, 1)} km`, l: 'longitud de la trayectoria modelada' } : null;
    if (id === 'roads') return p.ref ? { v: p.ref, l: 'referencia de la vía' } : null;
    return null;
  }
  function sourceBlock(src) {
    return `<section class="ex-sec ex-source"><h3>Fuente y método</h3><dl class="ex-attrs">
      <div class="ex-attr"><dt>Fuente</dt><dd>${esc(src.title)} · ${esc(src.owner)}</dd></div>
      <div class="ex-attr"><dt>Fecha</dt><dd>${esc(src.date)}</dd></div>
      <div class="ex-attr"><dt>Licencia</dt><dd>${esc(src.license)}</dd></div>
      <div class="ex-attr"><dt>Resolución</dt><dd>${esc(src.resolution)}</dd></div>
      <div class="ex-attr"><dt>Método</dt><dd>${esc(src.method)}</dd></div>
      <div class="ex-attr"><dt>Límites</dt><dd>${esc(src.limits)}</dd></div></dl>
      ${src.url ? `<a class="ex-btn ghost" href="${esc(src.url)}" target="_blank" rel="noopener">Consultar fuente</a>` : ''}</section>`;
  }
  function relationsBlock(layerId, extra = []) {
    const rel = (S.knowledge.relations.layer[layerId] || []).concat(extra);
    if (!rel.length) return '';
    return `<section class="ex-sec"><h3>Conexiones</h3><p class="ex-fine">Relaciones editoriales declaradas en los datos; ninguna se deduce por cercanía.</p><ul class="ex-links">${rel.map(([kind, id, label]) => {
      if (kind === 'layer') return `<li><button type="button" class="ex-rel" data-rel-layer="${esc(id)}"><span class="ex-rel-kind">Capa</span>${esc(label)}</button></li>`;
      if (kind === 'topic') { const t = S.knowledge.topics.find(x => x.id === id); return t ? `<li><button type="button" class="ex-rel" data-topic="${esc(id)}"><span class="ex-rel-kind">Conexión temática</span>${esc(label || t.title)}</button></li>` : ''; }
      if (kind === 'href') return `<li><a class="ex-rel" href="${esc(id)}"><span class="ex-rel-kind">Página</span>${esc(label)}</a></li>`;
      return '';
    }).join('')}</ul></section>`;
  }
  function showFicha(html, sel) {
    if (S.selection && sel && S.selection.key !== sel.key) S.history.push(S.selection);
    S.selection = sel;
    const body = $('#ex-ficha-body'); body.innerHTML = html; body.scrollTop = 0;
    $('#ex-back').hidden = !S.history.length;
    if (!isMobile() && innerWidth < 1500 && document.body.classList.contains('ex-capas-open')) closePanel('ex-capas', { restore: false });
    openPanel('ex-ficha');
    const h = body.querySelector('h2'); if (h) { h.tabIndex = -1; setTimeout(() => h.focus({ preventScroll: true }), 40); }
  }
  function featureMunis(L, p) {
    if (p.NOM_MUN) return { list: [p.NOM_MUN], how: 'atributo de la fuente' };
    if (p.MUNICIPIO) return { list: [p.MUNICIPIO], how: 'atributo de la fuente' };
    if (p._munis?.length) return { list: p._munis, how: 'cruce espacial con polígonos municipales INEGI' };
    return { list: [], how: '' };
  }
  function selectFeature(layerId, key, { fly = false, from = 'map' } = {}) {
    const L = S.layers.get(layerId), f = L?.byKey?.get(key); if (!f) return;
    const p = f.properties, m = mainMetric(L, p), mu = featureMunis(L, p), src = L.meta.source;
    const osm = src.owner.includes('OpenStreetMap');
    const badges = [osm ? '<span class="ex-badge">OSM · parcial / comunitario</span>' : '', p._marine >= 0.5 ? '<span class="ex-badge water">Área marina</span>' : '', layerId === 'runoff' ? '<span class="ex-badge">Modelo de terreno</span>' : ''].join('');
    let ctx = '';
    if (layerId === 'cities' && mu.list[0] && S.knowledge.municipal[mu.list[0]]) {
      const M = S.knowledge.municipal[mu.list[0]];
      ctx = `<p class="ex-note">Contexto municipal (no es dato de la localidad): ${esc(M.name)} suma ${fmt(M.pop)} habitantes en ${fmt(M.locs)} localidades (Censo 2020).</p>`;
    }
    if (['plants', 'substations', 'generators', 'transmission'].includes(layerId)) ctx += '<p class="ex-note">Localidad: no se asigna por cercanía. La pertenencia municipal sale del cruce espacial con el polígono INEGI.</p>';
    if (p._geom_note) ctx += `<p class="ex-note">${esc(p._geom_note)}</p>`;
    if (p._marine >= 0.5) ctx += `<p class="ex-note">Según la superficie de la fuente, el ${fmt(100 * (p.S_MARINA && p.SUPERFICIE ? p.S_MARINA / p.SUPERFICIE : p._marine))} % del polígono es marino: se dibuja sobre el mar porque así está decretado.</p>`;
    const saved = S.saved.some(s => s.key === key);
    const gc = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
    const gm = gc ? `<a class="ex-btn ghost" href="https://www.google.com/maps/search/?api=1&query=${gc[1].toFixed(6)},${gc[0].toFixed(6)}" target="_blank" rel="noopener">Abrir en Google Maps</a><a class="ex-btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${gc[1].toFixed(6)},${gc[0].toFixed(6)}" target="_blank" rel="noopener">Cómo llegar</a>` : '';
    const html = `<p class="ex-kicker">${esc(L.meta.label_ciudadano || L.meta.label)} ${badges}</p>
      <h2>${esc(p._n)}</h2>
      <p class="ex-lead">${esc(DESCR[layerId])}</p>
      ${m ? `<div class="ex-metric"><strong>${esc(m.v)}</strong><span>${esc(m.l)}</span></div>` : ''}
      ${mu.list.length ? `<p class="ex-muni"><span>Municipio</span> ${mu.list.map(x => `<button type="button" class="ex-inline" data-muni="${esc(x)}">${esc(x)}</button>`).join(', ')} <em>(${esc(mu.how)})</em></p>` : ''}
      ${ctx}
      <div class="ex-actions">
        <button type="button" class="ex-btn" data-locate="${esc(layerId)}|${esc(key)}">Localizar</button>
        <button type="button" class="ex-btn ghost" data-locate-layer="${esc(layerId)}">Localizar capa</button>
        <button type="button" class="ex-btn ghost" data-save="${esc(layerId)}|${esc(key)}" aria-pressed="${saved}">${saved ? 'Guardado' : 'Guardar hallazgo'}</button>
        <button type="button" class="ex-btn accent" data-ask="feature">Preguntar sobre esto</button>
        ${gm}
      </div>
      ${relationsBlock(layerId)}
      <section class="ex-sec"><h3>Atributos originales</h3><dl class="ex-attrs">${attrRows(p)}</dl>
      ${p.osm_url ? `<a class="ex-btn ghost" href="${esc(p.osm_url)}" target="_blank" rel="noopener">Ver objeto en OpenStreetMap</a>` : ''}</section>
      ${sourceBlock(src)}`;
    showFicha(html, { type: 'feature', layer: layerId, key, name: p._n, munis: mu.list, from });
    setSelectionHighlight(f);
    if (fly) frame(f.geometry);
  }
  function selectMunicipality(name, { fly = true } = {}) {
    const f = S.base.municipalities.features.find(x => x.properties.name === name); if (!f) return;
    const M = S.knowledge.municipal[name] || {};
    const items = S.knowledge.items.filter(i => (i.munis || []).includes(name)).slice(0, 12);
    const html = `<p class="ex-kicker">Municipio</p><h2>${esc(name)}</h2>
      ${M.pop ? `<div class="ex-metric"><strong>${fmt(M.pop)}</strong><span>habitantes · ${fmt(M.locs)} localidades (Censo 2020)</span></div>` : ''}
      ${M.cabecera ? `<p class="ex-muni"><span>Cabecera</span> ${esc(M.cabecera)}${M.cab_pop ? ` · ${fmt(M.cab_pop)} hab.` : ''}</p>` : ''}
      ${M.strengths ? `<section class="ex-sec"><h3>Lectura del portal (interpretación)</h3><p><strong>Fortalezas:</strong> ${esc(M.strengths)}</p><p><strong>Restricciones:</strong> ${esc(M.locks)}</p><p class="ex-fine">${esc(M.source || '')}</p></section>` : ''}
      <div class="ex-actions">
        <button type="button" class="ex-btn" data-locate-muni="${esc(name)}">Localizar</button>
        <button type="button" class="ex-btn accent" data-ask="feature">Preguntar sobre esto</button>
        ${M.studio ? `<a class="ex-btn ghost" href="${esc(M.studio)}">Ficha municipal</a>` : ''}
        ${M.place ? `<a class="ex-btn ghost" href="/foresights/?place=${esc(M.place)}">Prospectiva</a><a class="ex-btn ghost" href="/crecimiento/?place=${esc(M.place)}">Crecimiento</a>` : ''}
      </div>
      ${items.length ? `<section class="ex-sec"><h3>Relacionado en el portal</h3><ul class="ex-links">${items.map(itemLi).join('')}</ul></section>` : ''}
      ${sourceBlock(S.manifest.base_sources.find(b => b.id === 'boundary'))}`;
    showFicha(html, { type: 'muni', key: `muni-${name}`, name, munis: [name] });
    setSelectionHighlight(f);
    if (fly) frame(f.geometry, { maxZoom: 9 });
    refreshGemeloLink();
  }
  function itemLi(i) {
    const href = i.url || i.href;
    const ext = i.url ? ' target="_blank" rel="noopener"' : '';
    return `<li><a class="ex-rel" href="${esc(href)}"${ext}><span class="ex-rel-kind">${esc(i.kind)}</span>${esc(i.title)}${i.text ? `<small>${esc(i.text)}</small>` : ''}</a></li>`;
  }
  function selectTopic(id) {
    const t = S.knowledge.topics.find(x => x.id === id); if (!t) return;
    const items = S.knowledge.items.filter(i => i.topic === id).slice(0, 14);
    const unl = S.knowledge.unlocated.filter(u => u.topic === id);
    const layers = (t.layers || []).map(l => S.layers.get(l)).filter(Boolean);
    const html = `<p class="ex-kicker">Tema · ${esc(t.group)}</p><h2>${esc(t.title)}</h2><p class="ex-lead">${esc(t.text)}</p>
      <div class="ex-actions"><a class="ex-btn" href="${esc(t.href)}">Abrir sección</a><button type="button" class="ex-btn accent" data-ask="feature">Preguntar sobre esto</button></div>
      ${layers.length ? `<section class="ex-sec"><h3>Capas con geometría</h3><ul class="ex-links">${layers.map(L => `<li><button type="button" class="ex-rel" data-rel-layer="${L.meta.id}"><span class="ex-rel-kind">${L.active ? 'Activa' : 'Instalar'}</span>${esc(L.meta.label)} · ${fmt(L.meta.count)} ${esc(L.meta.unit)}</button></li>`).join('')}</ul></section>`
        : '<p class="ex-note">Este tema no tiene geometría verificada: no se dibuja en el mapa. Se consulta como rama de conocimiento.</p>'}
      ${unl.length ? `<section class="ex-sec"><h3>Información por ubicar (${fmt(unl.length)})</h3><p class="ex-fine">Registros sin geometría confirmada; no se dibujan.</p><button type="button" class="ex-btn ghost" data-open-unlocated="${esc(id)}">Ver lista</button></section>` : ''}
      ${items.length ? `<section class="ex-sec"><h3>En el portal</h3><ul class="ex-links">${items.map(itemLi).join('')}</ul></section>` : ''}`;
    showFicha(html, { type: 'topic', key: `topic-${id}`, name: t.title, topic: id, munis: [] });
    clearSelectionHighlight();
  }
  function selectUnlocated(id) {
    const u = S.knowledge.unlocated.find(x => x.id === id); if (!u) return;
    const html = `<p class="ex-kicker">Información por ubicar · ${esc(u.kind)}</p><h2>${esc(u.name)}</h2>
      ${u.metric ? `<div class="ex-metric"><strong>${esc(u.metric)}</strong><span>dato de la fuente</span></div>` : ''}
      <p class="ex-note">${esc(u.reason)}</p>
      <dl class="ex-attrs">
        ${u.ref ? `<div class="ex-attr"><dt>Clave</dt><dd>${esc(u.ref)}</dd></div>` : ''}
        <div class="ex-attr"><dt>Referencia territorial</dt><dd>${esc(u.muni)}</dd></div>
        ${u.status ? `<div class="ex-attr"><dt>Estado</dt><dd>${esc(u.status)}</dd></div>` : ''}
        ${u.owner ? `<div class="ex-attr"><dt>Dependencia</dt><dd>${esc(u.owner)}</dd></div>` : ''}
        ${u.date ? `<div class="ex-attr"><dt>Fecha</dt><dd>${esc(u.date)}</dd></div>` : ''}
        <div class="ex-attr"><dt>Fuente</dt><dd>${esc(u.source || 'Portal BCS 2050')}</dd></div></dl>
      <div class="ex-actions">${u.href ? `<a class="ex-btn" href="${esc(u.href)}">Abrir en el portal</a>` : ''}${u.url ? `<a class="ex-btn ghost" href="${esc(u.url)}" target="_blank" rel="noopener">Consultar fuente</a>` : ''}<button type="button" class="ex-btn accent" data-ask="feature">Preguntar sobre esto</button></div>`;
    showFicha(html, { type: 'unlocated', key: `unl-${id}`, name: u.name, munis: [] });
    clearSelectionHighlight();
  }
  function goBack() {
    const prev = S.history.pop(); if (!prev) return;
    S.selection = null;
    if (prev.type === 'feature') selectFeature(prev.layer, prev.key);
    else if (prev.type === 'muni') selectMunicipality(prev.name, { fly: false });
    else if (prev.type === 'topic') selectTopic(prev.topic);
    else if (prev.type === 'unlocated') selectUnlocated(prev.key.slice(4));
    $('#ex-back').hidden = !S.history.length;
  }

  // ---------- Mis hallazgos ----------
  function persistSaved() { try { localStorage.setItem('bcs-explorar-hallazgos', JSON.stringify(S.saved.slice(0, 200))); } catch (_) {} renderSaved(); }
  function toggleSave(layerId, key) {
    const i = S.saved.findIndex(s => s.key === key);
    if (i >= 0) S.saved.splice(i, 1);
    else { const f = S.layers.get(layerId)?.byKey?.get(key); if (!f) return; S.saved.unshift({ layer: layerId, key, name: f.properties._n, label: S.layers.get(layerId).meta.label, at: new Date().toISOString().slice(0, 10) }); }
    persistSaved();
    const b = $(`[data-save="${layerId}|${key}"]`); if (b) { const on = i < 0; b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Guardado' : 'Guardar hallazgo'; }
    toast(i >= 0 ? 'Hallazgo eliminado de Mis hallazgos.' : 'Guardado en Mis hallazgos (solo en este navegador).');
  }
  function renderSaved() {
    const c = $('#ex-saved-count'); if (c) { c.textContent = S.saved.length; c.hidden = !S.saved.length; }
    const list = $('#ex-saved-list'); if (!list) return;
    list.innerHTML = S.saved.length ? S.saved.map(s => `<li><button type="button" class="ex-rel" data-locate="${esc(s.layer)}|${esc(s.key)}"><span class="ex-rel-kind">${esc(s.label)} · ${esc(s.at)}</span>${esc(s.name)}</button><button type="button" class="ex-x" data-unsave="${esc(s.layer)}|${esc(s.key)}" aria-label="Quitar ${esc(s.name)}">Quitar</button></li>`).join('')
      : '<li class="ex-empty">Aún no hay hallazgos. Abre un elemento del mapa y pulsa «Guardar hallazgo».</li>';
  }
  async function locate(layerId, key) {
    const L = S.layers.get(layerId); if (!L) return;
    if (!L.active) await setActive(layerId, true);
    else await ensureLoaded(layerId);
    selectFeature(layerId, key, { fly: true, from: 'locate' });
  }
  async function locateLayer(layerId) {
    const L = S.layers.get(layerId); if (!L) return;
    if (!L.active) await setActive(layerId, true); else await ensureLoaded(layerId);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const f of L.data.features) { const [[a, b], [c, d]] = bboxOf(f.geometry); w = Math.min(w, a); s = Math.min(s, b); e = Math.max(e, c); n = Math.max(n, d); }
    if (S.ready) S.map.fitBounds([[w, s], [e, n]], { padding: framePadding(), duration: dur(1200), maxZoom: 11 });
  }
