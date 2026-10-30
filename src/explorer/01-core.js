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
