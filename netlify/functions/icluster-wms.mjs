// GetFeatureInfo is disabled on mdm61vectormxsig.map. iCluster identifies with
// POST /mdmservices/identify, then /mdmservices/query for the hit id.
const ALLOWED = new Set(['cimp100', 'cspyde100']);
const ADMIN = { c102: 'locality', c101: 'municipality', c100: 'state' };
const SKIP = new Set(['ubicacion', 'coordenada', 'buffer', 'id', 'nombre', 'clave', 'uso']);
const MAP = 'http://sig.bcs.gob.mx/cgi-bin/mapserv?map=/opt/map/mdm60/mdm61vectormxsig.map';
const IDENTIFY = 'http://sig.bcs.gob.mx/mdmservices/identify';
const QUERY = 'http://sig.bcs.gob.mx/mdmservices/query';
const R = 20037508.342789244;

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function fieldMap(element) {
  const out = {};
  ((element && element.fields) || []).forEach(function (field) {
    if (!field || field.label == null) return;
    out[String(field.label).toLowerCase()] = field.value;
  });
  return out;
}

function text(value) {
  if (value == null || typeof value === 'object') return '';
  return String(value).trim();
}

function attributesOf(fields) {
  const rows = [];
  (fields || []).forEach(function (field) {
    if (!field || field.label == null) return;
    const key = String(field.label).toLowerCase();
    if (SKIP.has(key)) return;
    const value = text(field.value);
    if (!value || value === 'N/A') return;
    rows.push({ label: String(field.label), value: value });
  });
  return rows;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('upstream ' + res.status);
  return res.json();
}

async function readLayer(table) {
  const element = table && table.elements && table.elements[0];
  if (!element) return null;
  const brief = fieldMap(element);
  let fields = element.fields || [];
  const id = Number(brief.id);
  if (ALLOWED.has(table.alias) && Number.isInteger(id)) {
    try {
      const detail = await postJson(QUERY, { id: id, table: table.alias, project: 'mdm6' });
      const detailed = detail && detail.data && detail.data.table && detail.data.table.elements;
      if (detailed && detailed[0] && detailed[0].fields) fields = detailed[0].fields;
    } catch (err) {
      fields = element.fields || [];
    }
  }
  const map = fieldMap({ fields: fields });
  return {
    layer: table.alias,
    table: text(table.table),
    code: text(map.clave) || text(map.nombre),
    uso: text(map.uso),
    nombre: text(map.nombre),
    attributes: attributesOf(fields),
  };
}

async function identify(params) {
  const layers = String(params.layers || '').split(',').map(function (item) { return item.trim(); }).filter(Boolean);
  const lng = Number(params.lng);
  const lat = Number(params.lat);
  if (!layers.length || layers.length > 2 || layers.some(function (layer) { return !ALLOWED.has(layer); })) {
    return json(400, { ok: false });
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -115.8 || lng > -108.9 || lat < 22.3 || lat > 28.6) {
    return json(400, { ok: false });
  }
  let zoom = Number(params.zoom);
  if (!Number.isFinite(zoom)) zoom = 16;
  zoom = Math.min(20, Math.max(6, zoom));
  const x = lng * R / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * R / 180;
  const resolution = 156543.03392804097 / Math.pow(2, zoom);
  let payload;
  try {
    payload = await postJson(IDENTIFY, {
      tables: layers.join(','),
      project: 'mdm6',
      x: x,
      y: y,
      resolution: resolution,
    });
  } catch (err) {
    return json(502, { ok: false });
  }
  const tables = (payload && payload.data && payload.data.tables) || [];
  const byAlias = {};
  tables.forEach(function (table) { if (table && table.alias) byAlias[table.alias] = table; });
  const hit = layers.indexOf('cimp100') >= 0 && byAlias.cimp100 ? await readLayer(byAlias.cimp100) : null;
  const parcel = layers.indexOf('cspyde100') >= 0 && byAlias.cspyde100 ? await readLayer(byAlias.cspyde100) : null;
  const place = {};
  Object.keys(ADMIN).forEach(function (alias) {
    const table = byAlias[alias];
    const element = table && table.elements && table.elements[0];
    const name = text(fieldMap(element).nombre);
    if (name) place[ADMIN[alias]] = name;
  });
  return json(200, {
    ok: true,
    hit: hit && (hit.code || hit.uso) ? hit : null,
    parcel: parcel && (parcel.code || parcel.nombre) ? parcel : null,
    locality: place.locality || '',
    municipality: place.municipality || '',
    state: place.state || '',
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }
  const params = event.queryStringParameters || {};
  if (params.op === 'identify') return identify(params);
  const layers = String(params.layers || '');
  const bbox = String(params.bbox || '');
  if (!ALLOWED.has(layers) || !/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bbox)) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'bad request' };
  }
  const url = MAP
    + '&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE'
    + '&SRS=EPSG:900913&WIDTH=256&HEIGHT=256&LAYERS=' + layers
    + '&BBOX=' + bbox;
  const res = await fetch(url);
  if (!res.ok) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'upstream' };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    statusCode: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}
