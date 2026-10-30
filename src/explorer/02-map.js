
  // DEM protocol: local cache first, sea flattened to 0 m (removes bathymetry relief and shading noise)
  const demMemory = new Map();
  let coarse = false;
  async function flatten(buf) {
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < 128) { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; } }
    ctx.putImageData(im, 0, 0);
    const out = cv.convertToBlob ? await cv.convertToBlob({ type: 'image/png' }) : await new Promise(r => cv.toBlob(r, 'image/png'));
    return out.arrayBuffer();
  }
  async function cachedParent(z, x, y) {
    for (let pz = Math.min(z - 1, 7); pz >= 5; pz--) {
      const f = 2 ** (z - pz), key = `${pz}/${Math.floor(x / f)}/${Math.floor(y / f)}`;
      if (!S.manifest.terrain_tiles.includes(key)) continue;
      const r = await fetch(`${ROOT}terrain/${key}.png`); if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      const [c, ctx] = canvas(256, 256); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bmp, (x % f) * 256 / f, (y % f) * 256 / f, 256 / f, 256 / f, 0, 0, 256, 256);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      return blob.arrayBuffer();
    }
    throw new Error('Sin relieve local para esta zona');
  }
  function registerDem() {
    maplibregl.addProtocol('bcsdem', async (p, ctrl) => {
      const key = p.url.replace('bcsdem://', '').replace(/\.png$/, '');
      if (demMemory.has(key)) return { data: demMemory.get(key).slice(0) };
      const [z, x, y] = key.split('/').map(Number);
      let raw;
      try {
        const url = S.manifest.terrain_tiles.includes(key) ? `${ROOT}terrain/${key}.png` : `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
        const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error('Relieve no disponible');
        raw = await r.arrayBuffer();
      } catch (e) {
        if (ctrl.signal.aborted) throw e;
        raw = await cachedParent(z, x, y);
        if (!coarse) { coarse = true; setStatus('Relieve general (detalle sin conexión)'); }
      }
      const flat = await flatten(raw);
      if (demMemory.size > 400) demMemory.delete(demMemory.keys().next().value);
      demMemory.set(key, flat);
      return { data: flat.slice(0) };
    });
  }

  const BASE_STYLES = {
    ilustrado: { label: 'Ilustrado', ocean: '#c4d9dd', oceanDusk: '#b3c5cf' },
    satelite: { label: 'Satélite', ocean: '#2f4a5c', oceanDusk: '#2a3f50' },
    nocturno: { label: 'Nocturno', ocean: '#16233a', oceanDusk: '#141f33' }
  };
  const ATTR = {
    base: 'Relieve: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles (INEGI, USGS, NOAA…)</a> · Límites: INEGI/CONABIO · Natural Earth',
    osm: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© Colaboradores de OpenStreetMap (ODbL)</a>',
    satelite: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2016</a> by EOX IT Services GmbH (contiene datos modificados de Copernicus Sentinel 2016) · CC BY 4.0',
    nocturno: 'Luces nocturnas: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS · VIIRS Night Lights 2016 (Black Marble)</a> (dominio público)'
  };
  function skyFor(style, light) {
    if (style === 'nocturno') return { 'sky-color': '#1d2b45', 'horizon-color': '#33476a', 'fog-color': '#1f2d47', 'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.6 };
    if (light === 'dusk') return { 'sky-color': '#b9c6d2', 'horizon-color': '#efd9bf', 'fog-color': '#d9d1c4', 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.65, 'sky-horizon-blend': 0.7 };
    return { 'sky-color': '#d7e5ea', 'horizon-color': '#f3f0e6', 'fog-color': '#e7ece7', 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.65, 'sky-horizon-blend': 0.65 };
  }
  function styleSpec() {
    const dem = { type: 'raster-dem', tiles: ['bcsdem://{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, minzoom: 5, maxzoom: 14, bounds: [-118, 20, -106, 31.5] };
    const B = S.base, empty = { type: 'FeatureCollection', features: [] };
    const sel = types => ['match', ['geometry-type'], types, true, false];
    return {
      version: 8,
      sources: {
        dem: { ...dem }, shade: { ...dem },
        sat: { type: 'raster', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'], tileSize: 256, maxzoom: 15 },
        night: { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Night_Lights/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'], tileSize: 256, maxzoom: 8 },
        land: { type: 'geojson', data: B.land }, bcs: { type: 'geojson', data: B.boundary }, munis: { type: 'geojson', data: B.municipalities },
        bands: { type: 'geojson', data: empty }, major: { type: 'geojson', data: B.majorCities }, sel: { type: 'geojson', data: empty }
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': BASE_STYLES.ilustrado.ocean } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.04, 'raster-brightness-min': 0.04, 'raster-fade-duration': 200 } },
        { id: 'night-land', type: 'fill', source: 'land', layout: { visibility: 'none' }, paint: { 'fill-color': '#1e2c44' } },
        { id: 'night-bcs', type: 'fill', source: 'bcs', layout: { visibility: 'none' }, paint: { 'fill-color': '#22324c' } },
        { id: 'land-context', type: 'fill', source: 'land', paint: { 'fill-color': '#e7e2d4', 'fill-opacity': 0.92 } },
        { id: 'coast-halo', type: 'line', source: 'bcs', paint: { 'line-color': '#e2efec', 'line-width': 7, 'line-opacity': 0.75, 'line-blur': 3 } },
        { id: 'bcs-land', type: 'fill', source: 'bcs', paint: { 'fill-color': '#ece3cb' } },
        { id: 'bands', type: 'fill', source: 'bands', paint: { 'fill-color': ['match', ['get', 'min_m'], 150, '#ddd2b3', 450, '#c9caae', 900, '#b3bfae', 1500, '#a7b5b5', '#ddd2b3'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 9.5, 0.3, 11.5, 0] } },
        { id: 'hills', type: 'hillshade', source: 'shade', paint: { 'hillshade-illumination-direction': 315, 'hillshade-exaggeration': 0.62, 'hillshade-shadow-color': '#71878c', 'hillshade-highlight-color': '#fbf8ee', 'hillshade-accent-color': '#97a597' } },
        { id: 'night', type: 'raster', source: 'night', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1, 'raster-hue-rotate': 0, 'raster-saturation': 0.2, 'raster-contrast': 0.25, 'raster-fade-duration': 200, 'raster-resampling': 'linear' } },
        { id: 'muni-lines', type: 'line', source: 'munis', layout: { 'line-join': 'round' }, paint: { 'line-color': '#62798a', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 10, 1.4], 'line-opacity': 0.6, 'line-dasharray': [3, 2.5] } },
        { id: 'coast', type: 'line', source: 'bcs', paint: { 'line-color': '#6f8c98', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.1], 'line-opacity': 0.55 } },
        { id: 'sel-fill', type: 'fill', source: 'sel', filter: sel(['Polygon', 'MultiPolygon']), paint: { 'fill-color': '#c08a2e', 'fill-opacity': 0.14 } },
        { id: 'sel-line', type: 'line', source: 'sel', filter: sel(['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c08a2e', 'line-width': 3.5, 'line-opacity': 0.95 } },
        { id: 'sel-point', type: 'circle', source: 'sel', filter: sel(['Point', 'MultiPoint']), paint: { 'circle-radius': 15, 'circle-color': '#fbf8f1', 'circle-opacity': 0.25, 'circle-stroke-color': '#c08a2e', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } },
        { id: 'major-labels', type: 'symbol', source: 'major', layout: { 'icon-image': ['concat', 'lbl-', ['get', '_k']], 'icon-anchor': 'top', 'icon-offset': [0, 4], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.86, 8, 0.98, 11, 1.05], 'icon-allow-overlap': false, 'symbol-sort-key': ['-', 0, ['get', 'pop']], 'icon-padding': 3 } }
      ],
      terrain: { source: 'dem', exaggeration: 1 },
      sky: skyFor('ilustrado', 'day')
    };
  }
  function colorFor(id) { return S.style === 'nocturno' ? NIGHT[id] : S.style === 'satelite' ? SAT[id] : COLORS[id][0]; }
  function caseColor() { return S.style === 'nocturno' ? '#22324c' : S.style === 'satelite' ? '#26323b' : '#fbf8f1'; }
  function updateAttribution() {
    const parts = [ATTR.base, ATTR.osm];
    if (S.style === 'satelite') parts.push(ATTR.satelite);
    if (S.style === 'nocturno') parts.push(ATTR.nocturno);
    $('#ex-attrib').innerHTML = parts.join(' · ');
  }
  function applyBaseStyle(style, { quiet = false } = {}) {
    S.style = style;
    document.body.dataset.basemap = style;
    $$('[data-basemap]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.basemap === style)));
    updateAttribution();
    try { localStorage.setItem('bcs-explorar-base', style); } catch (_) {}
    if (!S.ready) return;
    const m = S.map, vis = (id, on) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const dusk = S.light === 'dusk';
    m.setPaintProperty('ocean', 'background-color', dusk ? BASE_STYLES[style].oceanDusk : BASE_STYLES[style].ocean);
    vis('sat', style === 'satelite'); vis('night', style === 'nocturno'); vis('night-land', style === 'nocturno'); vis('night-bcs', style === 'nocturno');
    vis('land-context', style === 'ilustrado'); vis('bcs-land', style === 'ilustrado'); vis('bands', style === 'ilustrado'); vis('coast-halo', style === 'ilustrado');
    const P = (l, k, v) => m.setPaintProperty(l, k, v);
    if (style === 'ilustrado') {
      P('hills', 'hillshade-exaggeration', 0.62); P('hills', 'hillshade-shadow-color', dusk ? '#6f7f8f' : '#71878c'); P('hills', 'hillshade-highlight-color', dusk ? '#f4e6cf' : '#fbf8ee');
      P('bcs-land', 'fill-color', dusk ? '#e2d3b4' : '#ece3cb'); P('muni-lines', 'line-color', '#62798a'); P('coast', 'line-color', '#6f8c98');
    } else if (style === 'satelite') {
      P('hills', 'hillshade-exaggeration', 0.22); P('hills', 'hillshade-shadow-color', '#2c3a44'); P('hills', 'hillshade-highlight-color', '#f2efe6');
      P('muni-lines', 'line-color', '#f3eee2'); P('coast', 'line-color', '#e8f0f2');
    } else {
      P('hills', 'hillshade-exaggeration', 0.35); P('hills', 'hillshade-shadow-color', '#111b2b'); P('hills', 'hillshade-highlight-color', '#5d7190');
      P('muni-lines', 'line-color', '#8ea3c4'); P('coast', 'line-color', '#7f95b6');
    }
    m.setSky(skyFor(style, S.light));
    for (const L of S.layers.values()) if (L.added) recolor(L);
    for (const f of S.base.majorCities.features) {
      const im = `lbl-${f.properties._k}`;
      if (m.hasImage(im)) m.updateImage(im, labelImage(f.properties._n, labelStyle(26)));
    }
    if (!quiet) toast(style === 'satelite' ? 'Satélite: mosaico Sentinel-2 sin nubes 2016 (EOX, CC BY 4.0). Baja la opacidad de las capas si necesitas ver la imagen.'
      : style === 'nocturno' ? 'Nocturno: luces nocturnas VIIRS 2016 (NASA Black Marble). Mide luz emitida; no es población ni consumo.' : 'Ilustrado: relieve real con paleta cartográfica.');
  }
  function labelStyle(size) {
    return S.style === 'nocturno' ? { size, color: '#e9eef6', bg: 'rgba(28,42,66,.92)', border: 'rgba(160,185,215,.45)' }
      : S.style === 'satelite' ? { size, color: '#24384a', bg: 'rgba(251,248,241,.95)', border: 'rgba(36,56,74,.3)' } : { size };
  }

  // thematic layers
  function meta(id) { return S.layers.get(id)?.meta; }
  async function ensureLoaded(id) {
    const L = S.layers.get(id);
    if (!L) throw new Error('Capa desconocida');
    if (L.data) return L;
    if (!L.loading) {
      L.loading = getJSON(L.meta.file).then(d => {
        L.data = d; L.byKey = new Map(d.features.map(f => [f.properties._k, f]));
        if (S.ready) addMapLayers(L);
        return L;
      }).catch(e => { L.loading = null; throw e; });
    }
    return L.loading;
  }
  const CITY_BANDS = [
    { s: 'z0', minzoom: 0, maxzoom: 7, min: 10000 }, { s: 'z1', minzoom: 7, maxzoom: 8.6, min: 2500 },
    { s: 'z2', minzoom: 8.6, maxzoom: 10, min: 400 }, { s: 'z3', minzoom: 10, maxzoom: 11.5, min: 40 }, { s: 'z4', minzoom: 11.5, min: -1 }
  ];
  function addMapLayers(L) {
    if (L.added || !S.ready) return;
    const m = S.map, id = L.meta.id, src = `t-${id}`, [, c1] = COLORS[id], color = colorFor(id);
    m.addSource(src, { type: 'geojson', data: L.data, tolerance: L.meta.geom === 'polygon' ? 0.45 : 0.3, buffer: 64 });
    L.layerIds = [];
    const add = (suffix, type, paint, layout = {}, filter, zoom = {}) => {
      const lid = `${src}-${suffix}`;
      const spec = { id: lid, type, source: src, layout: { ...layout, visibility: 'none' }, paint, ...zoom };
      if (filter) spec.filter = filter;
      m.addLayer(spec, type === 'symbol' ? 'major-labels' : 'sel-fill');
      L.layerIds.push({ id: lid, type, suffix });
    };
    const g = ['geometry-type'];
    const isPoly = ['match', g, ['Polygon', 'MultiPolygon'], true, false];
    const isLine = ['match', g, ['LineString', 'MultiLineString'], true, false];
    const isPoint = ['match', g, ['Point', 'MultiPoint'], true, false];
    const settle = { 'line-translate': [0, 0], 'line-translate-anchor': 'viewport', 'line-translate-transition': { duration: 0 }, 'line-opacity-transition': { duration: 0 } };
    const geom = L.meta.geom;
    if (geom === 'polygon' || geom === 'facility') {
      add('fill', 'fill', { 'fill-color': color, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } }, {}, isPoly);
      if (geom === 'polygon') add('vol', 'fill-extrusion', { 'fill-extrusion-color': c1, 'fill-extrusion-opacity': 0, 'fill-extrusion-base': 0, 'fill-extrusion-height': 0, 'fill-extrusion-vertical-gradient': false, 'fill-extrusion-opacity-transition': { duration: 0 }, 'fill-extrusion-height-transition': { duration: 0 }, 'fill-extrusion-base-transition': { duration: 0 } }, {}, isPoly);
      const lp = { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 1.8, 14, 2.6], 'line-opacity': 0, ...settle };
      if (DASH[id]) lp['line-dasharray'] = DASH[id];
      add('edge', 'line', lp, { 'line-join': 'round' }, isPoly);
    }
    if (geom === 'line') {
      const num = k => ['to-number', ['get', k], 0];
      const bands = id === 'rivers' ? [{ s: 'reg', minzoom: 0, maxzoom: 9, f: ['all', isLine, ['>=', num('ORD_STRA'), 3]] }, { s: 'det', minzoom: 9, f: isLine }]
        : id === 'roads' ? [{ s: 'reg', minzoom: 0, maxzoom: 7.6, f: ['all', isLine, ['<=', ['get', '_rank'], 2]] }, { s: 'det', minzoom: 7.6, f: isLine }]
        : id === 'runoff' ? [{ s: 'reg', minzoom: 0, maxzoom: 8.5, f: ['all', isLine, ['>=', num('FULL_PATH_KM'), 25]] }, { s: 'det', minzoom: 8.5, f: isLine }]
        : [{ s: 'all', minzoom: 0, f: isLine }];
      for (const b of bands) {
        const z = { minzoom: b.minzoom }; if (b.maxzoom !== undefined) z.maxzoom = b.maxzoom;
        if (id === 'roads' || id === 'transmission') add(`case-${b.s}`, 'line', { 'line-color': caseColor(), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, id === 'roads' ? 2.6 : 2.2, 9, 4.2, 14, 7], 'line-opacity': 0, ...settle }, { 'line-cap': 'round', 'line-join': 'round' }, b.f, z);
        const w = id === 'roads' ? ['interpolate', ['linear'], ['zoom'], 5, ['match', ['get', '_rank'], 1, 1.4, 0.8], 9, ['match', ['get', '_rank'], 1, 2.6, 1.6], 14, 4.2]
          : id === 'rivers' ? ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.28, num('ORD_STRA')], 10, ['*', 0.5, num('ORD_STRA')], 14, 3]
          : id === 'runoff' ? ['interpolate', ['linear'], ['zoom'], 5, 0.7, 10, 1.5, 14, 2.4]
          : ['interpolate', ['linear'], ['zoom'], 5, 1.1, 10, 2, 14, 3.2];
        const lp = { 'line-color': color, 'line-width': w, 'line-opacity': 0, ...settle };
        if (DASH[id]) lp['line-dasharray'] = DASH[id];
        add(`line-${b.s}`, 'line', lp, { 'line-cap': 'round', 'line-join': 'round' }, b.f, z);
      }
    }
    const sym = L.meta.symbol;
    if (sym) {
      const img = `sym-${id}`;
      if (!m.hasImage(img)) m.addImage(img, symbolImage(sym, color, S.style === 'ilustrado' ? c1 : color, S.style === 'nocturno' ? '#d9e2ee' : '#fbf8f1'), { pixelRatio: 2 });
      const symPaint = () => ({ 'icon-opacity': 0, 'icon-translate': [0, 0], 'icon-translate-anchor': 'viewport', 'icon-opacity-transition': { duration: 0 }, 'icon-translate-transition': { duration: 0 } });
      const symLayout = { 'icon-image': img, 'icon-anchor': 'bottom', 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-padding': 2, 'symbol-placement': 'point' };
      if (id === 'cities') {
        const pop = ['to-number', ['get', 'pop'], 0];
        for (const b of CITY_BANDS) {
          const z = { minzoom: b.minzoom }; if (b.maxzoom !== undefined) z.maxzoom = b.maxzoom;
          add(`sym-${b.s}`, 'symbol', symPaint(), { ...symLayout, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['>=', pop, 50000], 0.9, 0.62], 10, ['case', ['>=', pop, 2500], 1.0, 0.72], 14, 1.0], 'symbol-sort-key': ['-', 0, pop] }, ['all', isPoint, ['>', pop, b.min]], z);
        }
        for (const f of L.data.features) {
          if ((f.properties.pop || 0) < 400) continue;
          const im = `lbl-${f.properties._k}`; if (!m.hasImage(im)) m.addImage(im, labelImage(f.properties._n, labelStyle(22)), { pixelRatio: 2 });
        }
        add('labels', 'symbol', { 'icon-opacity': 0, 'icon-opacity-transition': { duration: 0 } }, { 'icon-image': ['concat', 'lbl-', ['get', '_k']], 'icon-anchor': 'top', 'icon-offset': [0, 4], 'icon-size': 0.92, 'icon-allow-overlap': false, 'symbol-sort-key': ['-', 0, pop], 'icon-padding': 2 },
          ['all', isPoint, ['<', pop, 4000], ['step', ['zoom'], false, 8.4, ['>=', pop, 2000], 9.6, ['>=', pop, 400]]], { minzoom: 8.4 });
      } else {
        add('sym', 'symbol', symPaint(), { ...symLayout, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 9, 0.8, 13, 1.0] }, null, { minzoom: id === 'generators' ? 7.5 : 0 });
      }
    }
    L.added = true;
    for (const ly of L.layerIds) {
      m.on('mouseenter', ly.id, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', ly.id, () => { m.getCanvas().style.cursor = ''; });
    }
  }
  function recolor(L) {
    const m = S.map, id = L.meta.id, color = colorFor(id), [, c1] = COLORS[id];
    for (const ly of L.layerIds) {
      if (ly.type === 'fill') m.setPaintProperty(ly.id, 'fill-color', color);
      if (ly.type === 'line') m.setPaintProperty(ly.id, 'line-color', ly.suffix.startsWith('case') ? caseColor() : color);
    }
    const img = `sym-${id}`;
    if (L.meta.symbol && m.hasImage(img)) m.updateImage(img, symbolImage(L.meta.symbol, color, S.style === 'ilustrado' ? c1 : color, S.style === 'nocturno' ? '#d9e2ee' : '#fbf8f1'));
    if (id === 'cities') for (const f of L.data.features) { const im = `lbl-${f.properties._k}`; if (m.hasImage(im)) m.updateImage(im, labelImage(f.properties._n, labelStyle(22))); }
    if (L.active && !L.anim) paintLayer(L, 1);
  }

  const FILL_OP = { protected: 0.22, priority: 0.14, zoning: 0.1, agrarian: 0.08, plants: 0.35, substations: 0.35, generators: 0.35 };
  function paintLayer(L, progress) {
    const m = S.map, e = 1 - Math.pow(1 - progress, 3), done = progress >= 1, k = L.opacity * S.global, id = L.meta.id;
    for (const ly of L.layerIds) {
      if (!m.getLayer(ly.id)) continue;
      if (ly.type === 'symbol') {
        if (ly.suffix !== 'labels') m.setPaintProperty(ly.id, 'icon-translate', [0, -70 * (1 - e)]);
        m.setPaintProperty(ly.id, 'icon-opacity', Math.min(1, progress * 3) * Math.max(k, 0.35));
      } else if (ly.type === 'fill-extrusion') {
        m.setPaintProperty(ly.id, 'fill-extrusion-base', 9000 * (1 - e));
        m.setPaintProperty(ly.id, 'fill-extrusion-height', 9060 * (1 - e));
        m.setPaintProperty(ly.id, 'fill-extrusion-opacity', done ? 0 : 0.2 * Math.min(1, progress * 5));
        if (done) m.setLayoutProperty(ly.id, 'visibility', 'none');
      } else if (ly.type === 'fill') {
        m.setPaintProperty(ly.id, 'fill-opacity', Math.min(0.6, (FILL_OP[id] ?? 0.18) * (0.1 + 0.9 * e) * k * (S.style === 'satelite' ? 1.5 : 1)));
      } else if (ly.type === 'line') {
        const base = ly.suffix.startsWith('case') ? 0.75 : ly.suffix === 'edge' ? 0.85 : 0.92;
        m.setPaintProperty(ly.id, 'line-opacity', base * e * k);
        m.setPaintProperty(ly.id, 'line-translate', [0, -50 * (1 - e)]);
      }
    }
  }
  let rafId = 0;
  function tick(t) {
    rafId = 0;
    let busy = false;
    for (const L of S.layers.values()) {
      if (!L.anim) continue;
      if (L.anim.start === null) L.anim.start = t + L.anim.delay;
      const p = Math.max(0, Math.min(1, (t - L.anim.start) / L.anim.duration));
      paintLayer(L, p);
      if (p >= 1) { L.anim = null; L.installing = false; renderLayerRows(); } else busy = true;
    }
    if (busy) rafId = requestAnimationFrame(tick);
  }
  function install(L, delay = 0) {
    if (!L.added) return;
    for (const ly of L.layerIds) S.map.setLayoutProperty(ly.id, 'visibility', ly.type === 'fill-extrusion' && reduced() ? 'none' : 'visible');
    if (reduced()) { L.anim = null; L.installing = false; paintLayer(L, 1); renderLayerRows(); return; }
    L.installing = true; L.anim = { start: null, delay, duration: 1100 };
    paintLayer(L, 0);
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  async function setActive(id, on, { delay = 0, silent = false } = {}) {
    const L = S.layers.get(id); if (!L) return;
    if (on) {
      L.active = true; renderLayerRows();
      try { await ensureLoaded(id); } catch (e) {
        L.active = false; renderLayerRows();
        toast(`No se pudo cargar «${L.meta.label}». Comprueba la conexión; el resto del atlas sigue disponible.`);
        return;
      }
      if (!L.active) return;
      if (S.ready) install(L, delay);
      if (!silent) setStatus(`${L.meta.label}: ${fmt(L.meta.count)} ${L.meta.unit}`);
    } else {
      L.active = false; L.anim = null; L.installing = false;
      if (L.added) for (const ly of L.layerIds) S.map.setLayoutProperty(ly.id, 'visibility', 'none');
      if (S.selection?.layer === id) clearSelectionHighlight();
    }
    renderLayerRows(); syncUrl();
  }
  async function preset(name) {
    const ids = S.manifest.presets[name] || [];
    let d = 0;
    for (const id of S.order) if (!ids.includes(id) && S.layers.get(id).active) setActive(id, false);
    await Promise.all(ids.filter(id => !S.layers.get(id).active).map(id => setActive(id, true, { delay: (d++) * 130, silent: true })));
    setStatus(`Combinación «${$(`[data-preset="${name}"]`)?.textContent || name}»: ${ids.length} capas`);
    renderLayerRows();
  }
  function replay() {
    let d = 0;
    for (const L of S.layers.values()) if (L.active && L.added) install(L, (d++) * 130);
    if (!d) { preset(S.manifest.presets.basico ? 'basico' : 'esencial'); return; }
    if (!reduced() && S.map.getPitch() < 30) S.map.easeTo({ pitch: 55, duration: 800 });
  }
