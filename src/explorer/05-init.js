
  // ---------- URL state ----------
  function syncUrl() {
    if (!S.manifest) return;
    const u = new URL(location.href);
    const act = S.order.filter(id => S.layers.get(id).active);
    if (act.length) u.searchParams.set('capas', act.join(',')); else u.searchParams.delete('capas');
    if (S.style !== 'ilustrado') u.searchParams.set('base', S.style); else u.searchParams.delete('base');
    history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString().replace(/%2C/g, ',') : '') + u.hash);
  }

  // ---------- map controls ----------
  function setExaggeration(x) {
    S.exaggeration = x;
    if (S.ready) S.map.setTerrain({ source: 'dem', exaggeration: x });
    const b = $('#ex-relief'); b.setAttribute('aria-pressed', String(x > 1)); b.textContent = x > 1 ? 'Relieve 2.5× (exagerado)' : 'Relieve 1× (real)';
    $('#ex-relief-flag').hidden = x === 1;
  }
  function setLight(l) {
    S.light = l;
    const b = $('#ex-light'); b.setAttribute('aria-pressed', String(l === 'dusk')); b.textContent = l === 'dusk' ? 'Atardecer' : 'Día';
    if (!S.ready) return;
    S.map.setLight({ anchor: 'map', position: l === 'dusk' ? [1.3, 250, 70] : [1.2, 315, 40], color: l === 'dusk' ? '#f3d9b6' : '#ffffff', intensity: l === 'dusk' ? 0.5 : 0.35 });
    S.map.setPaintProperty('hills', 'hillshade-illumination-direction', l === 'dusk' ? 260 : 315);
    applyBaseStyle(S.style, { quiet: true });
  }
  function viewAll() {
    if (!S.ready) return;
    const p = framePadding(); p.top = Math.max(20, p.top - 50); p.bottom += 20;
    S.map.fitBounds(S.base.bounds, { padding: p, pitch: isMobile() ? 35 : 50, bearing: -18, duration: dur(1400) });
  }
  function bindControls() {
    $('#ex-home').onclick = viewAll;
    $('#ex-zin').onclick = () => S.map?.zoomIn({ duration: dur(300) });
    $('#ex-zout').onclick = () => S.map?.zoomOut({ duration: dur(300) });
    $('#ex-rotl').onclick = () => S.map?.easeTo({ bearing: S.map.getBearing() - 30, duration: dur(500) });
    $('#ex-rotr').onclick = () => S.map?.easeTo({ bearing: S.map.getBearing() + 30, duration: dur(500) });
    $('#ex-north').onclick = () => S.map?.easeTo({ bearing: 0, duration: dur(500) });
    $('#ex-pitch').onclick = () => {
      if (!S.map) return; const flat = S.map.getPitch() > 10;
      S.map.easeTo({ pitch: flat ? 0 : 55, duration: dur(700) });
    };
    $('#ex-light').onclick = () => setLight(S.light === 'day' ? 'dusk' : 'day');
    $('#ex-relief').onclick = () => setExaggeration(S.exaggeration > 1 ? 1 : 2.5);
  }
  function syncPitchBtn() {
    const b = $('#ex-pitch'); if (!b || !S.map) return;
    const tilted = S.map.getPitch() > 10;
    b.textContent = tilted ? 'Vista cenital' : 'Vista 3D'; b.setAttribute('aria-pressed', String(tilted));
    $('#ex-north').style.setProperty('--rot', `${-S.map.getBearing()}deg`);
  }

  // ---------- picking & elevation probe ----------
  function pick(e) {
    if (window.__exPhotoHit && window.__exPhotoHit(e)) return;
    const ids = [];
    for (const L of S.layers.values()) if (L.active && L.added) for (const ly of L.layerIds) if (ly.type !== 'fill-extrusion' && ly.suffix !== 'labels' && !ly.suffix.startsWith('case')) ids.push(ly.id);
    if (S.map.getLayer('major-labels')) ids.push('major-labels');
    const r = isMobile() ? 12 : 6;
    const feats = ids.length ? S.map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ids }) : [];
    const prio = t => t === 'symbol' ? 0 : t === 'line' ? 1 : 2;
    feats.sort((a, b) => prio(a.layer.type) - prio(b.layer.type));
    const f = feats[0];
    if (f) {
      if (f.layer.id === 'major-labels') { locate('cities', f.properties._k); return; }
      const layerId = f.layer.id.split('-')[1];
      selectFeature(layerId, f.properties._k);
      return;
    }
    probe(e.lngLat, e.point);
  }
  function probe(lngLat, point) {
    const el = $('#ex-probe');
    const raw = S.map.queryTerrainElevation(lngLat);
    let txt;
    if (raw === null || raw === undefined) txt = 'Elevación no disponible aquí';
    else { const z = raw / (S.exaggeration || 1); txt = z <= 0.5 ? 'Nivel del mar (0 m)' : `${fmt(Math.round(z))} m s. n. m. (relieve modelado)`; }
    const mu = muniAt(lngLat);
    el.innerHTML = `<strong>${esc(txt)}</strong><span>${lngLat.lat.toFixed(4)}° N, ${Math.abs(lngLat.lng).toFixed(4)}° O${mu ? ` · ${esc(mu)}` : ''}</span>${mu ? `<button type="button" class="ex-inline" data-muni="${esc(mu)}">Ver municipio</button>` : ''}`;
    el.style.left = `${Math.min(innerWidth - 260, Math.max(10, point.x + 12))}px`; el.style.top = `${Math.max(70, point.y - 20)}px`;
    el.hidden = false;
    clearTimeout(S.probeTimer); S.probeTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ---------- WebGL fallback ----------
  function hasWebGL() {
    if (params.has('sinwebgl')) return false;
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; }
  }
  function enterFallback(reason) {
    S.webgl = false;
    document.body.classList.add('no-webgl');
    $('#ex-fallback').hidden = false;
    $('#ex-fallback-reason').textContent = reason || 'Este navegador no ofrece WebGL, necesario para el mapa 3D.';
    $('#ex-loading').hidden = true;
    window.__explorarReady = true;
    // Never leave a dead screen: offer the 2D map and move there automatically unless the user stays.
    const go = $('#ex-fallback-auto');
    if (go && !params.has('sinredireccion')) {
      let n = 8; go.hidden = false;
      const tickEl = $('#ex-fallback-count'); if (tickEl) tickEl.textContent = n;
      const t = setInterval(() => { n--; if (tickEl) tickEl.textContent = n; if (n <= 0) { clearInterval(t); location.href = '/mapas#capas'; } }, 1000);
      const stay = $('#ex-fallback-stay'); if (stay) stay.onclick = () => { clearInterval(t); go.hidden = true; };
    }
  }

  // ---------- events ----------
  function bindEvents() {
    document.addEventListener('click', e => {
      const t = e.target.closest('button, a, li.ex-res'); if (!t) return;
      const d = t.dataset;
      if (t.matches('li.ex-res')) { pickResult(t); return; }
      if (d.closeDialog) document.getElementById(d.closeDialog)?.close();
      if (d.toggle) { const L = S.layers.get(d.toggle); setActive(d.toggle, !L.active); return; }
      if (d.preset) { preset(d.preset); return; }
      if (d.basemap) { applyBaseStyle(d.basemap); syncUrl(); return; }
      if (d.inventory) { openInventory(d.inventory); return; }
      if (d.layerSource) { openDialog('ex-help'); const li = [...$$('#ex-sources-layers details')].find(x => x.querySelector('strong').textContent === S.layers.get(d.layerSource).meta.label); if (li) { li.open = true; li.scrollIntoView({ block: 'center' }); li.querySelector('summary').focus(); } return; }
      if (d.locate) { const [l, k] = d.locate.split('|'); locate(l, k); return; }
      if (d.locateLayer) { locateLayer(d.locateLayer); return; }
      if (d.locateMuni) { const f = S.base.municipalities.features.find(x => x.properties.name === d.locateMuni); frame(f.geometry, { maxZoom: 9 }); return; }
      if (d.save) { const [l, k] = d.save.split('|'); toggleSave(l, k); return; }
      if (d.unsave) { const [l, k] = d.unsave.split('|'); toggleSave(l, k); return; }
      if (d.muni) { selectMunicipality(d.muni); $('#ex-probe').hidden = true; return; }
      if (d.topic) { selectTopic(d.topic); return; }
      if (d.unlocated) { $('#ex-inventory').close(); selectUnlocated(d.unlocated); return; }
      if (d.openUnlocated) { openInventory(d.openUnlocated === 'aquifers' ? 'Acuífero' : d.openUnlocated, 'unlocated'); return; }
      if (d.relLayer) { setActive(d.relLayer, true); openPanel('ex-capas', { focus: false }); return; }
      if (d.ask === 'feature') { askAbout(); return; }
      if (d.invTab) { setInvTab(d.invTab); return; }
      if (d.chipType) {
        if (d.chipType === 'muni') selectMunicipality(d.chipId);
        else { const [l, k] = d.chipId.split('|'); locate(l, k); }
        return;
      }
    });
    $('#ex-capas-btn').onclick = () => (document.body.classList.contains('ex-capas-open') ? closePanel('ex-capas') : openPanel('ex-capas'));
    $('#ex-capas-close').onclick = () => closePanel('ex-capas');
    $('#ex-ficha-close').onclick = () => closePanel('ex-ficha');
    $('#ex-back').onclick = goBack;
    $('#ex-wide').onclick = () => { const on = document.body.classList.toggle('ficha-wide'); $('#ex-wide').setAttribute('aria-pressed', String(on)); $('#ex-wide').textContent = on ? 'Reducir' : 'Ampliar'; };
    $('#ex-install').onclick = replay;
    $('#ex-global-opacity').oninput = e => {
      S.global = Number(e.target.value) / 100; $('#ex-global-out').textContent = `${e.target.value} %`;
      try { localStorage.setItem('bcs-explorar-opacidad', String(S.global)); } catch (_) {}
      for (const L of S.layers.values()) if (L.active && L.added && !L.anim) paintLayer(L, 1);
    };
    document.addEventListener('input', e => {
      const id = e.target.dataset?.opacity; if (!id) return;
      const L = S.layers.get(id); L.opacity = Number(e.target.value) / 100;
      $(`[data-opacity-out="${id}"]`).textContent = `${e.target.value} %`;
      if (L.active && L.added && !L.anim) paintLayer(L, 1);
    });
    $('#ex-topics-btn').onclick = () => openDialog('ex-topics');
    $('#ex-help-btn').onclick = () => openDialog('ex-help');
    $('#ex-inv-btn').onclick = () => openInventory();
    $('#ex-fallback-inv').onclick = () => openInventory();
    $('#ex-saved-btn').onclick = () => { renderSaved(); openDialog('ex-saved'); };
    $('#ex-chat-btn').onclick = () => (S.chatOpen ? closeChat() : openChat());
    $('#ex-zone-btn').onclick = askZone;
    $$('dialog').forEach(d => d.addEventListener('close', () => { if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus({ preventScroll: true }); }));
    $$('[data-close]').forEach(b => b.onclick = () => document.getElementById(b.dataset.close).close());
    $('#ex-inv-layer').onchange = () => { S.invPage = 1; renderInventory(); };
    $('#ex-inv-q').oninput = () => { S.invPage = 1; renderInventory(); };
    $('#ex-unl-kind').onchange = renderInventory; $('#ex-unl-q').oninput = renderInventory;
    $('#ex-inv-prev').onclick = () => { S.invPage--; renderInventory(); };
    $('#ex-inv-next').onclick = () => { S.invPage++; renderInventory(); };
    const si = $('#ex-search'); let deb = 0;
    si.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(runSearch, 120); });
    si.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const o = $$('#ex-search-results .ex-res')[Math.max(0, searchActive)]; if (o) pickResult(o); }
      else if (e.key === 'Escape') { e.stopPropagation(); $('#ex-search-results').hidden = true; si.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.ex-search-wrap')) { $('#ex-search-results').hidden = true; si.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (e.key === 'Escape') {
        if ($$('dialog').some(d => d.open)) return;
        if (document.body.classList.contains('ex-ficha-open')) { closePanel('ex-ficha'); e.preventDefault(); return; }
        if (document.body.classList.contains('ex-capas-open') && (isMobile() || $('#ex-capas').contains(document.activeElement))) { closePanel('ex-capas'); e.preventDefault(); return; }
        if (S.chatOpen && window.BCSChat?.root?.contains(document.activeElement)) { closeChat(); $('#ex-chat-btn').focus(); return; }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); si.focus(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); $('#ex-capas-btn').click(); }
      else if (e.key === '?') { e.preventDefault(); openDialog('ex-help'); }
    });
    document.addEventListener('bcs:chat-answer', e => { addChips(e.detail).catch(() => {}); });
    document.getElementById('bcs-chat-close')?.addEventListener('click', () => closeChat());
    document.addEventListener('click', e => { if (e.target.closest('[data-bcs-place-strip] button')) S.chatContextPlace = null; }, true);
    const chatRoot = document.getElementById('bcs-chat');
    if (chatRoot) new MutationObserver(() => {
      if (!matchMedia('(max-width: 900px)').matches) return;
      const open = chatRoot.getAttribute('data-open') === 'true';
      if (open !== S.chatOpen) { S.chatOpen = open; document.body.classList.toggle('chat-open', open); $('#ex-chat-btn').setAttribute('aria-expanded', String(open)); }
    }).observe(chatRoot, { attributes: true, attributeFilter: ['data-open'] });
    mqReduce.addEventListener?.('change', () => { if (reduced()) for (const L of S.layers.values()) if (L.anim) { L.anim = null; paintLayer(L, 1); } });
  }

  // ---------- init ----------
  async function init() {
    bindEvents(); bindControls(); renderSaved();
    $('#ex-loading-text').textContent = 'Cargando el territorio…';
    try {
      [S.manifest, S.base, S.knowledge] = await Promise.all([getJSON('manifest.json'), getJSON('base.json'), getJSON('knowledge.json')]);
    } catch (e) {
      enterFallback('No se pudieron cargar los datos del atlas 3D en este momento.'); return;
    }
    S.order = S.manifest.layers.map(l => l.id);
    for (const meta of S.manifest.layers) S.layers.set(meta.id, { meta, active: false, opacity: 1, data: null, added: false });
    buildLayerPanel(); buildTopics(); buildSources();
    $('#ex-global-opacity').value = Math.round(S.global * 100); $('#ex-global-out').textContent = `${Math.round(S.global * 100)} %`;
    const wanted = (params.get('capas') || '').split(',').filter(id => S.layers.has(id));
    let style = params.get('base') || (() => { try { return localStorage.getItem('bcs-explorar-base'); } catch (_) { return null; } })() || 'ilustrado';
    if (!BASE_STYLES[style]) style = 'ilustrado';
    hookPlace(); window.addEventListener('load', hookPlace);
    if (!hasWebGL() || typeof maplibregl === 'undefined') { enterFallback(); return; }
    registerDem();
    let map;
    try {
      map = S.map = new maplibregl.Map({
        container: 'ex-map', style: styleSpec(), bounds: S.base.bounds, fitBoundsOptions: { padding: 40 },
        pitch: 48, bearing: -18, maxPitch: 76, minZoom: 4.3, maxZoom: 16.5, attributionControl: false,
        canvasContextAttributes: { antialias: true, preserveDrawingBuffer: params.has('captura') }, dragRotate: true, touchPitch: true, cooperativeGestures: false
      });
    } catch (e) { enterFallback('No se pudo iniciar el mapa 3D en este dispositivo.'); return; }
    map.keyboard.enable();
    map.on('error', ev => { if (String(ev?.error?.message || '').includes('WebGL')) enterFallback(); });
    try { map.getCanvas().addEventListener('webglcontextlost', () => { if (!S.ready) enterFallback('El dispositivo detuvo el mapa 3D.'); }); } catch (_) {}
    setTimeout(() => { if (!S.ready && S.webgl) enterFallback('El mapa 3D está tardando demasiado en este dispositivo.'); }, 30000);
    map.on('moveend', () => { syncPitchBtn(); if (S.chatOpen) S.chatContextPlace = contextPlace(); });
    map.on('rotate', syncPitchBtn); map.on('pitchend', syncPitchBtn);
    map.on('mousemove', e => { $('#ex-coords').textContent = `${e.lngLat.lat.toFixed(3)}° N · ${Math.abs(e.lngLat.lng).toFixed(3)}° O`; });
    map.on('click', pick);
    map.on('styleimagemissing', e => {
      const id = e.id; if (!id.startsWith('lbl-') || map.hasImage(id)) return;
      const key = id.slice(4);
      const f = S.base.majorCities.features.find(x => x.properties._k === key) || S.layers.get('cities')?.byKey?.get(key);
      if (f) map.addImage(id, labelImage(f.properties._n, labelStyle(S.base.majorCities.features.includes(f) ? 26 : 22)), { pixelRatio: 2 });
    });
    map.on('load', async () => {
      S.ready = true;
      for (const f of S.base.majorCities.features) if (!map.hasImage(`lbl-${f.properties._k}`)) map.addImage(`lbl-${f.properties._k}`, labelImage(f.properties._n, labelStyle(26)), { pixelRatio: 2 });
      getJSON('bands.json').then(b => map.getSource('bands').setData(b)).catch(() => {});
      applyBaseStyle(style, { quiet: true }); setLight('day'); setExaggeration(1);
      viewAll();
      for (const L of S.layers.values()) if (L.data) addMapLayers(L);
      const first = wanted.length ? wanted : (S.manifest.presets.basico || S.manifest.presets.esencial);
      await Promise.all(first.map((id, i) => setActive(id, true, { delay: 500 + i * 160, silent: true })));
      $('#ex-loading').hidden = true;
      setStatus('Listo. Pulsa un elemento del mapa o busca un lugar.');
      syncPitchBtn();
      map.once('idle', () => { window.__explorarReady = true; window.__explorarTTI = Math.round(performance.now()); });
      setTimeout(() => { window.__explorarReady = true; }, 8000);
    });
    if (!isMobile()) openPanel('ex-capas', { focus: false });
  }

  window.BCSExplorar = {
    state: S, setActive, preset, replay, selectFeature, selectMunicipality, selectTopic, openInventory, locate, applyBaseStyle, openChat, askZone, viewAll,
    layerCounts: () => Object.fromEntries([...S.layers.values()].map(L => [L.meta.id, { manifest: L.meta.count, loaded: L.data ? L.data.features.length : null, active: !!L.active }]))
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
