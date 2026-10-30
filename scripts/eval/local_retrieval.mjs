// Offline retrieval check: runs the real chat handler with the LLM mocked, prints context titles + chips.
// node scripts/eval/local_retrieval.mjs "pregunta" ["pregunta 2" ...]
import crypto from 'node:crypto';
import fs from 'node:fs';
process.env.BCS_CHAT_API_KEY = 'xai-dummy';
process.env.BCS_PORTAL_SESSION_SECRET = process.env.BCS_PORTAL_SESSION_SECRET || 'local-test';
let captured = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.x.ai')) { captured = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'MOCK' } }] }), { status: 200 }); }
  return realFetch(url, opts);
};
const { signToken } = await import('../../netlify/lib/auth_shared.mjs').catch(() => ({}));
const mod = await import('../../netlify/functions/chat.mjs');
let cookie = '';
try { cookie = `bcs_portal_auth=${signToken()}`; } catch { const sig = crypto.createHmac('sha256', process.env.BCS_PORTAL_SESSION_SECRET).update('bcs-portal-ok').digest('hex'); cookie = `bcs_portal_auth=1.${sig}`; }
const QS = process.argv[2] === '--file' ? fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean) : process.argv.slice(2);
for (const q of QS) {
  captured = null;
  const r = await mod.handler({ httpMethod: 'POST', headers: { cookie, 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 200) }, body: JSON.stringify({ message: q, lang: 'es', history: [] }) });
  const b = JSON.parse(r.body);
  const sys = captured?.messages?.[0]?.content || '';
  const ctx = sys.split(/\nCONTEXTO:\n|\nCONTEXT:\n/)[1] || '';
  console.log(`\n== ${q}  [status ${r.statusCode}] grounded=${b.grounded} n=${b.evidence_count} place=${b.place?.id || '-'}`);
  for (const m of ctx.matchAll(/^\[(\d+)\] (.*)$/gm)) console.log('   ', m[1], m[2].slice(0, 120));
  if (!ctx.startsWith('[')) console.log('   ', ctx.slice(0, 100));
  console.log('   chips:', JSON.stringify({ file: b.primary_file?.title, actor: b.stakeholder?.name, onto: (b.ontology || []).map((o) => o.id), sig: (b.foresight_signals || []).map((s) => s.id), sq: (b.strategic_questions || []).map((s) => s.id) }));
}
