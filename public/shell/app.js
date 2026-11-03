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
  var pendingPoint = null;
  var iclusterOn = { uso: false, parcelas: false };
  var identifyToken = 0;
  var answerLayers = {};
  var latestAnswer = null;
  var basicGroups = { places:['osm_towns'], roads:['osm_highways'], water:['focus_water_dmas','osm_waterways'], nature:['anp_federales'] };
  function syncBasic() {
    document.querySelectorAll('[data-basic]').forEach(function(btn) {
      var ids = basicGroups[btn.getAttribute('data-basic')] || [];
      btn.setAttribute('aria-pressed', ids.length && ids.every(function(id){return !!on[id];}) ? 'true' : 'false');
    });
  }
  function mapSummary(es,en) { var node=document.getElementById('twin-map-summary'); if(node)node.textContent=tx(es,en); }
  function autoLayer(id) { if(!on[id])answerLayers[id]=true; return showLayer(id,true); }


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
    if (info.maps && info.maps.length) {
      html += '<p class="shell-fiche-kicker">' + tx('Cartas publicadas, no georreferenciadas', 'Published maps, not georeferenced') + '</p>';
      info.maps.forEach(function (item) {
        html += '<p><a href="' + esc(item[0]) + '" target="_blank" rel="noopener noreferrer">' + esc(tx(item[1], item[2] || item[1])) + '</a></p>';
        html += '<img src="' + esc(item[0]) + '" alt="' + esc(tx(item[1], item[2] || item[1])) + '">';
      });
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
        var row = files[Number(btn.getAttribute('data-fiche-file'))];
        if (row) location.assign('/catalogo/?q=' + encodeURIComponent(fileName(row)));
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
    if (meta && meta.description_es) rows.push({ es: 'Qué muestra', en: 'What it shows', value: tx(meta.description_es, meta.description_en) });
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
  function openBuildingFiche(p) {
    var loc = lang() === 'en' ? 'en-US' : 'es-MX';
    function n(v, d) { return Number(v).toLocaleString(loc, { maximumFractionDigits: d || 0 }); }
    var est = p.hm == null ? tx('Sin estimación', 'No estimate') : n(p.hm, 1) + ' m';
    var drawn = n(p.h, 1) + ' m' + (p.hm == null ? tx(' (mínimo visual sin estimación)', ' (visual minimum; no estimate)') : p.hm < 3 ? tx(' (dibujada como una planta: la estimación es menor de 3 m)', ' (drawn as one storey: the estimate is under 3 m)') : '');
    openFiche({
      kind_es: 'Edificio · huella y altura estimada', kind_en: 'Building · footprint and estimated height',
      title: tx('Edificio', 'Building') + ' · ' + n(p.a) + ' m²',
      rows: [
        { es: 'Altura estimada (media)', en: 'Estimated height (mean)', value: est },
        { es: 'Altura estimada (máxima)', en: 'Estimated height (max)', value: p.hx == null ? '' : n(p.hx, 1) + ' m' },
        { es: 'Altura dibujada', en: 'Height drawn', value: drawn },
        { es: 'Plantas aproximadas', en: 'Approximate storeys', value: p.hm == null ? est : String(p.n) },
        { es: 'Superficie de la huella', en: 'Footprint area', value: n(p.a) + ' m²' },
        { es: 'Manzana INEGI 2020', en: 'INEGI 2020 block', value: p.mz || tx('Fuera de manzanas urbanas', 'Outside urban blocks') },
        { es: 'Fuente', en: 'Source', value: tx('Huella: Google Open Buildings v3 (imagen de 50 cm). Altura: Google Open Buildings 2.5D, 2023 (Sentinel-2, resolución efectiva 4 m).', 'Footprint: Google Open Buildings v3 (50 cm imagery). Height: Google Open Buildings 2.5D, 2023 (Sentinel-2, effective 4 m).') },
        { es: 'Lectura', en: 'Reading', value: tx('La altura es una estimación de modelo: distingue casas de una a tres plantas de torres, no da el metro exacto. No es un levantamiento ni catastro.', 'Height is a model estimate: it tells one-to-three-storey houses from towers, not the exact metre. It is not a survey or cadastre.') },
      ],
    });
  }
  function openFeatureFiche(feature, lngLat, meta, note) {
    var p = (feature && feature.properties) || {};
    var layerId = feature && feature.layer && feature.layer.id || '';
    if (layerId.indexOf('cdt-bld-') === 0) { openBuildingFiche(p); return; }
    if (layerId === 'cdt-muni-fill' || layerId === 'cdt-muni-extrude' || layerId === 'cdt-muni-line' || layerId === 'cdt-bars') {
      if (p.name) openMuniFiche(p.name);
      return;
    }
    var title = featureLabel(p) || (meta ? (lang() === 'en' ? meta.name_en : meta.name_es) : '');
    if (!title) return;
    var rows = [];
    if (meta && meta.palette) {
      var category = Number.isInteger(p.level) && meta.labels[p.level];
      if (meta.id.indexOf('haz_') === 0) rows.push({es:'Nivel de peligro',en:'Hazard level',value:category || tx('Sin datos','No data')});
      if (p.value != null) rows.push({es:'Densidad',en:'Density',value:p.value + (meta.id === 'density' ? ' hab/ha' : ' hab/km²')});
      if (p.tdpa != null) rows.push({es:'Tránsito diario promedio (2024)',en:'Annual average daily traffic (2024)',value:p.tdpa+' veh/día'},
        {es:'Demanda horaria estimada',en:'Estimated hourly demand',value:p.peak+' veh/h'}, {es:'Sentido del aforo',en:'Count direction',value:p.sc===0?tx('Ambos','Both'):String(p.sc)});
      if (p.grade) rows.push({es:'Nivel de servicio (2024)',en:'Level of service (2024)',value:p.grade},
        {es:'Volumen horario de referencia',en:'Reference hourly volume',value:p.vh+' veh/h'},
        {es:'Umbral del nivel E',en:'Level E threshold',value:p.capacity+' veh/h'},
        {es:'Volumen / umbral E',en:'Volume / level E threshold',value:p.ratio+' %'});
      if (p.road) rows.push({es:'Carretera',en:'Road',value:p.road+' · km '+p.km});
    }
    if (meta) rows.push({ es: 'Capa', en: 'Layer', value: lang() === 'en' ? meta.name_en : meta.name_es });
    var fields = [
      ['MUNICIPIO', 'Municipio', 'Municipality'],
      ['CLAVE', 'Clave del núcleo', 'Ejido code'],
      ['ref', 'Clave', 'Code'],
      ['place', 'Tipo en el mapa', 'Map type'],
      ['kind', 'Clase', 'Kind'],
      ['population', 'Población publicada', 'Published population'],
      ['pobtot', 'Población publicada', 'Published population'],
      ['municipio', 'Municipio', 'Municipality'],
      ['municipality', 'Municipio', 'Municipality'],
      ['priceFormatted', 'Precio anunciado', 'Asking price'],
      ['currency', 'Moneda', 'Currency'],
      ['propertyType', 'Tipo de propiedad', 'Property type'],
      ['bedrooms', 'Recámaras', 'Bedrooms'],
      ['bathrooms', 'Baños', 'Bathrooms'],
      ['coordPrecision', 'Precisión de ubicación', 'Location precision'],
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
      ['CLASIFICAC', 'Clasificación', 'Classification'],
      ['politica', 'Política (sufijo)', 'Policy suffix'],
      ['UGA_MUN', 'Municipio de la UGA', 'UGA municipality'],
      ['sup_Ha', 'Superficie de origen (ha)', 'Source area (ha)'],
      ['CODE_PA', 'Código de política', 'Policy code'],
      ['icao', 'ICAO', 'ICAO'],
      ['iata', 'IATA', 'IATA'],
    ];
    fields.forEach(function (field) {
      var key = lang() === 'en' && field[3] && p[field[3]] != null && p[field[3]] !== '' ? field[3] : field[0];
      var raw = p[key];
      if (raw == null || raw === '' || typeof raw === 'object') return;
      var value = String(raw);
      if(field[0]==='propertyType'&&lang()!=='en')value=({RESIDENTIAL:'Casa',CONDO:'Departamento',LAND:'Terreno',MULTI_FAMILY:'Vivienda multifamiliar'})[value]||value;
      if (field[0] === 'monto_MXN' && !isNaN(Number(raw))) value = Number(raw).toLocaleString(lang() === 'en' ? 'en-US' : 'es-MX');
      if (field[0] === 'sup_Ha' && !isNaN(Number(raw))) value = Number(raw).toLocaleString(lang() === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1 });
      if (field[0] === 'politica') {
        var names = { AS: ['Aprovechamiento sustentable', 'Sustainable use'], PT: ['Protección', 'Protection'], PR: ['Preservación', 'Preservation'], RT: ['Restauración', 'Restoration'], OTRA: ['Otra clave', 'Other code'] };
        if (names[value]) value = value + ' — ' + tx(names[value][0], names[value][1]);
      }
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
      href: meta && meta.id === 'programas' && /^https:\/\/www\.(?:bcs|cbcs)\.gob\.mx\//.test(p.source_url || '') ? p.source_url : meta && meta.reference || href,
      href_es: meta && meta.reference ? 'Consultar fuente' : 'Página relacionada',
      href_en: meta && meta.reference ? 'View source' : 'Related page',
      gaps: gap ? [gap] : [],
      files: filesFor(title),
    });
    if (meta && meta.palette && lngLat) providerButtons(meta, lngLat);
    if (lngLat && engine && engine.mark) engine.mark(lngLat.lng, lngLat.lat, title);
  }
  function dmsPart(base) {
    var abs = Math.abs(base);
    var degrees = Math.floor(abs);
    var t = (abs - degrees) * 60;
    var minutes = Math.floor(t);
    var seconds = Math.round((t - minutes) * 6000) / 100;
    if (seconds >= 60) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    return degrees + '° ' + minutes + "' " + seconds.toFixed(2) + '"';
  }
  function dmsPair(lng, lat) {
    return dmsPart(lng) + (lng < 0 ? ' W' : ' E') + ', ' + dmsPart(lat) + (lat < 0 ? ' S' : ' N');
  }
  function washOnly(feature) {
    var id = feature && feature.layer && feature.layer.id || '';
    return id === 'cdt-muni-fill' || id === 'cdt-muni-extrude' || id === 'cdt-muni-line' || id === 'cdt-bars';
  }
  function openIclusterFiche(data, lngLat) {
    var hit = data && data.hit;
    var parcel = data && data.parcel;
    var rows = [];
    var title = tx('Punto', 'Point');
    var kindEs = 'iCluster';
    var kindEn = 'iCluster';
    if (hit && hit.code) {
      title = hit.code;
      kindEs = hit.table || 'Uso de suelo';
      kindEn = 'Land use';
    } else if (parcel && (parcel.code || parcel.nombre)) {
      title = parcel.code || parcel.nombre;
      kindEs = parcel.table || 'Parcelas';
      kindEn = 'Parcels';
    } else if (data && data.locality) title = data.locality;
    if (hit && hit.uso) rows.push({ es: 'Uso de suelo', en: 'Land use', value: String(hit.uso) });
    else if (iclusterOn.uso) rows.push({ es: 'Uso de suelo', en: 'Land use', value: tx('La capa no devolvió un polígono en este punto.', 'The layer returned no polygon at this point.') });
    if (parcel && (parcel.code || parcel.nombre)) rows.push({ es: 'Parcela', en: 'Parcel', value: String(parcel.code || parcel.nombre) });
    else if (iclusterOn.parcelas) rows.push({ es: 'Parcela', en: 'Parcel', value: tx('La capa no devolvió una parcela en este punto.', 'The layer returned no parcel at this point.') });
    if (data && data.locality) rows.push({ es: 'Localidad', en: 'Locality', value: data.locality });
    if (data && data.municipality) rows.push({ es: 'Municipio', en: 'Municipality', value: data.municipality });
    if (data && data.state) rows.push({ es: 'Entidad', en: 'State', value: data.state });
    if (lngLat) rows.push({ es: 'Coordenadas', en: 'Coordinates', value: dmsPair(lngLat.lng, lngLat.lat) });
    rows.push({ es: 'Fuente', en: 'Source', value: 'IMPLAN Los Cabos / SIG BCS' });
    var attrs = [];
    if (hit && hit.attributes) attrs = attrs.concat(hit.attributes);
    if (parcel && parcel.attributes) attrs = attrs.concat(parcel.attributes);
    attrs.forEach(function (row) {
      if (!row || row.value == null || row.value === '') return;
      rows.push({ es: String(row.label), en: String(row.label), value: String(row.value) });
    });
    openFiche({ title: title, kind_es: kindEs, kind_en: kindEn, rows: rows });
    if (lngLat && engine && engine.mark) engine.mark(lngLat.lng, lngLat.lat, title);
  }
  function identifyIcluster(lngLat, token) {
    var layers = [];
    if (iclusterOn.uso) layers.push('cimp100');
    if (iclusterOn.parcelas) layers.push('cspyde100');
    if (!layers.length || !lngLat) return;
    openFiche({
      title: tx('Consultando iCluster', 'Asking iCluster'),
      kind_es: 'Identify',
      kind_en: 'Identify',
      rows: [{ es: 'Punto', en: 'Point', value: dmsPair(lngLat.lng, lngLat.lat) }],
    });
    var zoom = lngLat.zoom != null ? lngLat.zoom : 16;
    var url = '/api/icluster-wms?op=identify&layers=' + layers.join(',')
      + '&lng=' + encodeURIComponent(lngLat.lng) + '&lat=' + encodeURIComponent(lngLat.lat)
      + '&zoom=' + encodeURIComponent(zoom);
    fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      if (token !== identifyToken) return;
      if (!data || !data.ok) {
        openFiche({
          title: tx('Sin respuesta', 'No response'),
          kind_es: 'iCluster',
          kind_en: 'iCluster',
          rows: [
            { es: 'Identify', en: 'Identify', value: tx('iCluster no respondió. No hay atributos de este punto.', 'iCluster did not respond. There are no attributes for this point.') },
            { es: 'Coordenadas', en: 'Coordinates', value: dmsPair(lngLat.lng, lngLat.lat) },
            { es: 'Fuente', en: 'Source', value: 'IMPLAN Los Cabos / SIG BCS' },
          ],
        });
        return;
      }
      openIclusterFiche(data, lngLat);
    }).catch(function () {
      if (token !== identifyToken) return;
      openFiche({
        title: tx('Sin respuesta', 'No response'),
        kind_es: 'iCluster',
        kind_en: 'iCluster',
        rows: [
          { es: 'Identify', en: 'Identify', value: tx('iCluster no respondió. No hay atributos de este punto.', 'iCluster did not respond. There are no attributes for this point.') },
          { es: 'Coordenadas', en: 'Coordinates', value: dmsPair(lngLat.lng, lngLat.lat) },
          { es: 'Fuente', en: 'Source', value: 'IMPLAN Los Cabos / SIG BCS' },
        ],
      });
    });
  }
  function onMapFeature(feats, lngLat) {
    identifyToken += 1;
    var specific = (feats || []).filter(function (feature) { return !washOnly(feature); });
    if (specific.length) {
      var feature = specific[0];
      var id = String(feature.layer && feature.layer.id || '').replace(/^cdt-ly-/, '').replace(/-(?:edge|3d|label|detail)$/, '');
      openFeatureFiche(feature, lngLat, byId[id]);
      return;
    }
    if (iclusterOn.uso || iclusterOn.parcelas) {
      identifyIcluster(lngLat, identifyToken);
      return;
    }
    if (feats && feats.length) {
      var wash = feats[0];
      var washId = String(wash.layer && wash.layer.id || '').replace(/^cdt-ly-/, '').replace(/-(?:edge|3d|label|detail)$/, '');
      openFeatureFiche(wash, lngLat, byId[washId]);
      return;
    }
    closeFiche();
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

  var highlightedMuni = '';
  function paintMuni(name) {
    highlightedMuni = name || '';
    if (!engine || !engine.paintMunis) return;
    if (!name) { engine.paintMunis(null); return; }
    var colors = {};
    colors[name] = { fill: '#7ec8e8', line: '#006BA3', weight: 3.2, opacity: 0.5 };
    engine.paintMunis(colors);
  }
  function framePad(kind) {
    var narrow = window.matchMedia('(max-width: 900px)').matches;
    if (kind === 'town') return narrow ? { top: 86, bottom: 78, left: 20, right: 20 } : { top: 56, bottom: 44, left: 28, right: 230 };
    return narrow ? { top: 78, bottom: 70, left: 18, right: 18 } : { top: 48, bottom: 40, left: 24, right: 220 };
  }
  function flyBox(box, opts) {
    if (!box) return;
    if (engine && engine.fitBox) engine.fitBox(box, opts || { padding: framePad('muni'), maxZoom: 9.6, pitch: pitched ? PITCH_ON : 0 });
    else if (leafletMap && window.L) leafletMap.fitBounds([[box[1], box[0]], [box[3], box[2]]]);
  }
  function flyPoint(lng, lat, label, opts) {
    if (engine && engine.mark) engine.mark(lng, lat, label || '');
    var span = 0.28;
    if (engine && engine.fitBox) engine.fitBox([lng - span, lat - span * 0.75, lng + span, lat + span * 0.75], opts || { padding: framePad('town'), maxZoom: 11.2, pitch: pitched ? 54 : 0 });
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
        setStatus('Encuadre: municipio de ' + name + '.', 'Frame: the municipality of ' + name + '.');
        openMuniFiche(name);
      }
      return { kind: 'muni', name: name };
    });
  }
  var placeIndex = null;
  function loadPlaces() {
    if (placeIndex) return Promise.resolve(placeIndex);
    function pull(url) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    return Promise.all([pull('/gis/osm_towns.geojson'), pull('/gis/settlements.geojson'), loadMunis()]).then(function (all) {
      var byKey = {};
      function addTowns(geo, source) {
        ((geo && geo.features) || []).forEach(function (f) {
          var p = f.properties || {};
          var g = f.geometry;
          if (!p.name || !g || g.type !== 'Point' || !g.coordinates) return;
          var key = norm(p.name);
          if (key.length < 5) return;
          var row = { name: p.name, key: key, lng: Number(g.coordinates[0]), lat: Number(g.coordinates[1]), muni: p.municipio || '', pop: p.pobtot || p.population || '', source: source };
          var prev = byKey[key];
          if (!prev || source === 'settlements') byKey[key] = row;
        });
      }
      addTowns(all[0], 'osm_towns');
      addTowns(all[1], 'settlements');
      var munis = ((all[2] && all[2].features) || []).map(function (f) {
        return { name: f.properties && f.properties.name, key: norm(f.properties && f.properties.name), feature: f };
      }).filter(function (m) { return m.name; });
      placeIndex = { towns: Object.keys(byKey).map(function (k) { return byKey[k]; }), munis: munis };
      return placeIndex;
    });
  }
  function bestPlace(text) {
    var q = norm(text || '');
    if (!q || !placeIndex) return null;
    var muniHit = null;
    placeIndex.munis.forEach(function (m) {
      if (q.indexOf(m.key) === -1) return;
      if (!muniHit || m.key.length > muniHit.key.length) muniHit = m;
    });
    var townHit = null;
    placeIndex.towns.forEach(function (t) {
      if (q.indexOf(t.key) === -1) return;
      if (!townHit || t.key.length > townHit.key.length) townHit = t;
    });
    if (townHit && (!muniHit || townHit.key.length > muniHit.key.length)) return { kind: 'town', town: townHit, muni: muniHit };
    if (muniHit) return { kind: 'muni', muni: muniHit };
    return null;
  }
  function focusTown(town) {
    if (town.muni) paintMuni(town.muni);
    flyPoint(town.lng, town.lat, town.name);
    var rows = [];
    var pop = Number(String(town.pop || '').replace(/[^\d.]/g, ''));
    if (pop > 0) rows.push({ es: 'Población publicada', en: 'Published population', value: pop.toLocaleString(lang() === 'en' ? 'en-US' : 'es-MX') });
    if (town.muni) rows.push({ es: 'Municipio', en: 'Municipality', value: town.muni });
    rows.push({ es: 'Qué se marca', en: 'What is marked', value: tx('El punto es la localidad publicada en el archivo de lugares. No es un edificio ni un predio.', 'The point is the locality published in the places file. It is not a building or a parcel.') });
    openFiche({ title: town.name, kind_es: 'Localidad', kind_en: 'Locality', rows: rows });
    setStatus('Encuadre: ' + town.name + '.', 'Frame: ' + town.name + '.');
    return { kind: 'town', name: town.name };
  }
  function markReady() {
    mapReady = true;
    var ids = Object.keys(on).filter(function (id) { return on[id]; });
    Promise.all(ids.map(function (id) { return showLayer(id, true); })).then(function () {
      if (pendingPoint) { flyPoint(pendingPoint[0],pendingPoint[1],pendingPoint[2]);pendingPoint=null; }
      else if (pendingJob) executeJob(pendingJob.question, pendingJob.sources, pendingJob.answer);
      else if (pendingMuni) focusMuni(pendingMuni);
      else if (engine && engine.fitBox) engine.fitBox(null);
      if (engine && engine.resize) engine.resize();
      if (leafletMap) leafletMap.invalidateSize();
    });
  }

  function showLayer(id, visible) {
    var meta = byId[id];
    if (!meta) return Promise.resolve();
    on[id] = !!visible;
    syncBasic();
    document.querySelectorAll('[data-layer="' + id + '"]').forEach(function (box) { box.checked = !!visible; });
    if (engine) {
      if (!visible) { engine.hide(id); return Promise.resolve(); }
      return engine.load(meta).then(function (geo) {
        if (geo && on[id]) engine.show(id, geo, meta, 'on');
        if (!geo) { on[id]=false; syncBasic(); setStatus('No se pudo cargar una capa. Intenta activarla de nuevo.', 'A layer could not be loaded. Try enabling it again.'); }
        return geo;
      });
    }
    if (leafletMap && window.L) {
      if (!visible) {
        if (leafletLayers[id]) leafletMap.removeLayer(leafletLayers[id]);
        return Promise.resolve();
      }
      if (meta.type === 'raster') {
        if (!leafletLayers[id]) leafletLayers[id] = L.tileLayer(meta.url,{opacity:.7,tileSize:256,minNativeZoom:5,maxNativeZoom:9,bounds:[[22.75,-115.8],[28.02,-109.35]],noWrap:true});
        leafletLayers[id].addTo(leafletMap);
        return Promise.resolve();
      }
      return fetch(meta.url).then(function (r) { return r.json(); }).then(function (geo) {
        if (!on[id]) return geo;
        if (leafletLayers[id]) leafletMap.removeLayer(leafletLayers[id]);
        leafletLayers[id] = L.geoJSON(geo, {
          style: function (feat) { if(meta.palette) return {color:meta.palette[feat.properties.level] || '#919b9c',weight:.3,fillOpacity:.7}; return { color: meta.color || '#0083C4', weight: 1.4, fillOpacity: 0.2 }; },
          onEachFeature: function (feature, layer) {
            if (meta.reference) layer.on('click', function (event) { openFeatureFiche(feature, event.latlng, meta); });
          },
          pointToLayer: function (feat, latlng) {
            return L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1, fillColor: (meta.palette && meta.palette[feat.properties.level]) || meta.color || '#0083C4', fillOpacity: 0.9 });
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
    ids.forEach(function (lid) { delete answerLayers[lid]; showLayer(lid, turnOn); });
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
    { re: /\bmls\b|oferta inmobiliaria|real estate listings|propiedades en (?:venta|mercado)/, layers: ['bcs_market_listings'] },
    { re: /acuifer|agua|water|novillo|oomsapas|santo domingo|\b0306\b/, layers: ['focus_water_dmas', 'osm_waterways'] },
    { re: /termosolar|el crucero|\bcfe\b/, layers: ['federal_projects'] },
    { re: /proteg|anp|natural area|area natural/, layers: ['anp_federales', 'rtp_conabio'] },
    { re: /carretera|highway|movilidad|aeropuerto|puerto|airport|port/, layers: ['osm_highways', 'osm_transport_nodes', 'focus_ports_air'] },
    { re: /vivienda|housing|sniiv/, layers: ['settlements', 'focus_water_dmas'] },
    { re: /proyecto federal|federal project/, layers: ['federal_projects'] },
  ];

  function sueloAsk(text) {
    var q = norm(text || '');
    if (/icluster|i-cluster|cluster economico|clusteres econom/.test(q)) return 'icluster';
    if (/pducp|pdu la paz|pdu de la paz/.test(q)) return 'pducp';
    if (/pdu\s*2040|pdu2040|implan los cabos/.test(q)) return 'pdu';
    if (/poer|poerbcs|\buga\b|politica ambiental|uso de suelo|usos del suelo|zonific/.test(q)) return 'poer';
    return '';
  }
  function openSuelo(kind) {
    if (kind === 'poer') {
      openFiche({
        title: 'POERBCS',
        kind_es: 'Uso de suelo publicado',
        kind_en: 'Published land use',
        rows: [
          { es: 'Qué se dibuja', en: 'What is drawn', value: tx('69 polígonos de unidades de gestión ambiental. El color es el sufijo de CLASIFICAC: AS, PR, PT o RT.', '69 environmental management unit polygons. Color is the CLASIFICAC suffix: AS, PR, PT or RT.') },
          { es: 'Fuente', en: 'Source', value: 'SEPUIMM — POERBCS' },
        ],
        gaps: [],
      });
      return;
    }
    if (kind === 'pdu') {
      openFiche({
        title: 'PDU 2040 Los Cabos',
        kind_es: 'Instrumento publicado',
        kind_en: 'Published instrument',
        rows: [
          { es: 'Polígonos', en: 'Polygons', value: tx('Próximo / sin datos. Hay cartas JPG y PDF del IMPLAN, sin archivo de georreferencia. No se inventa la zonificación.', 'Upcoming / no data. IMPLAN map images and PDFs exist, with no georeference file. Zoning is not invented.') },
          { es: 'Fuente', en: 'Source', value: 'IMPLAN Los Cabos — PDU 2040' },
        ],
        maps: [
          ['/maps/pdu2040-et-401-zonificacion-primaria.jpg', 'Zonificación primaria', 'Primary zoning'],
          ['/maps/pdu2040-et-403-zonificacion-secundaria.jpg', 'Zonificación secundaria', 'Secondary zoning'],
          ['/maps/pdu2040-carta-sintesis.jpg', 'Carta síntesis', 'Synthesis map'],
        ],
      });
      return;
    }
    if (kind === 'pducp') {
      openFiche({
        title: 'PDU de La Paz',
        kind_es: 'Instrumento descrito, no cargado',
        kind_en: 'Instrument described, not loaded',
        rows: [
          { es: 'Polígonos', en: 'Polygons', value: tx('Próximo / sin datos. La nota de entrega cita zonificacion_pducp del Visor Urbano, pero ese GeoPackage no está en el portal.', 'Upcoming / no data. The delivery note cites Visor Urbano zonificacion_pducp, but that GeoPackage is not in the portal.') },
        ],
      });
      return;
    }
    openFiche({
      title: 'iCluster — uso de suelo IMPLAN',
      kind_es: 'Capa publicada del visor estatal',
      kind_en: 'Published state-viewer layer',
      rows: [
        { es: 'Qué se dibuja', en: 'What is drawn', value: tx('Uso de suelo de IMPLAN Los Cabos (capa cimp100) del visor iCluster. Aparece al acercar la costa de Los Cabos.', 'IMPLAN Los Cabos land use (layer cimp100) from the iCluster viewer. It appears when you zoom to the Los Cabos coast.') },
        { es: 'Fuente', en: 'Source', value: 'IMPLAN Los Cabos / SIG BCS — http://sig.bcs.gob.mx/iclusterbcs/' },
      ],
    });
  }
  function setIcluster(kind, on) {
    if (iclusterOn[kind] != null) iclusterOn[kind] = !!on;
    if (engine && engine.setIcluster) engine.setIcluster(kind, on);
    document.querySelectorAll('[data-icluster="' + kind + '"]').forEach(function (box) { box.checked = !!on; });
    if (on && kind === 'uso' && engine && engine.jumpCamera) {
      engine.jumpCamera({ lng: -109.78, lat: 22.99, zoom: 11, bearing: -18, pitch: engine.getPitch ? engine.getPitch() : 50 });
    }
  }
  function pickRule(text) {
    var q = norm(text || '');
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(q)) return RULES[i];
    return null;
  }
  function executeJob(question, sources, answer) {
    var q = norm((question || '') + ' ' + (answer || ''));
    Object.keys(answerLayers).forEach(function(id){showLayer(id,false);});
    answerLayers={};
    closeFiche();
    var jobs = [];
    var suelo = sueloAsk(question || '');
    if (suelo === 'poer' && byId.poer_ugas) jobs.push(autoLayer('poer_ugas'));
    var pillar = pillarOf(question || '');
    THEME_RULES.forEach(function (rule) {
      if (!rule.re.test(q)) return;
      rule.layers.forEach(function (id) { if (byId[id]) jobs.push(autoLayer(id)); });
    });
    if (pillar) pillar.layers.forEach(function (id) { if (byId[id]) jobs.push(autoLayer(id)); });
    var place = pickRule(question);
    var statewide = !place && /cada municipio|por municipio|municipalities|estado|state|baja california sur/i.test(question||'');
    if (!place && !statewide) place=pickRule(answer);
    var cameraSet = false;
    if(statewide){pendingMuni='';cameraSet=true;paintMuni('');if(engine&&engine.fitBox)engine.fitBox(null);}
    var gaps = pillar ? [pillar.id] : [];
    if (place) {
      var useMuni = place.muniIf && place.muniIf.test(norm(question || '') + ' ' + norm(answer || ''));
      (place.layers || []).forEach(function (id) { if (byId[id]) jobs.push(autoLayer(id)); });
      if (useMuni && place.muni) {
        cameraSet = true;
        jobs.push(focusMuni(place.muni, false).then(function () {
          if (place.noteIf) setStatus(place.noteIf[0], place.noteIf[1]);
        }));
      } else if (place.layer && byId[place.layer]) {
        jobs.push(autoLayer(place.layer).then(function (geo) {
          var hit = geo && place.hit ? findNamed(geo, place.hit) : null;
          var pt = hit ? pointOf(hit.feature) : null;
          if (pt) {
            cameraSet = true;
            flyPoint(pt.lng, pt.lat, place.pin || hit.name);
            if (place.note) setStatus(place.note[0], place.note[1]);
          } else if (place.muni) {
            cameraSet = true;
            return focusMuni(place.muni, false);
          }
        }));
      }
    } else if (pillar) {
      setStatus(GAPS[pillar.id][0], GAPS[pillar.id][1]);
    } else if (jobs.length && !suelo) {
      setStatus('El mapa encendió las capas de esa respuesta.', 'The map turned on the layers for that answer.');
    }
    if (suelo === 'pdu') jobs.push(focusMuni('Los Cabos', true));
    if (suelo === 'pducp') jobs.push(focusMuni('La Paz', true));
    if (suelo === 'icluster') setIcluster('uso', true);
    function layerPhrase() {
      var names = Object.keys(answerLayers).filter(function (id) { return on[id] && byId[id]; }).map(function (id) {
        return lang() === 'en' ? byId[id].name_en : byId[id].name_es;
      }).slice(0, 3);
      if (!names.length) return ['', ''];
      return [' Capas encendidas: ' + names.join(', ') + '.', ' Layers on: ' + names.join(', ') + '.'];
    }
    return Promise.all(jobs).then(function () {
      if (cameraSet) return null;
      return loadPlaces().then(function () {
        var hit = bestPlace(question) || bestPlace(answer);
        if (hit && hit.kind === 'town') return focusTown(hit.town);
        if (hit && hit.kind === 'muni') return focusMuni(hit.muni.name, false);
        if (place && place.muni) return focusMuni(place.muni, false);
        return null;
      });
    }).then(function (framed) {
      syncThemePressed();
      syncStackToggles();
      var extra = layerPhrase();
      if (framed && framed.kind === 'town') {
        mapSummary('Encuadre: ' + framed.name + ', localidad publicada. El punto sale del archivo de lugares.' + extra[0], 'Frame: ' + framed.name + ', a published locality. The point comes from the places file.' + extra[1]);
      } else if (framed && framed.kind === 'muni') {
        mapSummary('Encuadre: municipio de ' + framed.name + '. El contorno marca ese municipio.' + extra[0], 'Frame: the municipality of ' + framed.name + '. The outline marks that municipality.' + extra[1]);
      } else if (cameraSet && statewide) {
        mapSummary('Vista de todo Baja California Sur.' + extra[0], 'View of all Baja California Sur.' + extra[1]);
      } else if (place || jobs.length || suelo) {
        mapSummary('Capas y lugares relacionados con tu consulta.' + extra[0], 'Layers and places related to your question.' + extra[1]);
      } else {
        mapSummary('Esta respuesta no tiene una ubicación cartográfica identificada.', 'No mapped location was identified for this answer.');
      }
      syncBasic();
    });
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
      var box = document.querySelector('[data-buildings]');
      var places = document.querySelector('[data-building-places]');
      if (box && places && eng.setBuildings) {
        fetch('/gis/edificios/index.json').then(function (r) {
          if (!r.ok) throw Error('buildings');
          return r.json();
        }).then(function (ix) {
          ix.cities.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).forEach(function(c){
            var option=document.createElement('option'); option.value=c.id; option.textContent=c.name;
            places.appendChild(option);
          });
          box.disabled=false; places.disabled=false;
          box.onchange=function(){ eng.setBuildings(box.checked); };
          places.onchange=function(){
            var c=ix.cities.find(function(item){return item.id===places.value;});
            if (!c) return;
            var point=c.center || (c.bbox && [(c.bbox[0]+c.bbox[2])/2,(c.bbox[1]+c.bbox[3])/2]);
            if (!point) return;
            box.checked=true; eng.setBuildings(true);
            eng.jumpCamera({lng:point[0],lat:point[1],zoom:16.2,bearing:-16,pitch:reduceMotion?0:52});
            syncPitchBtn();
          };
          eng.setBuildings(box.checked);
        }).catch(function(){setStatus('No se pudo cargar la lista de edificios.', 'Building coverage could not be loaded.');});
      }
      setBasemap(basemap);
      applyTerrain();
      applyExtrusion();
      syncPitchBtn();
      syncHud();
      var ids = Object.keys(on).filter(function (id) { return on[id]; });
      return Promise.all(ids.map(function (id) { return showLayer(id, true); })).then(markReady);
    }).catch(function () { boot2d(); });
  }

  function fileName(row) { return String(row[0] || '').replace(/\.[a-z0-9]{2,5}$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
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
        img.replaceWith(document.createTextNode(tx('No se pudo cargar esta imagen.', 'This image could not be loaded.')));
      });
      return;
    }
    previewEl.innerHTML = closeBtn + '<p><strong></strong></p><a target="_blank" rel="noopener noreferrer"></a>';
    previewEl.querySelector('strong').textContent = name;
    var a = previewEl.querySelector('a');
    a.href = href;
    a.textContent = tx('Abrir documento ↗', 'Open document ↗');
    if (row[5]) { var note=document.createElement('p');note.textContent=row[5];previewEl.insertBefore(note,a); }
  }
  if (previewEl) {
    previewEl.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.shell-preview-x')) return;
      previewEl.hidden = true;
      previewEl.innerHTML = '';
    });
  }

  function fileExt(row) { return String(row[2] || '').toLowerCase().replace(/^\./, ''); }
  function fileType(row) {
    var ext = fileExt(row);
    var kind = fileKind(row);
    if (kind === 'i' || /^(jpe?g|png|gif|webp|tif|tiff)$/.test(ext)) return { key: 'img', es: 'Imagen', en: 'Image', mark: 'IMG' };
    if (kind === 'w' || ext === 'web' || ext === 'html' || ext === 'htm') return { key: 'web', es: 'Página', en: 'Page', mark: 'WEB' };
    if (ext === 'pdf') return { key: 'pdf', es: 'PDF', en: 'PDF', mark: 'PDF' };
    if (/^(xls|xlsx|csv|ods|tsv)$/.test(ext)) return { key: 'sheet', es: 'Tabla', en: 'Table', mark: 'TAB' };
    if (/^(ppt|pptx|key)$/.test(ext)) return { key: 'slides', es: 'Láminas', en: 'Slides', mark: 'PPT' };
    if (/^(doc|docx|odt|rtf|txt|md)$/.test(ext)) return { key: 'doc', es: 'Texto', en: 'Text', mark: 'DOC' };
    if (/^(zip|rar|7z|gz)$/.test(ext)) return { key: 'zip', es: 'Paquete', en: 'Package', mark: 'ZIP' };
    if (ext) return { key: 'file', es: ext.toUpperCase(), en: ext.toUpperCase(), mark: ext.slice(0, 3).toUpperCase() };
    return { key: 'file', es: 'Archivo', en: 'File', mark: 'DOC' };
  }
  function folderLabel(id) {
    var folders = (index && index.folders) || [];
    for (var i = 0; i < folders.length; i++) {
      if (folders[i][0] === id) return lang() === 'en' ? folders[i][2] : folders[i][1];
    }
    if (id === 'sources') return tx('Fuente citada', 'Cited source');
    return '';
  }
  function fileCrumb(row) {
    var type = fileType(row);
    var folder = folderLabel(fileFolder(row));
    var typeLabel = lang() === 'en' ? type.en : type.es;
    return folder ? folder + ' · ' + typeLabel : typeLabel;
  }
  function openVerb(row) {
    if (fileKind(row) === 'i') return tx('Ver', 'View');
    if (/export=download|[?&]dl=1|\/uc\?/.test(String(fileHref(row) || ''))) return tx('Bajar', 'Save');
    return tx('Abrir', 'Open');
  }
  function rowButton(row) {
    var type = fileType(row);
    var wrap = document.createElement('article');
    wrap.className = 'shell-file';
    var ico = document.createElement('span');
    ico.className = 'shell-ext';
    ico.setAttribute('data-type', type.key);
    ico.textContent = type.mark;
    ico.setAttribute('aria-hidden', 'true');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-file-main';
    var name = document.createElement('strong');
    name.textContent = fileName(row);
    var crumb = document.createElement('small');
    crumb.textContent = fileCrumb(row);
    btn.appendChild(name);
    btn.appendChild(crumb);
    var note = row[5] ? String(row[5]) : '';
    btn.title = note ? fileName(row) + '. ' + note : fileName(row) + ' — ' + fileCrumb(row);
    btn.setAttribute('aria-label', tx('Ver ficha: ', 'View card: ') + fileName(row));
    btn.addEventListener('click', function () { renderPreview(row); });
    wrap.appendChild(ico);
    wrap.appendChild(btn);
    var href = fileHref(row);
    if (href) {
      var a = document.createElement('a');
      a.className = 'shell-file-open';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = openVerb(row);
      a.setAttribute('aria-label', openVerb(row) + ': ' + fileName(row));
      wrap.appendChild(a);
    }
    return wrap;
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
    if (!relatedEl) return 0;
    var citations = window.ShellEvidence.sources(sources);
    var citedUrls = {};
    citations.forEach(function(s){citedUrls[s.href]=true;});
    relatedEl.hidden = false;
    relatedEl.innerHTML = '';
    var label = document.createElement('p'); label.className='shell-tree-label';
    label.textContent=tx('Fuentes de esta respuesta','Sources for this answer')+' · '+citations.length;
    relatedEl.appendChild(label);
    if(!citations.length) {
      var empty=document.createElement('p');empty.className='twin-source-note';
      empty.textContent=tx('Esta respuesta no incluye fuentes consultables. Puedes explorar el archivo.','This answer includes no linked sources. You can browse the archive.');relatedEl.appendChild(empty);
    }
    citations.forEach(function(s){
      s.row[5]=s.direct ? tx('Fuente citada por el asistente. Abre el original para comprobar el dato y su fecha.','Source cited by the assistant. Open the original to check the figure and its date.') : tx('Referencia citada. El enlace busca el documento en el catálogo.','Cited reference. The link searches for the document in the catalog.');
      relatedEl.appendChild(rowButton(s.row));
    });
    if(index) {
      var qWords=wordsOf(question), scored=[];
      index.files.forEach(function(row){
        if(citedUrls[fileHref(row)])return;
        var blob=fileBlob(row).split(/[^a-z0-9]+/);var score=qWords.filter(function(w){return blob.indexOf(w)!==-1;}).length;
        if(score>=2)scored.push({score:score,row:row});
      });
      scored.sort(function(a,b){return b.score-a.score;});
      if(scored.length){
        var more=document.createElement('details');more.className='twin-related-more';
        var summary=document.createElement('summary');summary.textContent=tx('Otros archivos relacionados','Other related files');more.appendChild(summary);
        var note=document.createElement('p');note.textContent=tx('Sugeridos por el tema de tu pregunta; no son fuentes citadas en esta respuesta.','Suggested by the topic of your question; these are not sources cited in this answer.');more.appendChild(note);
        scored.slice(0,6).forEach(function(item){more.appendChild(rowButton(item.row));});relatedEl.appendChild(more);
      }
    }
    return citations.length;
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
    if (highlightedMuni) paintMuni(highlightedMuni);
    else if (engine.setMuniWash) engine.setMuniWash(0.14);
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

  var analysisSelect = document.getElementById('analysis-select');
  var analysisPanel = document.getElementById('analysis-panel');
  var activeAnalysis = '';
  function showAnalysisLegend() {
    if (!analysisSelect) return;
    Array.from(analysisSelect.options).forEach(function(opt){ if(opt.dataset.es) opt.textContent=tx(opt.dataset.es,opt.dataset.en); });
    var layer = byId[activeAnalysis], legend = document.getElementById('analysis-legend');
    legend.replaceChildren();
    document.getElementById('analysis-caption').textContent = layer ? tx(layer.description_es, layer.description_en) : tx('Elige qué quieres ver.','Choose a map.');
    if (!layer) return;
    var labels = layer.labels.slice(), colors = layer.palette.slice();
    if (layer.id.indexOf('haz_') === 0) {
      labels = lang()==='en' ? ['Very low','Low','Medium','High','No data'] : labels.concat('Sin datos');
      colors.push('#919b9c');
    }
    labels.forEach(function (label, index) {
      var item = document.createElement('span'), swatch = document.createElement('i');
      swatch.style.background = colors[index]; item.append(swatch, label); legend.append(item);
    });
  }
  if (analysisSelect) {
    analysisSelect.addEventListener('change', function() {
      if (activeAnalysis) showLayer(activeAnalysis,false);
      activeAnalysis = analysisSelect.value;
      if (activeAnalysis) showLayer(activeAnalysis,true);
      closeFiche(); showAnalysisLegend();
    });
    new MutationObserver(showAnalysisLegend).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    [analysisPanel,document.getElementById('land-water')].forEach(function(panel,index,panels){
      panel.addEventListener('toggle',function(){ if(panel.open) panels[1-index].open=false; });
    });
  }
  function providerButtons(meta, loc) {
    var panel = document.getElementById('shell-fiche');
    var choices=meta.id==='traffic'||meta.id==='bottlenecks' ? ['traffic','biodiversity'] : ['biodiversity'];
    choices.forEach(function(provider){
      var button=document.createElement('button'), result=document.createElement('p');
      button.type='button';result.setAttribute('role','status');
      button.textContent=provider==='traffic'?tx('Ver demora actual · TomTom','Current delay · TomTom'):tx('Consultar biodiversidad a 1 km · IBAT','Biodiversity within 1 km · IBAT');
      button.addEventListener('click',async function(){
        button.disabled=true;result.textContent=tx('Consultando…','Checking…');
        try {
          var r=await fetch('/.netlify/functions/map-provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:provider,lat:loc.lat,lng:loc.lng})});
          var data=await r.json();
          if(!r.ok) {
            result.textContent=data.error==='not_configured'?tx('Conexión pendiente de activar.','Connection awaits activation.'):tx('Sin lectura disponible para este punto.','No reading available here.');
          } else if(provider==='traffic') {
            result.textContent=(data.closed?tx('Vía cerrada. ','Road closed. '):'')+data.speed+' km/h · '+tx('flujo libre ','free flow ')+data.freeSpeed+' km/h · '+tx('demora ','delay ')+Math.round(data.delaySeconds)+' s · '+new Date(data.retrieved).toLocaleTimeString();
          } else result.textContent=data.count+tx(' áreas clave de biodiversidad en 1 km.',' key biodiversity areas within 1 km.');
        } catch {result.textContent=tx('No se pudo consultar la fuente.','Source unavailable.');}
        finally {button.disabled=false;}
      });
      panel.append(button,result);
    });
  }
  function readBoot() {
    var params = new URLSearchParams(location.search);
    if (params.get('vista') === 'tierra-agua') {
      var panel = document.getElementById('land-water');
      if (panel) {
        panel.open = true;
        panel.querySelectorAll('[data-layer]').forEach(function (box) { on[box.dataset.layer] = true; });
      }
    }
    if (analysisSelect && params.get('vista') === 'analisis') {
      var id = params.get('capa');
      activeAnalysis = byId[id] && byId[id].palette ? id : 'temperature';
      analysisSelect.value=activeAnalysis; on[activeAnalysis]=true; analysisPanel.open=true;
    }
    showAnalysisLegend();
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
      delete answerLayers[box.getAttribute('data-layer')];
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
        ids.forEach(function (lid) { delete answerLayers[lid]; showLayer(lid, turnOn); });
      }
      syncStackToggles();
      syncHud();
      syncBasic();
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
    searchEl.addEventListener('input', function () { var archive=document.getElementById('twin-archive');if(archive)archive.open=!!searchEl.value;renderTree(searchEl.value); });
  }
  document.addEventListener('bcs:lang', function () {
    if (searchEl) {
      searchEl.placeholder = tx(searchEl.getAttribute('data-lang-placeholder-es') || 'Buscar', searchEl.getAttribute('data-lang-placeholder-en') || 'Search');
    }
    renderTree(searchEl ? searchEl.value : '');
    if(latestAnswer)focusFiles(latestAnswer.question,latestAnswer.sources,latestAnswer.answer);
  });
  document.addEventListener('bcs:chat-start', function(){
    pendingJob=null;latestAnswer=null;
    mapSummary('Consultando las fuentes… El mapa conserva tu vista.','Checking sources… Your map view is unchanged.');
    if(previewEl){previewEl.hidden=true;previewEl.innerHTML='';}
    if(relatedEl){relatedEl.hidden=false;relatedEl.textContent=tx('Buscando fuentes para tu pregunta…','Finding sources for your question…');}
    setBadge('files',0);setBadge('map',0);
  });
  document.addEventListener('bcs:chat-error', function(){
    mapSummary('No se pudo completar la consulta. Puedes intentarlo de nuevo.','The question could not be completed. Please try again.');
    if(relatedEl)relatedEl.textContent=tx('No se obtuvieron fuentes. Intenta enviar la pregunta de nuevo.','No sources were retrieved. Try sending the question again.');
  });
  document.addEventListener('bcs:chat-answer', function(ev){
    var d=ev.detail||{};
    if(d.ok===false){document.dispatchEvent(new CustomEvent('bcs:chat-error'));return;}
    var cited=(d.sources||[]).slice();if(d.primary_file)cited.push(d.primary_file);
    latestAnswer={question:d.question||'',sources:cited,answer:d.answer||''};
    var n;
    if(d.grounded===false){n=focusFiles(d.question,cited,d.answer);mapSummary('No hay evidencia suficiente para actualizar el mapa.','There is insufficient evidence to update the map.');}
    else n=applyText(d.question||'',cited,d.answer||'');
    setBadge('files',n);
    // Keep the answer readable on mobile; indicate available map context instead of changing panes.
    if(window.matchMedia('(max-width: 900px)').matches && d.grounded!==false){
      setBadge('map',1);toast('Respuesta lista. Puedes abrir Mapa o Fuentes.','Answer ready. You can open Map or Sources.');
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
  document.querySelectorAll('[data-suelo]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var kind = btn.getAttribute('data-suelo');
      if (kind === 'poer') showLayer('poer_ugas', true);
      if (kind === 'pdu') focusMuni('Los Cabos', true);
      if (kind === 'pducp') focusMuni('La Paz', true);
      openSuelo(kind);
    });
  });
  document.querySelectorAll('[data-icluster]').forEach(function (box) {
    box.addEventListener('change', function () {
      var kind = box.getAttribute('data-icluster');
      setIcluster(kind, box.checked);
      if (box.checked) openSuelo('icluster');
    });
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
    if(document.body.classList.contains('map-page'))name='map';
    if (name !== 'map') setSheet(false);
    document.body.setAttribute('data-pane', name);
    try {
      if (window.matchMedia('(max-width: 900px)').matches) sessionStorage.setItem('bcs-shell-pane', name);
    } catch (e) {}
    document.querySelectorAll('button[data-pane]').forEach(function (b) {
      var on = b.getAttribute('data-pane') === name;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        var badge = b.querySelector('.shell-badge');
        if (badge) badge.hidden = true;
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
    if (!open) document.body.classList.remove('shell-dock-open');
    var scrim = document.getElementById('shell-scrim');
    var btn = document.getElementById('shell-capas');
    if (scrim) scrim.hidden = true;
    if(open){setDock(document.body.getAttribute('data-dock')||'l0');var closer=document.getElementById('shell-sheet-x');if(closer)closer.focus();}
    else if(document.getElementById('shell-sheet')&&document.getElementById('shell-sheet').contains(document.activeElement)&&btn)btn.focus();
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

  document.querySelectorAll('button[data-pane]').forEach(function (btn) {
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

  document.querySelectorAll('[data-basic]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var ids=basicGroups[btn.getAttribute('data-basic')]||[];
      var enable=ids.some(function(id){return !on[id];});
      ids.forEach(function(id){delete answerLayers[id];showLayer(id,enable);});
      syncBasic();
      syncStackToggles();
      mapSummary(enable?'Capas activadas. Selecciona un elemento para ver su información.':'Capas desactivadas.',enable?'Layers enabled. Select a feature to view its information.':'Layers disabled.');
    });
  });
  var help=document.getElementById('twin-help'),guide=document.getElementById('twin-guide');
  function closeGuide(){if(!guide)return;guide.hidden=true;help.setAttribute('aria-expanded','false');help.focus();}
  if(help)help.addEventListener('click',function(){guide.hidden=!guide.hidden;help.setAttribute('aria-expanded',String(!guide.hidden));if(!guide.hidden)document.getElementById('twin-help-close').focus();});
  document.getElementById('twin-help-close').addEventListener('click',closeGuide);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(guide&&!guide.hidden)closeGuide();else if(document.body.classList.contains('shell-sheet-open'))setSheet(false);else closeFiche();}});
  document.getElementById('twin-reset-map').addEventListener('click',function(){
    closeFiche();paintMuni('');if(engine&&engine.mark)engine.mark(null,null,'');if(engine&&engine.fitBox)engine.fitBox(null);if(leafletMap)leafletMap.fitBounds([[22.87,-115.22],[28,-109.41]]);
    mapSummary('Vista de todo Baja California Sur.','View of all Baja California Sur.');
  });
  // Home hands off a user-submitted question once, without putting its text into the URL.
  if(new URLSearchParams(location.search).get('conversation')==='1'){
    showPane('chat');
    try{var requestedQuestion=sessionStorage.getItem('bcs-twin-question');sessionStorage.removeItem('bcs-twin-question');
      if(requestedQuestion&&window.BCSChat)window.BCSChat.send(requestedQuestion);
    }catch(e){}
  }
  readBoot();
  try{var contextId=new URLSearchParams(location.search).get('context');if(contextId&&/^c[a-z0-9]+$/.test(contextId)){var context=JSON.parse(sessionStorage.getItem('bcs-map-'+contextId)||'null');if(context&&context.grounded!==false)applyText(context.question,context.sources,context.answer);}}catch(_){}
  syncBasic();
  setBasemap(basemap);
  boot3d();
  fetch('/shell/files.json').then(function (r) { return r.json(); }).then(function (data) {
    index = data;
    renderTree(searchEl ? searchEl.value : '');
    if(latestAnswer)focusFiles(latestAnswer.question,latestAnswer.sources,latestAnswer.answer);
    if(searchEl&&searchEl.value)document.getElementById('twin-archive').open=true;
  }).catch(function () {
    if (treeEl) treeEl.textContent = tx('No se pudo cargar el índice de archivos.', 'The file index could not be loaded.');
  });

  window.Shell = {
    applyText: applyText,
    showLayer: showLayer,
    setBasemap: setBasemap,
    focusMuni: focusMuni,
    focusPoint: function(lng,lat,label){pendingJob=null;pendingMuni='';if(!mapReady)pendingPoint=[lng,lat,label];else flyPoint(lng,lat,label);mapSummary('Lugar: '+label,'Place: '+label);},
    getBounds: function () { return engine && engine.getBounds ? engine.getBounds() : null; },
    getPitch: function () { return engine && engine.getPitch ? engine.getPitch() : null; },
  };
})();
