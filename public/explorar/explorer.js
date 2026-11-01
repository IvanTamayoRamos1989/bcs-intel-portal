/* BCS2050 · Explorar — atlas territorial 3D.
 * Rules: every map feature is drawn from its source geometry (no synthetic points, no inferred
 * links). The "instalar" transition is presentation only; resting position = original coordinate.
 * Relations are declared in data; conceptual links are labelled "conexión temática".
 */
(() => {
  'use strict';
  const ROOT = '/explorar/';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fmt = (n, d = 0) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const params = new URLSearchParams(location.search);
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => mqReduce.matches || params.has('sinmovimiento');
  const dur = ms => (reduced() ? 0 : ms);
  const isMobile = () => innerWidth <= 760;

  // palette (darkest tone is slate ink; see check_explorer)
  const COLORS = {
    cities: ['#3f6e8c', '#b9cfdb'], roads: ['#93754a', '#e3d3b3'], transport: ['#55678f', '#cdd5e6'],
    plants: ['#b07f2e', '#ecd8b0'], substations: ['#9c6a35', '#e6cfae'], transmission: ['#b8893f', '#efdcb6'], generators: ['#c09550', '#f0e0c0'],
    rivers: ['#2f7f9c', '#bcdbe4'], runoff: ['#5b9db3', '#cfe5ea'], protected: ['#58835c', '#cfe0c8'], priority: ['#7f9a62', '#dbe5c9'],
    zoning: ['#a8664a', '#ecd2c5'], agrarian: ['#a5835b', '#eadcc6']
  };
  const NIGHT = {
    cities: '#9cc4dc', roads: '#e2c58f', transport: '#b6c4ea', plants: '#f0c26e', substations: '#e8b27a', transmission: '#f2cf86', generators: '#f5d796',
    rivers: '#7fc6dd', runoff: '#a3d3e0', protected: '#9fd09c', priority: '#c6dc9c', zoning: '#e8a88c', agrarian: '#e2c39a'
  };
  const SAT = {
    cities: '#d9ecf7', roads: '#f6dfa8', transport: '#dfe6fb', plants: '#ffd27a', substations: '#ffc98f', transmission: '#ffe08f', generators: '#ffe3a6',
    rivers: '#8fdcf2', runoff: '#bfeaf5', protected: '#b6ecaa', priority: '#e2f2a6', zoning: '#ffbfa6', agrarian: '#f6dcb0'
  };
  const DASH = { transmission: [3, 2], runoff: [0.6, 1.8], priority: [4, 3], zoning: [1, 2], agrarian: [5, 2, 1, 2] };

  const LABELS = {
    NOM_LOC: 'Localidad', NOM_MUN: 'Municipio', ENTIDAD: 'Clave de entidad', MUN: 'Clave municipal', LOC: 'Clave de localidad', POBTOT: 'Población total 2020',
    ALTITUD: 'Altitud censal (m)', VIVTOT: 'Viviendas totales', VIVPAR_HAB: 'Viviendas particulares habitadas', VPH_C_ELEC: 'Viviendas con electricidad',
    VPH_S_ELEC: 'Viviendas sin electricidad', VPH_AGUADV: 'Viviendas con agua entubada', VPH_AGUAFV: 'Viviendas sin agua entubada', VPH_DRENAJ: 'Viviendas con drenaje',
    VPH_NODREN: 'Viviendas sin drenaje', VPH_INTER: 'Viviendas con internet', LONGITUD: 'Longitud publicada (DMS)', LATITUD: 'Latitud publicada (DMS)',
    NOMBRE: 'Nombre', NUM_ANP: 'Número ANP', ID_ANP: 'Clave ANP', ID_DOF: 'Clave DOF', CAT_MANEJO: 'Categoría de manejo', ESTADOS: 'Estados', REGION: 'Región CONANP',
    SUPERFICIE: 'Superficie de origen (ha)', S_TERRES: 'Superficie terrestre (ha)', S_MARINA: 'Superficie marina (ha)', PRIM_DEC: 'Primer decreto', ULT_DOF: 'Última publicación DOF',
    PM: 'Programa de manejo', CERT_SINAP: 'Certificado SINAP', AREA: 'Área (unidades de origen)', PERIMETER: 'Perímetro (unidades de origen)', CLAVE: 'Clave',
    CLAVE_UGA: 'Clave UGA', NOMBRE_UGA: 'Nombre de la UGA', SUPER_m2: 'Superficie de origen (m²)', sup_Ha: 'Superficie de origen (ha)', CLASIFICAC: 'Clasificación',
    CODE_PA: 'Código de política ambiental', clave_MOE: 'Clave MOE', MOE_ID: 'Identificador MOE', SIORE: 'SIORE', ID_MOE: 'ID MOE', NOTA: 'Nota', UGA_MUN: 'Municipios de la UGA',
    id: 'Identificador', Name: 'Nombre (KML)', NOM_NUC: 'Núcleo agrario', MUNICIPIO: 'Municipio', Clv_Unica: 'Clave única RAN', Fol_Matriz: 'Folio matriz', tipo: 'Tipo',
    EDO_CLV: 'Clave estatal', MUN_CLV: 'Clave municipal', NUC_CLV: 'Clave de núcleo', PROGRAMA: 'Programa',
    highway: 'Clasificación OSM', ref: 'Referencia', name: 'Nombre', surface: 'Superficie de rodamiento', lanes: 'Carriles', maxspeed: 'Velocidad máxima', oneway: 'Sentido único',
    osm_id: 'Identificador OSM', osm_url: 'Objeto en OpenStreetMap', osm_edit: 'Última edición del objeto OSM', operator: 'Operador', power: 'Tipo eléctrico (OSM)',
    voltage: 'Tensión (etiqueta OSM)', frequency: 'Frecuencia (Hz)', cables: 'Conductores', circuits: 'Circuitos', substation: 'Tipo de subestación', location: 'Ubicación',
    'plant:source': 'Fuente de energía', 'plant:method': 'Método', 'plant:output:electricity': 'Potencia etiquetada', 'generator:source': 'Fuente de energía',
    'generator:method': 'Tecnología', 'generator:type': 'Tipo de generador', 'generator:output:electricity': 'Potencia etiquetada', 'name:en': 'Nombre (inglés)', 'name:es': 'Nombre (español)',
    landuse: 'Uso del suelo (OSM)', source: 'Fuente declarada en OSM', HYRIV_ID: 'Identificador HydroRIVERS', LENGTH_KM: 'Longitud del tramo (km)', ENDORHEIC: 'Endorreico',
    ORD_STRA: 'Orden Strahler', ORD_CLAS: 'Orden de clasificación', DIRECTION_OK: 'Dirección comprobada', CLIPPED_KM: 'Longitud dentro del estado (km)', PATH_ID: 'Trayectoria',
    END_TYPE: 'Destino', END_ACC_CELLS: 'Celdas aportantes al final', FULL_PATH_KM: 'Longitud total (km)', kind: 'Tipo (OSM)', icao: 'Código OACI', iata: 'Código IATA'
  };
  const DESCR = {
    cities: 'Localidad del Censo 2020. El símbolo marca la coordenada publicada por INEGI; su tamaño es ilustrativo y no representa la extensión urbana.',
    roads: 'Vía cartografiada en OpenStreetMap. El trazado y las etiquetas proceden de la comunidad OSM.',
    transport: 'Nodo de transporte cartografiado en OpenStreetMap. No indica operación comercial ni rutas.',
    plants: 'Central eléctrica cartografiada en OpenStreetMap. El símbolo es ilustrativo; la huella y los atributos proceden de OSM.',
    substations: 'Subestación cartografiada en OpenStreetMap. Su presencia no acredita capacidad disponible, nivel de servicio ni estado operativo.',
    transmission: 'Trazado eléctrico registrado en OpenStreetMap. No representa flujo, capacidad libre ni un proyecto confirmado.',
    generators: 'Generador registrado en OpenStreetMap. Puede pertenecer a una central: no se suma como central independiente.',
    rivers: 'Tramo de drenaje modelado (HydroRIVERS). Seguir el relieve no implica agua permanente ni caudal actual.',
    runoff: 'Recorrido potencial de escorrentía calculado sobre el relieve (D8). Es un modelo de terreno, no un mapa oficial de inundación.',
    protected: 'Polígono del área natural protegida federal según la capa CONANP del atlas regional.',
    priority: 'Región terrestre prioritaria de CONABIO. No equivale a un decreto de área natural protegida.',
    zoning: 'Unidad de gestión ambiental del POERBCS. Consulta el instrumento y sus criterios antes de interpretarla como permiso de uso.',
    agrarian: 'Perímetro de núcleo agrario (RAN). No sustituye una certificación de propiedad ni acredita derechos.'
  };

  const S = {
    manifest: null, base: null, knowledge: null, index: null, indexLoading: null, catalog: null, catalogLoading: null,
    map: null, ready: false, webgl: true,
    layers: new Map(), order: [], global: 1, style: 'ilustrado', light: 'day', exaggeration: 1,
    selection: null, history: [], saved: [], probeTimer: 0, toastTimer: 0, invPage: 1, invFilter: 'all', invTab: 'located',
    lastFocus: null, chatOpen: false
  };
  try { S.saved = JSON.parse(localStorage.getItem('bcs-explorar-hallazgos') || '[]'); } catch (_) { S.saved = []; }
  try { const g = Number(localStorage.getItem('bcs-explorar-opacidad')); if (g > 0 && g <= 1) S.global = g; } catch (_) {}

  function toast(msg) {
    const t = $('#ex-toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(S.toastTimer); S.toastTimer = setTimeout(() => t.classList.remove('on'), 4200);
  }
  function setStatus(msg) { $('#ex-status').textContent = msg; }
  async function getJSON(path) {
    const r = await fetch(ROOT + 'data/' + path, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function bboxOf(geom) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    (function walk(c) {
      if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
      else c.forEach(walk);
    })(geom.coordinates);
    return [[w, s], [e, n]];
  }
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygonGeom(pt, geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.some(rings => inRing(pt, rings[0]) && !rings.slice(1).some(h => inRing(pt, h)));
  }
  function muniAt(lngLat) {
    const pt = [lngLat.lng ?? lngLat[0], lngLat.lat ?? lngLat[1]];
    const f = (S.base?.municipalities.features || []).find(m => inPolygonGeom(pt, m.geometry));
    return f ? f.properties.name : null;
  }
  const PLACE = { 'Los Cabos': 'los_cabos', 'La Paz': 'la_paz', 'Loreto': 'loreto', 'Comondú': 'comondu', 'Mulegé': 'mulege_north' };
  function formatVoltage(v) {
    if (!v) return '';
    return String(v).split(/[;,]/).map(x => Number(x.trim())).filter(Number.isFinite).map(x => x >= 1000 ? `${fmt(x / 1000, 1)} kV` : `${x} V`).join(' · ');
  }

  // canvas symbols (illustrative; never dimensions)
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function imgData(c, ctx) { return { width: c.width, height: c.height, data: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data) }; }
  function symbolImage(kind, color, light, paper = '#fbf8f1', outline = '#4b6273') {
    const [c, x] = canvas(80, 92);
    const poly = (pts, fill, stroke = outline, lw = 2) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fillStyle = fill; x.fill(); if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw; x.stroke(); } };
    const line = (pts, stroke, w = 3) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.strokeStyle = stroke; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke(); };
    x.fillStyle = 'rgba(60,84,98,.18)'; x.beginPath(); x.ellipse(40, 80, 24, 7, 0, 0, Math.PI * 2); x.fill();
    poly([[13, 70], [40, 57], [67, 70], [40, 84]], paper, outline, 1.5);
    if (kind === 'city') {
      poly([[22, 40], [40, 31], [40, 72], [22, 62]], color); poly([[40, 31], [58, 41], [58, 62], [40, 72]], light); poly([[22, 40], [40, 29], [58, 40], [40, 50]], paper);
      line([[28, 47], [28, 55]], paper, 2.5); line([[34, 50], [34, 58]], paper, 2.5); line([[46, 55], [46, 63]], color, 2.5); line([[52, 51], [52, 59]], color, 2.5);
    } else if (kind === 'transformer') {
      poly([[22, 47], [40, 38], [58, 47], [40, 57]], paper); poly([[22, 47], [40, 57], [40, 73], [22, 64]], color); poly([[40, 57], [58, 47], [58, 64], [40, 73]], light);
      line([[30, 44], [30, 28]], color, 4); line([[48, 42], [48, 25]], color, 4);
      for (const y of [30, 35, 40]) line([[26, y], [34, y]], light, 2.5);
      for (const y of [27, 32, 37]) line([[44, y], [52, y]], light, 2.5);
    } else if (kind === 'plant') {
      poly([[20, 50], [40, 40], [60, 50], [40, 60]], paper); poly([[20, 50], [40, 60], [40, 74], [20, 64]], color); poly([[40, 60], [60, 50], [60, 64], [40, 74]], light);
      poly([[44, 52], [50, 49], [50, 22], [44, 25]], color); poly([[50, 49], [55, 52], [55, 25], [50, 22]], light);
      line([[30, 50], [33, 42], [29, 42], [32, 34]], color, 2.5);
    } else if (kind === 'generator') {
      line([[40, 72], [40, 32]], paper, 7); line([[40, 72], [40, 32]], color, 3);
      line([[40, 31], [39, 10], [36, 18]], color, 4); line([[40, 31], [58, 39], [50, 39]], color, 4); line([[40, 31], [25, 44], [29, 36]], color, 4);
      x.fillStyle = paper; x.beginPath(); x.arc(40, 31, 4.5, 0, Math.PI * 2); x.fill(); x.strokeStyle = color; x.lineWidth = 2; x.stroke();
    } else if (kind === 'transport') {
      poly([[24, 58], [40, 50], [56, 58], [40, 66]], light, color, 2);
      line([[40, 22], [40, 58]], color, 4); line([[27, 40], [53, 40]], color, 4); line([[33, 54], [47, 54]], color, 3);
    }
    return imgData(c, x);
  }
  function labelImage(text, { size = 22, color = '#24384a', bg = 'rgba(251,248,241,.94)', border = 'rgba(95,120,135,.35)', weight = 600 } = {}) {
    const t = String(text).length > 36 ? String(text).slice(0, 35) + '…' : String(text);
    const [, mx] = canvas(10, 10); mx.font = `${weight} ${size}px "DM Sans", system-ui, sans-serif`;
    const w = Math.ceil(mx.measureText(t).width) + size * 1.1, h = Math.round(size * 1.75);
    const [c, x] = canvas(w, h);
    x.font = `${weight} ${size}px "DM Sans", system-ui, sans-serif`;
    if (bg) { x.fillStyle = bg; const r = h / 2.6; x.beginPath(); if (x.roundRect) x.roundRect(1, 1, w - 2, h - 2, r); else x.rect(1, 1, w - 2, h - 2); x.fill(); x.strokeStyle = border; x.lineWidth = 1.5; x.stroke(); }
    x.textBaseline = 'middle'; x.fillStyle = color; x.fillText(t, size * .55, h / 2 + 1);
    return imgData(c, x);
  }

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

  // ---------- URL state ----------
  function syncUrl() {
    if (!S.manifest) return;
    const u = new URL(location.href);
    const act = S.order.filter(id => S.layers.get(id).active);
    if (act.length) u.searchParams.set('capas', act.join(',')); else u.searchParams.delete('capas');
    if (S.style !== 'ilustrado') u.searchParams.set('base', S.style); else u.searchParams.delete('base');
    history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString().replace(/%2C/g, ',') : '') + u.hash);
    refreshGemeloLink();
  }
  function refreshGemeloLink() {
    const a = $('#ex-gemelo'); if (!a || !S.order) return;
    const themes = ['urbano', 'economia', 'investigacion', 'movilidad', 'vivienda'];
    const vote = {
      cities: 'urbano', roads: 'urbano', zoning: 'urbano', agrarian: 'urbano',
      protected: 'investigacion', priority: 'investigacion', transport: 'movilidad',
      rivers: 'vivienda', runoff: 'vivienda',
      plants: 'economia', substations: 'economia', transmission: 'economia', generators: 'economia'
    };
    const q = new URLSearchParams();
    q.set('path', 'diagnostico');
    let theme = params.get('tema');
    if (!themes.includes(theme)) {
      const votes = {};
      for (const id of S.order) {
        if (!S.layers.get(id)?.active) continue;
        const t = vote[id];
        if (!t) continue;
        votes[t] = (votes[t] || 0) + 1;
      }
      theme = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
    }
    if (themes.includes(theme)) q.set('theme', theme);
    let muni = S.selection?.type === 'muni' ? S.selection.name : '';
    if (!muni) {
      const hinted = params.get('muni');
      if (hinted && (S.base?.municipalities?.features || []).some(f => f.properties.name === hinted)) muni = hinted;
    }
    if (muni) q.set('muni', muni);
    a.href = '/gemelo/?' + q.toString();
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
      const placeName = params.get('muni');
      const placeFeat = placeName && (S.base.municipalities.features || []).find(x => x.properties.name === placeName);
      if (!placeFeat) viewAll();
      for (const L of S.layers.values()) if (L.data) addMapLayers(L);
      const first = wanted.length ? wanted : (S.manifest.presets.basico || S.manifest.presets.esencial);
      await Promise.all(first.map((id, i) => setActive(id, true, { delay: 500 + i * 160, silent: true })));
      if (placeFeat) selectMunicipality(placeName);
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
/* Fotos del territorio inside the 3D atlas: georeferenced aerial photos (public/stills) as a
   toggleable point layer with thumbnail popups, a link to /stills and Google Maps links. */
(() => {
  'use strict';
  const URL_PHOTOS = '/stills/stills.geojson';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let on = false, added = false, loading = null, popup = null;
  const api = () => window.BCSExplorar;
  const map = () => api()?.state?.map;
  function setBtn() {
    const b = document.getElementById('ex-photos-toggle'); if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    const row = document.getElementById('ex-photos-row'); if (row) row.classList.toggle('is-active', on);
    const sr = b.querySelector('.sr-only'); if (sr) sr.textContent = on ? 'Ocultar capa' : 'Mostrar capa';
  }
  async function ensure() {
    const m = map(); if (!m) return false;
    if (added) return true;
    if (!loading) loading = fetch(URL_PHOTOS).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const data = await loading;
    if (!m.getSource('fotos')) m.addSource('fotos', { type: 'geojson', data });
    if (!m.getLayer('fotos-pt')) m.addLayer({ id: 'fotos-pt', type: 'circle', source: 'fotos', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 11, 7],
      'circle-color': '#c45c26', 'circle-stroke-color': '#fbf8f1', 'circle-stroke-width': 1.4, 'circle-opacity': 0.92 } });
    added = true;
    m.on('mouseenter', 'fotos-pt', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'fotos-pt', () => { m.getCanvas().style.cursor = ''; });
    return true;
  }
  function popupHTML(p) {
    const lat = Number(p.lat), lon = Number(p.lon), q = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return `<div class="ex-photo-pop">
      ${p.thumb ? `<a href="${esc(p.image || p.thumb)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" /></a>` : ''}
      <strong>${esc(p.name)}</strong>${p.municipio ? `<span>${esc(p.municipio)}</span>` : ''}
      <div class="ex-photo-actions">
        <a href="/stills">Ver todas las fotos</a>
        <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Abrir en Google Maps</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener">Cómo llegar</a>
      </div></div>`;
  }
  window.__exPhotoHit = e => {
    const m = map(); if (!on || !m || !m.getLayer('fotos-pt')) return false;
    const r = innerWidth <= 760 ? 12 : 6;
    const f = m.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['fotos-pt'] })[0];
    if (!f) return false;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: '260px', offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(popupHTML(f.properties)).addTo(m);
    return true;
  };
  async function toggle(want) {
    on = want; setBtn();
    try {
      if (on && !(await ensure())) { on = false; setBtn(); return; }
      const m = map(); if (m && m.getLayer('fotos-pt')) m.setLayoutProperty('fotos-pt', 'visibility', on ? 'visible' : 'none');
      if (!on && popup) popup.remove();
    } catch (_) { on = false; setBtn(); }
  }
  function boot() {
    const b = document.getElementById('ex-photos-toggle'); if (!b) return;
    b.addEventListener('click', () => toggle(!on));
    if (new URLSearchParams(location.search).get('fotos') === '1') {
      const t = setInterval(() => { if (api()?.state?.ready) { clearInterval(t); toggle(true); } }, 400);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
