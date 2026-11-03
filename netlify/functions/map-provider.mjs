import { isAuthenticated } from '../lib/auth_shared.mjs';

const json = (statusCode, data) => ({
  statusCode, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
  body: JSON.stringify(data),
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, {error:'method'});
  if (!isAuthenticated(event)) return json(401, {error:'auth'});
  if (!(event.headers?.['content-type'] || '').startsWith('application/json')) return json(415, {error:'format'});
  let q;
  try { q = JSON.parse(event.body); } catch { return json(400, {error:'request'}); }
  if (!q || !['traffic','biodiversity'].includes(q.provider) ||
      !Number.isFinite(q.lat) || !Number.isFinite(q.lng) || q.lat < 22.7 || q.lat > 28.05 || q.lng < -115.9 || q.lng > -109.35)
    return json(400, {error:'point'});
  const signal = AbortSignal.timeout(10000);
  try {
    if (q.provider === 'traffic') {
      if (!process.env.TOMTOM_API_KEY) return json(503, {error:'not_configured'});
      const url = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/15/json');
      url.search = new URLSearchParams({key:process.env.TOMTOM_API_KEY, point:[q.lat,q.lng].join(','), unit:'KMPH'});
      const res = await fetch(url,{signal});
      if (!res.ok) return json(res.status===400 || res.status===404?404:502,{error:'provider'});
      const flow = (await res.json()).flowSegmentData;
      if (!flow || ![flow.currentTravelTime,flow.freeFlowTravelTime,flow.currentSpeed,flow.freeFlowSpeed].every(v=>Number.isFinite(v)&&v>=0))
        return json(404,{error:'no_data'});
      return json(200,{speed:flow.currentSpeed,freeSpeed:flow.freeFlowSpeed,delaySeconds:Math.max(0,flow.currentTravelTime-flow.freeFlowTravelTime),closed:flow.roadClosure===true,confidence:flow.confidence,retrieved:new Date().toISOString()});
    }
    if (!process.env.IBAT_AUTH_KEY || !process.env.IBAT_AUTH_TOKEN || process.env.IBAT_PORTAL_ALLOWED !== 'true')
      return json(503,{error:'not_configured'});
    const url = new URL('https://app.ibat-alliance.org/api/v2/kba/intersect/summary');
    url.search = new URLSearchParams({type:'POINT',auth_key:process.env.IBAT_AUTH_KEY,auth_token:process.env.IBAT_AUTH_TOKEN});
    const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({coordinates:[q.lng,q.lat],buffers:[1000]}),signal});
    if (!res.ok) return json(502,{error:'provider'});
    const result = (await res.json()).summary?.find(row=>row.buffer===1000);
    if (!Number.isInteger(result?.count) || result.count<0) return json(502,{error:'format'});
    return json(200,{count:result.count,radiusMetres:1000,retrieved:new Date().toISOString()});
  } catch { return json(502,{error:'provider'}); }
}
