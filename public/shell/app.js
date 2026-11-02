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
  var ficheEl = document.getElementById('shell-fiche');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function closeFiche() {
    if (!ficheEl) return;
    ficheEl.hidden = true;
    ficheEl.innerHTML = '';
  }
  function filesFor(text) {
    if (!index || !text) return [];
    var q = norm(text);
    if (q.length < 4) return [];
    var hits = [];
    (index.files || []).forEach(function (row) {
      if (fileBlob(row).indexOf(q) !== -1) hits.push(row);
    });
    return hits.slice(0, 4);
  }
  var GAPS = {
    land: ['Catastro, permisos y predios: próximo / sin datos. El mapa no registra propiedad ni trámites.', 'Cadastre, permits and parcels: upcoming / no data. The map does not register ownership or permit workflows.'],
    bim: ['BIM e IoT de obra: próximo / sin datos. No hay huella de edificio ni sensor.', 'Construction BIM and IoT: upcoming / no data. There is no building footprint and no sensor.'],
    water: ['Agua inteligente: próximo / sin datos. No hay sensores ni pronóstico de avenida. Lo publicado son acuíferos en déficit y cauces.', 'Smart water: upcoming / no data. There are no sensors and no flood forecast. What is published is deficit aquifers and channels.'],
    mobility: ['Movilidad en vivo: próximo / sin datos. No hay flujo de vehículos. El mapa muestra carreteras, puertos y aeropuertos publicados.', 'Live mobility: upcoming / no data. There is no vehicle flow. The map shows published roads, ports and airports.'],
  };
  var PILLARS = [
    { re: /catastro|predio|parcela|permiso|lot\b|parcel|cadastre|tenencia/, id: 'land', title: ['Suelo y permisos', 'Land and permits'], layers: ['poer_ugas'] },
    { re: /\bbim\b|\biot\b|sensor|huella de edificio|building footprint/, id: 'bim', title: ['Obra y sensores', 'Construction and sensors'], layers: [] },
    { re: /acuifer|agua|water|inund|flood|novillo|oomsapas/, id: 'water', title: ['Agua', 'Water'], layers: ['focus_water_dmas', 'osm_waterways'] },
    { re: /trafico|tráfico|congestion|movilidad|carretera|highway|aeropuerto|puerto|airport|port/, id: 'mobility', title: ['Movilidad', 'Mobility'], layers: ['osm_highways', 'osm_transport_nodes', 'focus_ports_air'] },
  ];
  function pillarOf(text) {
    var q = norm(text || '');
    for (var i = 0; i < PILLARS.length; i++) if (PILLARS[i].re.test(q)) return PILLARS[i];
    return null;
  }
  function scenarioActs() {
    return (model.scenarios || []).map(function (s) {
      return '<a href="' + esc(s.href) + '">' + esc(tx(s.es, s.en)) + '</a>';
    }).join('');
  }
  function openFiche(info) {
    if (!ficheEl || !info) return;
    var rows = (info.rows || []).filter(function (row) { return row && row.value != null && row.value !== ''; });
    var files = info.files || [];
    var html = '<button type="button" class="shell-fiche-x">' + tx('Cerrar', 'Close') + '</button>';
    html += '<p class="shell-fiche-kicker">' + esc(tx(info.kind_es, info.kind_en)) + '</p>';
    html += '<h2>' + esc(info.title) + '</h2>';
    if (rows.length) {
      html += '<dl>';
      rows.forEach(function (row) {
        html += '<dt>' + esc(tx(row.es, row.en)) + '</dt><dd>' + esc(row.value) + '</dd>';
      });
      html += '</dl>';
    }
    if (info.href) html += '<p><a href="' + esc(info.href) + '">' + esc(tx(info.href_es || 'Abrir ficha', info.href_en || 'Open page')) + '</a></p>';
    if (info.foresight) {
      html += '<p class="shell-fiche-kicker">' + tx('Escenarios publicados', 'Published scenarios') + '</p>';
      html += '<div class="shell-fiche-acts">' + scenarioActs() + '</div>';
    }
    (info.gaps || []).forEach(function (id) {
      var gap = GAPS[id];
      if (gap) html += '<p class="shell-fiche-gap">' + esc(tx(gap[0], gap[1])) + '</p>';
    });
    if (files.length) {
      html += '<p class="shell-fiche-kicker">' + tx('Archivos', 'Files') + '</p><div class="shell-fiche-files">';
      files.forEach(function (row, i) {
        html += '<button type="button" data-fiche-file="' + i + '">' + esc(fileName(row)) + '</button>';
      });
      html += '</div>';
    }
    ficheEl.innerHTML = html;
    ficheEl.hidden = false;
    var x = ficheEl.querySelector('.shell-fiche-x');
    if (x) x.addEventListener('click', closeFiche);
    ficheEl.querySelectorAll('[data-fiche-file]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderPreview(files[Number(btn.getAttribute('data-fiche-file'))]);
      });
    });
  }
  function muniRow(name) {
    return (model.munis || []).filter(function (m) { return m.name === name; })[0];
  }
  function openMuniFiche(name, note, extraGaps) {
    var row = muniRow(name);
    if (!name) return;
    var rows = [];
    if (row && row.pob) {
      var n = Number(row.pob).toLocaleString(lang() === 'en' ? 'en-US' : 'es-MX');
      rows.push({ es: 'Población 2020', en: 'Population 2020', value: n + (lang() === 'en' ? ' people' : ' habitantes') });
      rows.push({ es: 'Fuente', en: 'Source', value: 'INEGI Censo 2020' });
    }
    if (note) rows.push({ es: 'Lectura', en: 'Reading', value: tx(note[0], note[1]) });
    if (extrudeOn) rows.push({ es: 'Columna', en: 'Column', value: tx('La columna compara esta población. No es el relieve ni un edificio.', 'The column compares this population. It is not the relief or a building.') });
    var gaps = ['land'];
    (extraGaps || []).forEach(function (id) { if (gaps.indexOf(id) === -1) gaps.push(id); });
    openFiche({
      title: name,
      kind_es: 'Municipio',
      kind_en: 'Municipality',
      rows: rows,
      href: row && row.studio ? row.studio : '',
      href_es: 'Ficha del municipio',
      href_en: 'Municipality page',
      foresight: true,
      gaps: gaps,
      files: filesFor(name),
    });
    paintMuni(name);
  }
  function featureLabel(p) {
    return p.name || p.name_es || p.NOM_LOC || p.NOM_NUC || p.NOMBRE_UGA || p.proyecto || p.ref || '';
  }
  function openFeatureFiche(feature, lngLat, meta, note) {
    var p = (feature && feature.properties) || {};
    var layerId = feature && feature.layer && feature.layer.id || '';
    if (layerId === 'cdt-muni-fill' || layerId === 'cdt-muni-extrude' || layerId === 'cdt-muni-line' || layerId === 'cdt-bars') {
      if (p.name) openMuniFiche(p.name);
      return;
    }
    var title = featureLabel(p) || (meta ? (lang() === 'en' ? meta.name_en : meta.name_es) : '');
    if (!title) return;
    var rows = [];
    if (meta) rows.push({ es: 'Capa', en: 'Layer', value: lang() === 'en' ? meta.name_en : meta.name_es });
    var fields = [
      ['place', 'Tipo en el mapa', 'Map type'],
      ['kind', 'Clase', 'Kind'],
      ['population', 'Población publicada', 'Published population'],
      ['pobtot', 'Población publicada', 'Published population'],
      ['municipio', 'Municipio', 'Municipality'],
      ['tier', 'Jerarquía', 'Tier'],
      ['sector', 'Sector', 'Sector'],
      ['dependencia', 'Dependencia', 'Agency'],
      ['estado', 'Estado del proyecto', 'Project status'],
      ['sexenio', 'Sexenio', 'Administration'],
      ['monto_MXN', 'Monto publicado (MXN)', 'Published amount (MXN)'],
      ['precision_es', 'Precisión', 'Precision', 'precision_en'],
      ['fact_es', 'Dato publicado', 'Published figure', 'fact_en'],
      ['fuente', 'Fuente', 'Source'],
      ['source', 'Fuente', 'Source'],
      ['NOMBRE_UGA', 'Zona', 'Zone'],
      ['CLAVE_UGA', 'Clave', 'Code'],
      ['icao', 'ICAO', 'ICAO'],
      ['iata', 'IATA', 'IATA'],
    ];
    fields.forEach(function (field) {
      var key = lang() === 'en' && field[3] && p[field[3]] != null && p[field[3]] !== '' ? field[3] : field[0];
      var raw = p[key];
      if (raw == null || raw === '' || typeof raw === 'object') return;
      var value = String(raw);
      if (field[0] === 'monto_MXN' && !isNaN(Number(raw))) value = Number(raw).toLocaleString(lang() === 'en' ? 'en-US' : 'es-MX');
      rows.push({ es: field[1], en: field[2], value: value });
    });
    if (meta && meta.source_es) rows.push({ es: 'Origen de la capa', en: 'Layer source', value: lang() === 'en' ? meta.source_en : meta.source_es });
    if (note) rows.push({ es: 'Lectura', en: 'Reading', value: tx(note[0], note[1]) });
    var href = typeof p.studio_href === 'string' && p.studio_href.charAt(0) === '/' ? p.studio_href : '';
    var gap = meta && (meta.id === 'focus_water_dmas' || meta.id === 'osm_waterways') ? 'water'
      : meta && (meta.id === 'osm_highways' || meta.id === 'osm_transport_nodes' || meta.id === 'focus_ports_air' || meta.id === 'highway_nodes') ? 'mobility'
      : meta && (meta.id === 'poer_ugas' || meta.id === 'anp_federales') ? 'land'
      : '';
    openFiche({
      title: title,
      kind_es: meta ? meta.name_es : 'Elemento del mapa',
      kind_en: meta ? meta.name_en : 'Map feature',
      rows: rows,
      href: href,
      href_es: 'Página relacionada',
      href_en: 'Related page',
      gaps: gap ? [gap] : [],
      files: filesFor(title),
    });
    if (lngLat && engine && engine.mark) engine.mark(lngLat.lng, lngLat.lat, title);
  }
  function onMapFeature(feats, lngLat) {
    if (!feats || !feats.length) { closeFiche(); return; }
    var feature = feats[0];
    var id = String(feature.layer && feature.layer.id || '').replace(/^cdt-ly-/, '').replace(/-edge$/, '');
    openFeatureFiche(feature, lngLat, byId[id]);
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
      if (!quiet) {
        setStatus('Encuadre: ' + name + '.', 'Frame: ' + name + '.');
        openMuniFiche(name);
      }
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
    var wrap = document.querySelector('.shell-map-wrap');
    if (wrap) wrap.classList.toggle('is-sat', basemap === 'satellite');
    document.body.classList.toggle('is-sat', basemap === 'satellite');
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
    var pillar = pillarOf(question || '');
    THEME_RULES.forEach(function (rule) {
      if (!rule.re.test(q)) return;
      rule.layers.forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
    });
    if (pillar) pillar.layers.forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
    var place = pickRule(question) || pickRule(answer);
    var gaps = pillar ? [pillar.id] : [];
    if (place) {
      var useMuni = place.muniIf && place.muniIf.test(norm(question || '') + ' ' + norm(answer || ''));
      (place.layers || []).forEach(function (id) { if (byId[id]) jobs.push(showLayer(id, true)); });
      if (useMuni && place.muni) {
        jobs.push(focusMuni(place.muni, true).then(function () {
          if (place.noteIf) setStatus(place.noteIf[0], place.noteIf[1]);
          openMuniFiche(place.muni, place.noteIf, gaps);
        }));
      } else if (place.layer && byId[place.layer]) {
        jobs.push(showLayer(place.layer, true).then(function (geo) {
          var hit = geo && place.hit ? findNamed(geo, place.hit) : null;
          var pt = hit ? pointOf(hit.feature) : null;
          if (pt) {
            flyPoint(pt.lng, pt.lat, place.pin || hit.name);
            if (place.note) setStatus(place.note[0], place.note[1]);
            openFeatureFiche(hit.feature, { lng: pt.lng, lat: pt.lat }, byId[place.layer], place.note);
          } else if (place.muni) return focusMuni(place.muni, true).then(function () { openMuniFiche(place.muni, place.note, gaps); });
        }));
      } else if (place.muni) jobs.push(focusMuni(place.muni, true).then(function () { openMuniFiche(place.muni, place.note, gaps); }));
    } else if (pillar) {
      openFiche({
        title: tx(pillar.title[0], pillar.title[1]),
        kind_es: 'Lectura del gemelo',
        kind_en: 'Twin reading',
        rows: [{ es: 'En el mapa', en: 'On the map', value: tx('Se enciende solo lo que el portal ya publica.', 'Only what the portal already publishes is turned on.') }],
        foresight: pillar.id === 'land' || pillar.id === 'water',
        gaps: gaps,
      });
      setStatus(GAPS[pillar.id][0], GAPS[pillar.id][1]);
    } else if (jobs.length) {
      setStatus('El mapa encendió las capas de esa respuesta.', 'The map turned on the layers for that answer.');
    }
    return Promise.all(jobs).then(function () { syncThemePressed(); syncStackToggles(); });
  }
  function applyText(question, sources, answer) {
    pendingJob = { question: question, sources: sources || [], answer: answer || '' };
    var n = focusFiles(question, sources, answer) || 0;
    if (mapReady) executeJob(question, sources, answer);
    return n;
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
    CDT3D.start({
      container: mapEl,
      tools: true,
      reduced: reduceMotion,
      pitch: pitched ? PITCH_ON : 0,
      bearing: pitched ? BEARING_ON : 0,
      exaggeration: TERRAIN_EX,
      onFeature: onMapFeature,
    }).then(function (eng) {
      engine = eng;
      setBasemap(basemap);
      applyTerrain();
      applyExtrusion();
      syncPitchBtn();
      syncHud();
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
    var closeBtn = '<button type="button" class="shell-preview-x">' + tx('Cerrar vista', 'Close preview') + '</button>';
    if (kind === 'i') {
      previewEl.innerHTML = closeBtn + '<p><strong></strong></p><img alt="">';
      previewEl.querySelector('strong').textContent = name;
      var img = previewEl.querySelector('img');
      img.alt = name;
      img.src = href;
      img.addEventListener('error', function () {
        img.replaceWith(document.createTextNode(tx('El fotograma no está en este equipo.', 'This frame is not on this machine.')));
      });
      return;
    }
    previewEl.innerHTML = closeBtn + '<p><strong></strong></p><a target="_blank" rel="noopener noreferrer"></a>';
    previewEl.querySelector('strong').textContent = name;
    var a = previewEl.querySelector('a');
    a.href = href;
    a.textContent = tx('Abrir', 'Open');
  }
  if (previewEl) {
    previewEl.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.shell-preview-x')) return;
      previewEl.hidden = true;
      previewEl.innerHTML = '';
    });
  }

  function rowButton(row) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-file';
    btn.textContent = fileName(row);
    btn.title = fileName(row);
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
    return Math.min(scored.length, 8);
  }

  var TERRAIN_EX = 2.15;
  var PITCH_ON = 50;
  var BEARING_ON = -18;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var terrainOn = true;
  var extrudeOn = false;
  var pitched = !reduceMotion;

  function extrusionHeights() {
    var rows = model.munis || [];
    var vals = rows.map(function (m) { return Number(m.pob); }).filter(function (n) { return n > 0; });
    if (!vals.length) return {};
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var out = {};
    rows.forEach(function (m) {
      var raw = Number(m.pob);
      if (!(raw > 0)) return;
      var t = max === min ? 1 : (raw - min) / (max - min);
      // Narrow columns, not the municipality polygon. Meters, for comparison only.
      out[m.name] = Math.round(9000 + t * 18000);
    });
    return out;
  }
  function applyExtrusion() {
    if (!engine) return;
    if (engine.setExtrusion) engine.setExtrusion({});
    if (engine.setMuniWash) engine.setMuniWash(0.02);
    if (engine.setPopulationBars) engine.setPopulationBars(extrudeOn ? extrusionHeights() : null);
  }
  function applyTerrain() {
    if (engine && engine.setTerrain) engine.setTerrain(terrainOn, TERRAIN_EX);
  }
  function applyPitch() {
    if (!engine || !engine.setPitch) return;
    var show3d = pitched && terrainOn;
    engine.setPitch(show3d ? PITCH_ON : 0, show3d ? BEARING_ON : 0);
  }
  function syncPitchBtn() {
    var btn = document.getElementById('shell-pitch');
    if (!btn) return;
    btn.setAttribute('aria-pressed', pitched && terrainOn ? 'true' : 'false');
  }
  function syncStackToggles() {
    document.querySelectorAll('[data-stack-toggle]').forEach(function (btn) {
      var id = btn.getAttribute('data-stack-toggle');
      var pressed = false;
      if (id === 'l0') pressed = terrainOn;
      else if (id === 'l1') pressed = extrudeOn;
      else {
        var stack = (model.stack || []).filter(function (s) { return s.id === id; })[0];
        var ids = (stack && stack.layers) || [];
        pressed = ids.length > 0 && ids.every(function (lid) { return on[lid]; });
      }
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
    syncPitchBtn();
  }
  function syncHud() {
    var es = document.querySelector('#shell-hud [data-lang-es]');
    var en = document.querySelector('#shell-hud [data-lang-en]');
    var esText = !terrainOn
      ? 'Terreno apagado'
      : (pitched ? 'Terreno 3D activo' : 'Terreno en planta');
    var enText = !terrainOn
      ? 'Terrain off'
      : (pitched ? '3D terrain on' : 'Terrain in plan');
    if (extrudeOn) {
      esText += ' · columnas de población 2020';
      enText += ' · 2020 population columns';
    }
    if (es) es.textContent = esText;
    if (en) en.textContent = enText;
  }
  function stackById(id) {
    return (model.stack || []).filter(function (s) { return s.id === id; })[0];
  }

  function readBoot() {
    var params = new URLSearchParams(location.search);
    var base = params.get('base');
    if (base === 'satellite' || base === 'streets') basemap = base;
    (model.defaults || ['osm_towns', 'osm_highways']).forEach(function (id) { if (byId[id]) on[id] = true; });
    var theme = params.get('theme') || params.get('tema');
    if (theme && themeById[theme]) {
      (themeById[theme].layers || []).forEach(function (id) { if (byId[id]) on[id] = true; });
    }
    document.querySelectorAll('[data-layer]').forEach(function (box) {
      box.checked = !!on[box.getAttribute('data-layer')];
    });
    syncThemePressed();
    syncStackToggles();
    syncHud();
    var muni = params.get('muni');
    if (muni) focusMuni(muni);
    var q = params.get('q');
    if (q && searchEl) { searchEl.value = q; }
  }

  document.querySelectorAll('[data-layer]').forEach(function (box) {
    box.addEventListener('change', function () {
      showLayer(box.getAttribute('data-layer'), box.checked);
      syncThemePressed();
      syncStackToggles();
    });
  });
  document.querySelectorAll('[data-stack-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-stack-toggle');
      if (id === 'l0') {
        terrainOn = !terrainOn;
        applyTerrain();
        applyPitch();
      } else if (id === 'l1') {
        extrudeOn = !extrudeOn;
        applyExtrusion();
      } else {
        var stack = stackById(id);
        var ids = (stack && stack.layers) || [];
        var turnOn = ids.some(function (lid) { return !on[lid]; });
        ids.forEach(function (lid) { showLayer(lid, turnOn); });
      }
      syncStackToggles();
      syncHud();
    });
  });
  var pitchBtn = document.getElementById('shell-pitch');
  if (pitchBtn) pitchBtn.addEventListener('click', function () {
    pitched = !(pitched && terrainOn);
    if (pitched && !terrainOn) {
      terrainOn = true;
      applyTerrain();
    }
    applyPitch();
    syncStackToggles();
    syncHud();
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
    var n = applyText(d.question || '', cited, d.answer || '');
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    setBadge('files', n);
    var place = pickRule(d.question) || pickRule(d.answer);
    if (!place) return;
    var pane = document.body.getAttribute('data-pane') || 'map';
    var mapBtn = document.querySelector('.shell-tabs [data-pane="map"]');
    function arrived() {
      if (!mapBtn) return;
      mapBtn.classList.remove('is-arrived');
      void mapBtn.offsetWidth;
      mapBtn.classList.add('is-arrived');
    }
    if (pane === 'chat') {
      showPane('map');
      arrived();
      toast('El mapa ya muestra ese lugar.', 'The map now shows that place.');
    } else if (pane === 'files') {
      setBadge('map', 1);
      arrived();
    }
  });
  window.addEventListener('bcs:placechange', function (ev) {
    var id = ev.detail && ev.detail.place;
    var map = { los_cabos: 'Los Cabos', la_paz: 'La Paz', loreto: 'Loreto', comondu: 'Comondú', mulege_north: 'Mulegé' };
    if (id && map[id]) focusMuni(map[id]);
    else if (!id && engine && engine.fitBox) engine.fitBox(null);
  });

  var shell = document.querySelector('.shell');
  function drag(handle, key, sign, minW, probeSel) {
    if (!handle || !shell) return;
    handle.addEventListener('pointerdown', function (e) {
      if (window.matchMedia('(max-width: 900px)').matches) return;
      e.preventDefault();
      var probe = shell.querySelector(probeSel);
      var startX = e.clientX;
      var start = probe ? probe.getBoundingClientRect().width : 240;
      function move(ev) {
        var next = Math.max(minW, Math.min(window.innerWidth * 0.42, start + sign * (ev.clientX - startX)));
        shell.style.setProperty(key, next + 'px');
        shell.style.setProperty('--map-w', '1fr');
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
  drag(document.getElementById('split-l'), '--chat-w', 1, 200, '.shell-chat');
  drag(document.getElementById('split-r'), '--files-w', -1, 96, '.shell-files');
  function resizeMapSoon() {
    setTimeout(function () {
      if (engine && engine.resize) engine.resize();
      if (leafletMap) leafletMap.invalidateSize();
    }, 40);
  }
  function setDock(id) {
    var same = document.body.classList.contains('shell-dock-open') && document.body.getAttribute('data-dock') === id;
    document.querySelectorAll('.shell-stack > li').forEach(function (li) {
      li.classList.toggle('is-open', !same && li.getAttribute('data-dock-panel') === id);
    });
    document.querySelectorAll('.shell-dock-chips [data-dock]').forEach(function (btn) {
      btn.setAttribute('aria-selected', !same && btn.getAttribute('data-dock') === id ? 'true' : 'false');
    });
    document.body.classList.toggle('shell-dock-open', !same);
    if (same) document.body.removeAttribute('data-dock');
    else document.body.setAttribute('data-dock', id);
    resizeMapSoon();
  }
  document.querySelectorAll('.shell-dock-chips [data-dock]').forEach(function (btn) {
    btn.addEventListener('click', function () { setDock(btn.getAttribute('data-dock')); });
  });
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

  var gesture = { x: 0, y: 0, moved: false };
  document.addEventListener('pointerdown', function (e) {
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    gesture.moved = false;
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (Math.abs(e.clientX - gesture.x) + Math.abs(e.clientY - gesture.y) > 16) gesture.moved = true;
  }, true);
  function showPane(name) {
    document.body.setAttribute('data-pane', name);
    try {
      if (window.matchMedia('(max-width: 900px)').matches) sessionStorage.setItem('bcs-shell-pane', name);
    } catch (e) {}
    document.querySelectorAll('[data-pane]').forEach(function (b) {
      var on = b.getAttribute('data-pane') === name;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        var badge = b.querySelector('.shell-badge');
        if (badge && name === 'map') badge.hidden = true;
      }
    });
    setTimeout(function () {
      if (engine && engine.resize) engine.resize();
      if (leafletMap) leafletMap.invalidateSize();
    }, 60);
  }
  function setBadge(name, count) {
    var btn = document.querySelector('.shell-tabs [data-pane="' + name + '"]');
    if (!btn) return;
    var badge = btn.querySelector('.shell-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'shell-badge';
      btn.appendChild(badge);
    }
    if (!count) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = count > 9 ? '9+' : String(count);
  }
  var toastTimer = 0;
  function toast(es, en) {
    var el = document.getElementById('shell-toast');
    if (!el || !window.matchMedia('(max-width: 900px)').matches) return;
    el.hidden = false;
    el.textContent = tx(es, en);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2400);
  }
  function setSheet(open) {
    document.body.classList.toggle('shell-sheet-open', !!open);
    var scrim = document.getElementById('shell-scrim');
    var btn = document.getElementById('shell-capas');
    if (scrim) scrim.hidden = !open;
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
  }
  var capasBtn = document.getElementById('shell-capas');
  if (capasBtn) capasBtn.addEventListener('click', function () {
    setSheet(!document.body.classList.contains('shell-sheet-open'));
  });
  var sheetX = document.getElementById('shell-sheet-x');
  if (sheetX) sheetX.addEventListener('click', function () { setSheet(false); });
  var scrim = document.getElementById('shell-scrim');
  if (scrim) scrim.addEventListener('click', function () { setSheet(false); });

  document.querySelectorAll('[data-pane]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (gesture.moved) return;
      showPane(btn.getAttribute('data-pane'));
    });
  });
  if (window.matchMedia('(max-width: 900px)').matches) {
    showPane(document.body.getAttribute('data-pane') || 'map');
  }

  function fitViewport() {
    var narrow = window.matchMedia('(max-width: 900px)').matches;
    var vv = window.visualViewport;
    if (!narrow || !vv) {
      document.documentElement.style.removeProperty('--shell-vvh');
      document.documentElement.style.removeProperty('--shell-vvt');
    } else {
      document.documentElement.style.setProperty('--shell-vvh', Math.round(vv.height) + 'px');
      document.documentElement.style.setProperty('--shell-vvt', Math.round(vv.offsetTop) + 'px');
    }
    if (engine && engine.resize) engine.resize();
    if (leafletMap) leafletMap.invalidateSize();
  }
  window.addEventListener('resize', fitViewport);
  window.addEventListener('orientationchange', function () { setTimeout(fitViewport, 180); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  fitViewport();

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
    getPitch: function () { return engine && engine.getPitch ? engine.getPitch() : null; },
  };
})();
