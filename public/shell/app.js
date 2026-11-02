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

  function focusMuni(name, quiet) {
    pendingMuni = name || '';
    return loadMunis().then(function (geo) {
      if (!mapReady || !name) return;
      var feat = ((geo && geo.features) || []).filter(function (f) {
        return f.properties && f.properties.name === name;
      })[0];
      var box = boundsOf(feat);
      paintMuni(name);
      if (box) flyBox(box);
      if (!quiet) setStatus('Encuadre: ' + name + '.', 'Frame: ' + name + '.');
    });
  }
  function markReady() {
    mapReady = true;
    var ids = Object.keys(on).filter(function (id) { return on[id]; });
    Promise.all(ids.map(function (id) { return showLayer(id, true); })).then(function () {
      if (pendingJob) executeJob(pendingJob.question, pendingJob.sources, pendingJob.answer);
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
      var name = [p.name, p.name_es, p.proyecto, p.dependencia, p.NOM_NUC, p.NOM_LOC, p.ref].filter(Boolean).join(' ');
      var label = String(p.name || p.name_es || p.NOM_LOC || name);
      if (re.test(norm(name))) return { feature: feats[i], name: label };
    }
    return null;
  }

  var RULES = [
    { re: /novillo/, layer: 'federal_projects', hit: /novillo/, note: ['Presa El Novillo, en el punto del municipio de La Paz. No es la coordenada de la obra.', 'El Novillo dam, at the La Paz municipality point. It is not the worksite coordinate.'] },
    { re: /santo domingo|\b0306\b/, layer: 'settlements', hit: /^santo domingo$/, layers: ['settlements'], pin: 'Santo Domingo', note: ['Santo Domingo es un pueblo de Comondú. El acuífero 0306 no tiene polígono: el mapa marca el pueblo, no el acuífero.', 'Santo Domingo is a town in Comondú. Aquifer 0306 has no polygon: the map marks the town, not the aquifer.'] },
    { re: /\bbordos?\b/, layer: 'settlements', hit: /puerto san carlos/, layers: ['settlements'], pin: 'Puerto San Carlos', note: ['No hay capa de bordos. El archivo habla del bordo de Puerto San Carlos, y el mapa marca ese pueblo.', 'There is no levee layer. The archive mentions the Puerto San Carlos levee, and the map marks that town.'] },
    { re: /termosolar|el crucero/, layer: 'federal_projects', hit: /termosolar/, layers: ['federal_projects'], pin: 'Termosolares CFE', note: ['Las termosolares de CFE no tienen sitio publicado, ni El Crucero. El punto es el marcador del inventario, no la obra.', 'The CFE solar plants have no published site, including El Crucero. The point is the inventory marker, not the worksite.'] },
    { re: /oomsapas/, layer: 'federal_projects', hit: /oomsapas/, layers: ['federal_projects'], pin: 'OOMSAPAS Los Cabos', muniIf: /la paz/, muni: 'La Paz', noteIf: ['OOMSAPAS La Paz no tiene una coordenada de planta. El encuadre es el municipio.', 'OOMSAPAS La Paz has no plant coordinate. The frame is the municipality.'], note: ['OOMSAPAS Los Cabos aparece en la desaladora del inventario. El punto es del municipio, no es la puerta de la oficina.', 'OOMSAPAS Los Cabos appears on the inventory desalination plant. The point is the municipality, not the office door.'] },
    { re: /east cape|cabo del este/, muni: 'Los Cabos', layers: ['focus_east_cape', 'anp_federales'] },
    { re: /todos santos|pescadero/, muni: 'La Paz', layers: ['focus_corridor_cabos_lapaz', 'settlements'] },
    { re: /los cabos|san jose del cabo|cabo san lucas/, muni: 'Los Cabos', layers: ['settlements', 'osm_towns'] },
    { re: /la paz/, muni: 'La Paz', layers: ['settlements'] },
    { re: /loreto/, muni: 'Loreto', layers: ['focus_ports_air'] },
    { re: /comondu/, muni: 'Comondú', layers: ['settlements'] },
    { re: /mulege|santa rosalia/, muni: 'Mulegé', layers: ['focus_ports_air'] },
  ];
  var THEME_RULES = [
    { re: /acuifer|agua|water|novillo|oomsapas|santo domingo|\b0306\b/, layers: ['focus_water_dmas', 'osm_waterways'] },
    { re: /termosolar|el crucero|\bcfe\b/, layers: ['federal_projects'] },
    { re: /proteg|anp|natural area|area natural/, layers: ['anp_federales', 'rtp_conabio'] },
    { re: /carretera|highway|movilidad|aeropuerto|puerto|airport|port/, layers: ['osm_highways', 'osm_transport_nodes', 'focus_ports_air'] },
    { re: /vivienda|housing|sniiv/, layers: ['settlements', 'focus_water_dmas'] },
    { re: /proyecto federal|federal project/, layers: ['federal_projects'] },
  ];

  function pickRule(text) {
    var q = norm(text || '');
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(q)) return RULES[i];
    return null;
  }
  function executeJob(question, sources, answer) {
    var q = norm((question || '') + ' ' + (answer || ''));
    var jobs = [];
    THEME_RULES.forEach(function (rule) {
      if (!rule.re.test(q)) return;
      rule.layers.forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
    });
    var place = pickRule(question) || pickRule(answer);
    if (place) {
      var useMuni = place.muniIf && place.muniIf.test(norm(question || '') + ' ' + norm(answer || ''));
      (place.layers || []).forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
      if (useMuni && place.muni) {
        jobs.push(focusMuni(place.muni, true).then(function () {
          if (place.noteIf) setStatus(place.noteIf[0], place.noteIf[1]);
        }));
      } else if (place.layer && byId[place.layer]) {
        jobs.push(showLayer(place.layer, true).then(function (geo) {
          var hit = geo && place.hit ? findNamed(geo, place.hit) : null;
          var pt = hit ? pointOf(hit.feature) : null;
          if (pt) {
            flyPoint(pt.lng, pt.lat, place.pin || hit.name);
            if (place.note) setStatus(place.note[0], place.note[1]);
          } else if (place.muni) return focusMuni(place.muni);
        }));
      } else if (place.muni) jobs.push(focusMuni(place.muni));
    }
    return Promise.all(jobs).then(function () { syncThemePressed(); });
  }
  function applyText(question, sources, answer) {
    pendingJob = { question: question, sources: sources || [], answer: answer || '' };
    focusFiles(question, sources, answer);
    if (mapReady) return executeJob(question, sources, answer);
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
    leafletMap = L.map(mapEl, {
      scrollWheelZoom: true,
      maxZoom: 14,
      minZoom: 6.15,
      maxBounds: [[22.4, -115.7], [28.5, -108.95]],
    }).fitBounds([[22.87, -115.22], [28.0, -109.41]]);
    streetsLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 18 });
    satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 18 });
    setBasemap(basemap);
    L.control.scale({ imperial: false, metric: true }).addTo(leafletMap);
    setStatus('Mapa plano. El relieve 3D no está disponible en este navegador.', 'Flat map. 3D terrain is not available in this browser.');
    Promise.all(Object.keys(on).filter(function (id) { return on[id]; }).map(function (id) { return showLayer(id, true); })).then(markReady);
  }

  function boot3d() {
    if (!window.CDT3D || !CDT3D.hasWebGL()) { boot2d(); return; }
    CDT3D.start({ container: mapEl, tools: true, reduced: false, pitch: 28 }).then(function (eng) {
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
  function fileBlob(row) { return norm(fileName(row) + ' ' + (row[5] || '')); }

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

  function fillList(host, rows) {
    rows.forEach(function (row) { host.appendChild(rowButton(row)); });
  }
  function folderDetails(label, rows, nestStills) {
    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = label + ' · ' + rows.length;
    det.appendChild(sum);
    det.addEventListener('toggle', function () {
      if (!det.open || det.getAttribute('data-built')) return;
      det.setAttribute('data-built', '1');
      if (!nestStills) { fillList(det, rows); return; }
      var byTown = {};
      rows.forEach(function (row) {
        var parts = fileName(row).split(' · ');
        var town = parts.length > 1 ? parts[parts.length - 1] : tx('Sin municipio', 'No municipality');
        (byTown[town] || (byTown[town] = [])).push(row);
      });
      Object.keys(byTown).sort().forEach(function (town) {
        det.appendChild(folderDetails(town, byTown[town], false));
      });
    });
    return det;
  }
  function renderTree(filter) {
    if (!treeEl || !index) return;
    var q = norm(filter || '');
    treeEl.innerHTML = '';
    if (q) {
      var hits = [];
      for (var i = 0; i < index.files.length; i++) {
        if (fileBlob(index.files[i]).indexOf(q) !== -1) hits.push(index.files[i]);
      }
      var title = document.createElement('p');
      title.className = 'shell-tree-label';
      title.textContent = hits.length ? tx('Resultados', 'Results') + ' · ' + hits.length : tx('Ningún archivo coincide.', 'No file matches.');
      treeEl.appendChild(title);
      var shown = hits.slice(0, 60);
      fillList(treeEl, shown);
      if (hits.length > shown.length) {
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'shell-more';
        more.textContent = tx('Ver los ' + (hits.length - shown.length) + ' restantes', 'Show the other ' + (hits.length - shown.length));
        more.addEventListener('click', function () {
          fillList(treeEl, hits.slice(shown.length));
          more.remove();
        });
        treeEl.appendChild(more);
      }
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
      treeEl.appendChild(folderDetails((lang() === 'en' ? f[2] : f[1]), rows, f[0] === 'fotogramas'));
    });
  }

  var STOP = { esta: 1, este: 1, estos: 1, estas: 1, sobre: 1, desde: 1, donde: 1, cuando: 1, porque: 1, tiene: 1, tienen: 1, estan: 1, entre: 1, segun: 1, cual: 1, cuales: 1, estado: 1, municipal: 1, municipio: 1, proyecto: 1, fuente: 1, datos: 1, portal: 1, personas: 1, sigue: 1, puede: 1, tambien: 1, about: 1, there: 1, their: 1, which: 1, where: 1, from: 1, with: 1, that: 1, this: 1 };
  function wordsOf(text) {
    return norm(text || '').split(/[^a-z0-9]+/).filter(function (w) {
      if (STOP[w]) return false;
      return w.length > 4 || /^\d{4}$/.test(w);
    });
  }
  function focusFiles(question, sources, answer) {
    if (!index || !relatedEl) return;
    var urls = {};
    var qWords = wordsOf(question);
    var ev = wordsOf(answer || '');
    (sources || []).forEach(function (s) {
      if (!s) return;
      if (s.drive_url) urls[s.drive_url] = 1;
      if (s.href && /^https?:/.test(s.href)) urls[s.href] = 1;
      wordsOf(s.title).forEach(function (w) { ev.push(w); });
    });
    var scored = [];
    index.files.forEach(function (row) {
      var href = fileHref(row);
      var score = urls[href] ? 30 : 0;
      var blob = fileBlob(row).split(/[^a-z0-9]+/);
      var qHits = 0;
      qWords.forEach(function (w) { if (blob.indexOf(w) !== -1) { score += 8; qHits += 1; } });
      ev.forEach(function (w) { if (blob.indexOf(w) !== -1) score += 3; });
      if (qHits >= 2) score += 4;
      if (score >= 8) scored.push({ score: score, row: row });
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
    var cited = (d.sources || []).slice();
    if (d.primary_file) cited.push(d.primary_file);
    applyText(d.question || '', cited, d.answer || '');
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
  document.querySelectorAll('[data-fold]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var which = btn.getAttribute('data-fold') === 'files' ? 'shell-fold-files' : 'shell-fold-chat';
      var onFold = document.body.classList.toggle(which);
      btn.setAttribute('aria-pressed', onFold ? 'true' : 'false');
      setTimeout(function () {
        if (engine && engine.resize) engine.resize();
        if (leafletMap) leafletMap.invalidateSize();
      }, 40);
    });
  });

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
    getBounds: function () { return engine && engine.getBounds ? engine.getBounds() : null; },
  };
})();
