/* 3-pane shell: chat events move the twin map and the file list. */
(function () {
  var model = window.__SHELL_MODEL__ || { layers: [], themes: [] };
  var byId = {};
  (model.layers || []).forEach(function (l) { byId[l.id] = l; });
  var themeById = {};
  (model.themes || []).forEach(function (t) { themeById[t.id] = t; });

  var mapEl = document.getElementById('shell-map');
  var statusEl = document.getElementById('shell-status');
  var treeEl = document.getElementById('shell-tree');
  var relatedEl = document.getElementById('shell-related');
  var previewEl = document.getElementById('shell-preview');
  var searchEl = document.getElementById('shell-q');
  var engine = null;
  var leafletMap = null;
  var leafletLayers = {};
  var streetsLayer = null;
  var satLayer = null;
  var on = {};
  var basemap = 'streets';
  var muniGeo = null;
  var index = null;
  var mapReady = false;
  var pendingMuni = '';
  var pendingJob = null;

  function lang() {
    return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'es';
  }
  function tx(es, en) { return lang() === 'en' ? en : es; }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function setStatus(es, en) {
    if (statusEl) statusEl.textContent = tx(es, en);
  }
  function boundsOf(feature) {
    var b = [180, 90, -180, -90];
    var found = false;
    function walk(c) {
      if (!c) return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        found = true;
        if (c[0] < b[0]) b[0] = c[0];
        if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0];
        if (c[1] > b[3]) b[3] = c[1];
      } else if (Array.isArray(c)) c.forEach(walk);
    }
    if (feature && feature.geometry) walk(feature.geometry.coordinates);
    return found ? b : null;
  }
  function pointOf(feature) {
    var g = feature && feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return { lng: g.coordinates[0], lat: g.coordinates[1] };
    var b = boundsOf(feature);
    if (!b) return null;
    return { lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2, box: b };
  }

  function loadMunis() {
    if (muniGeo) return Promise.resolve(muniGeo);
    return fetch('/gis/osm_municipalities.geojson').then(function (r) { return r.json(); }).then(function (geo) {
      muniGeo = geo;
      return geo;
    }).catch(function () { return null; });
  }

  function paintMuni(name) {
    if (!engine || !engine.paintMunis || !name) return;
    var colors = {};
    colors[name] = { fill: '#7ec8e8', line: '#006BA3', weight: 2.6 };
    engine.paintMunis(colors);
  }

  function flyBox(box) {
    if (!box) return;
    if (engine && engine.fitBox) engine.fitBox(box);
    else if (leafletMap && window.L) leafletMap.fitBounds([[box[1], box[0]], [box[3], box[2]]]);
  }
  function flyPoint(lng, lat, label) {
    if (engine && engine.mark) engine.mark(lng, lat, label || '');
    if (engine && engine.fitBox) engine.fitBox([lng - 0.35, lat - 0.28, lng + 0.35, lat + 0.28]);
    if (leafletMap && window.L) {
      leafletMap.setView([lat, lng], 10);
      if (window.__shellPin) leafletMap.removeLayer(window.__shellPin);
      window.__shellPin = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#0083C4', fillOpacity: 1 }).addTo(leafletMap);
      if (label) window.__shellPin.bindTooltip(label, { permanent: true, direction: 'top' }).openTooltip();
    }
  }

  function focusMuni(name) {
    pendingMuni = name || '';
    return loadMunis().then(function (geo) {
      if (!mapReady || !name) return;
      var feat = ((geo && geo.features) || []).filter(function (f) {
        return f.properties && f.properties.name === name;
      })[0];
      var box = boundsOf(feat);
      paintMuni(name);
      if (box) flyBox(box);
      setStatus('Encuadre: ' + name + '.', 'Frame: ' + name + '.');
    });
  }
  function markReady() {
    mapReady = true;
    var ids = Object.keys(on).filter(function (id) { return on[id]; });
    Promise.all(ids.map(function (id) { return showLayer(id, true); })).then(function () {
      if (pendingJob) executeJob(pendingJob.question, pendingJob.sources);
      else if (pendingMuni) focusMuni(pendingMuni);
      if (engine && engine.resize) engine.resize();
      if (leafletMap) leafletMap.invalidateSize();
    });
  }

  function showLayer(id, visible) {
    var meta = byId[id];
    if (!meta) return Promise.resolve();
    on[id] = !!visible;
    document.querySelectorAll('[data-layer="' + id + '"]').forEach(function (box) { box.checked = !!visible; });
    if (engine) {
      if (!visible) { engine.hide(id); return Promise.resolve(); }
      return engine.load(meta).then(function (geo) {
        if (geo) engine.show(id, geo, meta, 'on');
        return geo;
      });
    }
    if (leafletMap && window.L) {
      if (!visible) {
        if (leafletLayers[id]) leafletMap.removeLayer(leafletLayers[id]);
        return Promise.resolve();
      }
      return fetch(meta.url).then(function (r) { return r.json(); }).then(function (geo) {
        if (leafletLayers[id]) leafletMap.removeLayer(leafletLayers[id]);
        leafletLayers[id] = L.geoJSON(geo, {
          style: function () { return { color: meta.color || '#0083C4', weight: 1.4, fillOpacity: 0.2 }; },
          pointToLayer: function (feat, latlng) {
            return L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1, fillColor: meta.color || '#0083C4', fillOpacity: 0.9 });
          },
        }).addTo(leafletMap);
        return geo;
      }).catch(function () { return null; });
    }
    return Promise.resolve();
  }

  function setTheme(id, forceOn) {
    var theme = themeById[id];
    if (!theme) return;
    var ids = theme.layers || [];
    var turnOn = forceOn != null ? forceOn : ids.some(function (lid) { return !on[lid]; });
    ids.forEach(function (lid) { showLayer(lid, turnOn); });
    document.querySelectorAll('[data-theme]').forEach(function (btn) {
      var tid = btn.getAttribute('data-theme');
      var t = themeById[tid];
      var all = t && (t.layers || []).length && (t.layers || []).every(function (lid) { return on[lid]; });
      btn.setAttribute('aria-pressed', all ? 'true' : 'false');
    });
  }

  function setBasemap(mode) {
    basemap = mode === 'satellite' ? 'satellite' : 'streets';
    document.querySelectorAll('[data-base]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-base') === basemap ? 'true' : 'false');
    });
    if (engine && engine.setBasemap) engine.setBasemap(basemap);
    if (leafletMap && streetsLayer && satLayer) {
      if (leafletMap.hasLayer(streetsLayer)) leafletMap.removeLayer(streetsLayer);
      if (leafletMap.hasLayer(satLayer)) leafletMap.removeLayer(satLayer);
      (basemap === 'satellite' ? satLayer : streetsLayer).addTo(leafletMap);
    }
  }

  function findNamed(geo, re) {
    var feats = (geo && geo.features) || [];
    for (var i = 0; i < feats.length; i++) {
      var p = feats[i].properties || {};
      var name = p.name || p.name_es || p.proyecto || p.NOM_NUC || p.ref || '';
      if (re.test(norm(name))) return { feature: feats[i], name: String(name) };
    }
    return null;
  }

  var RULES = [
    { re: /novillo/, layer: 'federal_projects', hit: /novillo/, note: ['Presa El Novillo, en el punto del municipio de La Paz. No es la coordenada de la obra.', 'El Novillo dam, at the La Paz municipality point. It is not the worksite coordinate.'] },
    { re: /east cape|cabo del este/, muni: 'Los Cabos', layers: ['focus_east_cape', 'anp_federales'] },
    { re: /todos santos|pescadero/, muni: 'La Paz', layers: ['focus_corridor_cabos_lapaz', 'settlements'] },
    { re: /los cabos|san jose del cabo|cabo san lucas/, muni: 'Los Cabos', layers: ['settlements', 'osm_towns'] },
    { re: /la paz/, muni: 'La Paz', layers: ['settlements'] },
    { re: /loreto/, muni: 'Loreto', layers: ['focus_ports_air'] },
    { re: /comondu/, muni: 'Comondú', layers: ['settlements'] },
    { re: /mulege|santa rosalia/, muni: 'Mulegé', layers: ['focus_ports_air'] },
  ];
  var THEME_RULES = [
    { re: /acuifer|agua|water|novillo/, layers: ['focus_water_dmas', 'osm_waterways'] },
    { re: /proteg|anp|natural area|area natural/, layers: ['anp_federales', 'rtp_conabio'] },
    { re: /carretera|highway|movilidad|aeropuerto|puerto|airport|port/, layers: ['osm_highways', 'osm_transport_nodes', 'focus_ports_air'] },
    { re: /vivienda|housing|sniiv/, layers: ['settlements', 'focus_water_dmas'] },
    { re: /proyecto federal|federal project/, layers: ['federal_projects'] },
  ];

  function executeJob(question, sources) {
    var q = norm(question || '');
    (sources || []).forEach(function (s) { if (s && s.title) q += ' ' + norm(s.title); });
    var jobs = [];
    THEME_RULES.forEach(function (rule) {
      if (!rule.re.test(q)) return;
      rule.layers.forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
    });
    var place = null;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(q)) { place = RULES[i]; break; }
    }
    if (place) {
      (place.layers || []).forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
      if (place.layer && byId[place.layer]) {
        jobs.push(showLayer(place.layer, true).then(function (geo) {
          var hit = geo && place.hit ? findNamed(geo, place.hit) : null;
          var pt = hit ? pointOf(hit.feature) : null;
          if (pt) {
            flyPoint(pt.lng, pt.lat, hit.name);
            if (place.note) setStatus(place.note[0], place.note[1]);
          } else if (place.muni) return focusMuni(place.muni);
        }));
      } else if (place.muni) jobs.push(focusMuni(place.muni));
    }
    return Promise.all(jobs).then(function () { syncThemePressed(); });
  }
  function applyText(question, sources) {
    pendingJob = { question: question, sources: sources || [] };
    focusFiles(question, sources);
    if (mapReady) return executeJob(question, sources);
    return Promise.resolve();
  }

  function syncThemePressed() {
    document.querySelectorAll('[data-theme]').forEach(function (btn) {
      var t = themeById[btn.getAttribute('data-theme')];
      var all = t && (t.layers || []).length && (t.layers || []).every(function (lid) { return on[lid]; });
      btn.setAttribute('aria-pressed', all ? 'true' : 'false');
    });
  }

  function boot2d() {
    if (!window.L || !mapEl) return;
    leafletMap = L.map(mapEl, { scrollWheelZoom: true, maxZoom: 14 }).setView([25.6, -112.0], 6);
    streetsLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 18 });
    satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 18 });
    setBasemap(basemap);
    L.control.scale({ imperial: false, metric: true }).addTo(leafletMap);
    setStatus('Mapa plano. El relieve 3D no está disponible en este navegador.', 'Flat map. 3D terrain is not available in this browser.');
    Promise.all(Object.keys(on).filter(function (id) { return on[id]; }).map(function (id) { return showLayer(id, true); })).then(markReady);
  }

  function boot3d() {
    if (!window.CDT3D || !CDT3D.hasWebGL()) { boot2d(); return; }
    CDT3D.start({ container: mapEl, tools: true, reduced: false }).then(function (eng) {
      engine = eng;
      engine.setBasemap(basemap);
      var ids = Object.keys(on).filter(function (id) { return on[id]; });
      return Promise.all(ids.map(function (id) { return showLayer(id, true); })).then(markReady);
    }).catch(function () { boot2d(); });
  }

  function fileName(row) { return row[0]; }
  function fileFolder(row) { return row[1]; }
  function fileHref(row) { return row[3]; }
  function fileKind(row) { return row[4]; }

  function renderPreview(row) {
    if (!previewEl) return;
    var name = fileName(row);
    var href = fileHref(row);
    var kind = fileKind(row);
    previewEl.hidden = false;
    if (kind === 'i') {
      previewEl.innerHTML = '<p><strong></strong></p><img alt="">';
      previewEl.querySelector('strong').textContent = name;
      var img = previewEl.querySelector('img');
      img.alt = name;
      img.src = href;
      img.addEventListener('error', function () {
        img.replaceWith(document.createTextNode(tx('El fotograma no está en este equipo.', 'This frame is not on this machine.')));
      });
      return;
    }
    previewEl.innerHTML = '<p><strong></strong></p><a target="_blank" rel="noopener noreferrer"></a>';
    previewEl.querySelector('strong').textContent = name;
    var a = previewEl.querySelector('a');
    a.href = href;
    a.textContent = tx('Abrir', 'Open');
  }

  function rowButton(row) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-file';
    btn.textContent = fileName(row);
    btn.addEventListener('click', function () { renderPreview(row); });
    return btn;
  }

  function renderTree(filter) {
    if (!treeEl || !index) return;
    var q = norm(filter || '');
    treeEl.innerHTML = '';
    if (q) {
      var hits = [];
      for (var i = 0; i < index.files.length && hits.length < 80; i++) {
        if (norm(fileName(index.files[i])).indexOf(q) !== -1) hits.push(index.files[i]);
      }
      var title = document.createElement('p');
      title.className = 'shell-tree-label';
      title.textContent = hits.length ? tx('Resultados', 'Results') : tx('Ningún archivo coincide.', 'No file matches.');
      treeEl.appendChild(title);
      hits.forEach(function (row) { treeEl.appendChild(rowButton(row)); });
      return;
    }
    var groups = {};
    index.files.forEach(function (row) {
      var id = fileFolder(row);
      (groups[id] || (groups[id] = [])).push(row);
    });
    (index.folders || []).forEach(function (f) {
      var rows = groups[f[0]];
      if (!rows || !rows.length) return;
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = (lang() === 'en' ? f[2] : f[1]) + ' · ' + rows.length;
      det.appendChild(sum);
      det.addEventListener('toggle', function () {
        if (!det.open || det.getAttribute('data-built')) return;
        det.setAttribute('data-built', '1');
        var list = document.createElement('div');
        rows.slice(0, 400).forEach(function (row) { list.appendChild(rowButton(row)); });
        if (rows.length > 400) {
          var more = document.createElement('p');
          more.className = 'shell-tree-label';
          more.textContent = tx('Hay más archivos en esta carpeta. Usa la búsqueda.', 'This folder has more files. Use search.');
          list.appendChild(more);
        }
        det.appendChild(list);
      });
      treeEl.appendChild(det);
    });
  }

  function focusFiles(question, sources) {
    if (!index || !relatedEl) return;
    var urls = {};
    var qWords = norm(question || '').split(/[^a-z0-9]+/).filter(function (w) { return w.length > 4; });
    (sources || []).forEach(function (s) {
      if (!s) return;
      if (s.drive_url) urls[s.drive_url] = 1;
      if (s.href) urls[s.href] = 1;
    });
    var scored = [];
    index.files.forEach(function (row) {
      var href = fileHref(row);
      var score = urls[href] ? 20 : 0;
      var name = norm(fileName(row)).split(/[^a-z0-9]+/);
      qWords.forEach(function (w) { if (name.indexOf(w) !== -1) score += 5; });
      if (score >= 5) scored.push({ score: score, row: row });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    relatedEl.innerHTML = '';
    if (!scored.length) { relatedEl.hidden = true; return; }
    relatedEl.hidden = false;
    var label = document.createElement('p');
    label.className = 'shell-tree-label';
    label.textContent = tx('De esta respuesta', 'From this answer');
    relatedEl.appendChild(label);
    scored.slice(0, 8).forEach(function (item) { relatedEl.appendChild(rowButton(item.row)); });
    renderPreview(scored[0].row);
  }

  function readBoot() {
    var params = new URLSearchParams(location.search);
    var base = params.get('base');
    if (base === 'satellite' || base === 'streets') basemap = base;
    var theme = params.get('theme') || params.get('tema');
    if (theme && themeById[theme]) setTheme(theme, true);
    else (themeById.urbano && themeById.urbano.layers || ['settlements']).forEach(function (id) { if (byId[id]) on[id] = true; });
    document.querySelectorAll('[data-layer]').forEach(function (box) {
      box.checked = !!on[box.getAttribute('data-layer')];
    });
    syncThemePressed();
    var muni = params.get('muni');
    if (muni) focusMuni(muni);
    var q = params.get('q');
    if (q && searchEl) { searchEl.value = q; }
  }

  document.querySelectorAll('[data-layer]').forEach(function (box) {
    box.addEventListener('change', function () {
      showLayer(box.getAttribute('data-layer'), box.checked);
      syncThemePressed();
    });
  });
  document.querySelectorAll('[data-theme]').forEach(function (btn) {
    btn.addEventListener('click', function () { setTheme(btn.getAttribute('data-theme')); });
  });
  document.querySelectorAll('[data-base]').forEach(function (btn) {
    btn.addEventListener('click', function () { setBasemap(btn.getAttribute('data-base')); });
  });
  if (searchEl) {
    searchEl.addEventListener('input', function () { renderTree(searchEl.value); });
  }
  document.addEventListener('bcs:lang', function () {
    if (searchEl) {
      searchEl.placeholder = tx(searchEl.getAttribute('data-lang-placeholder-es') || 'Buscar', searchEl.getAttribute('data-lang-placeholder-en') || 'Search');
    }
    renderTree(searchEl ? searchEl.value : '');
  });
  document.addEventListener('bcs:chat-answer', function (ev) {
    var d = ev.detail || {};
    applyText(d.question || '', d.sources || []);
  });
  window.addEventListener('bcs:placechange', function (ev) {
    var id = ev.detail && ev.detail.place;
    var map = { los_cabos: 'Los Cabos', la_paz: 'La Paz', loreto: 'Loreto', comondu: 'Comondú', mulege_north: 'Mulegé' };
    if (id && map[id]) focusMuni(map[id]);
    else if (!id && engine && engine.fitBox) engine.fitBox(null);
  });

  var shell = document.querySelector('.shell');
  function drag(handle, key, sign) {
    if (!handle || !shell) return;
    handle.addEventListener('pointerdown', function (e) {
      if (window.matchMedia('(max-width: 900px)').matches) return;
      e.preventDefault();
      var startX = e.clientX;
      var start = parseFloat(getComputedStyle(shell).getPropertyValue(key)) || (key === '--chat-w' ? 320 : 320);
      function move(ev) {
        var next = Math.max(240, Math.min(480, start + sign * (ev.clientX - startX)));
        shell.style.setProperty(key, next + 'px');
        if (engine && engine.resize) engine.resize();
        if (leafletMap) leafletMap.invalidateSize();
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
  drag(document.getElementById('split-l'), '--chat-w', 1);
  drag(document.getElementById('split-r'), '--files-w', -1);

  document.querySelectorAll('[data-pane]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.body.setAttribute('data-pane', btn.getAttribute('data-pane'));
      document.querySelectorAll('[data-pane]').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      setTimeout(function () {
        if (engine && engine.resize) engine.resize();
        if (leafletMap) leafletMap.invalidateSize();
      }, 60);
    });
  });

  window.addEventListener('resize', function () {
    if (engine && engine.resize) engine.resize();
    if (leafletMap) leafletMap.invalidateSize();
  });

  readBoot();
  setBasemap(basemap);
  boot3d();
  fetch('/shell/files.json').then(function (r) { return r.json(); }).then(function (data) {
    index = data;
    renderTree(searchEl ? searchEl.value : '');
  }).catch(function () {
    if (treeEl) treeEl.textContent = tx('No se pudo cargar el índice de archivos.', 'The file index could not be loaded.');
  });

  window.Shell = {
    applyText: applyText,
    showLayer: showLayer,
    setBasemap: setBasemap,
    focusMuni: focusMuni,
  };
})();
