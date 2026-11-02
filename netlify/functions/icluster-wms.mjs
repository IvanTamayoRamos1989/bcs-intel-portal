const ALLOWED = new Set(['cimp100', 'cspyde100']);
const MAP = 'http://sig.bcs.gob.mx/cgi-bin/mapserv?map=/opt/map/mdm60/mdm61vectormxsig.map';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }
  const params = event.queryStringParameters || {};
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
