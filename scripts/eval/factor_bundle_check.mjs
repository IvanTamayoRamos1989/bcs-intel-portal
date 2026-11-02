#!/usr/bin/env node
/**
 * Retrieval check for the factor pack. No LLM.
 * Asserts intents and that the ontology bundle covers several factor families.
 */
import { expandQuery, buildFactorEvidence } from '../../netlify/functions/chat.mjs';

const CASES = [
  {
    q: '¿Es viable un hotel en Los Cabos?',
    kind: 'viability',
    needIds: ['dq_viabilidad_proyecto', 'rc_sibcs', 'const_dma_deficit'],
    needTypes: ['Constraint', 'ResourceCapacity', 'Instrument'],
    forbid: ['gap_pmdu_lapaz_texto'],
  },
  {
    q: 'Is a desalination project viable in La Paz?',
    kind: 'viability',
    needIds: ['dq_viabilidad_proyecto', 'proj_fed_agu_002', 'rc_acuifero_0324'],
    needTypes: ['Project', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: '¿Qué cambio de uso de suelo permite el POER en La Paz?',
    kind: 'landuse',
    needIds: ['dq_cambio_uso_suelo', 'inst_poerbcs', 'inst_poer_politicas', 'gap_pmdu_lapaz_texto'],
    needTypes: ['Instrument', 'Constraint'],
    forbid: ['inst_pdu_cabos'],
  },
  {
    q: 'What are the principal risks in Los Cabos?',
    kind: 'risk',
    needIds: ['dq_riesgos_principales', 'const_red_aislada', 'ev_riesgos_documentados'],
    needTypes: ['Constraint', 'ResourceCapacity'],
  },
  {
    q: '¿Qué oportunidades hay en Comondú?',
    kind: 'opportunity',
    needIds: ['dq_oportunidades', 'dd_agro_santo_domingo'],
    needTypes: ['DemandDriver', 'Constraint'],
  },
  {
    q: 'Viabilidad de un parque industrial en BCS',
    kind: 'viability',
    needIds: ['gap_parque_industrial', 'rc_sibcs'],
    needTypes: ['Constraint', 'ResourceCapacity'],
  },
];

const NEGATIVES = [
  '¿Cuánta gente vive en La Paz?',
  '¿Cuál es la DMA del acuífero 0317?',
];

let failed = 0;
function fail(msg) {
  failed += 1;
  console.error('FAIL', msg);
}

for (const c of CASES) {
  const intents = expandQuery(c.q);
  if (!intents.isFactorIntent || !intents.factorKinds.includes(c.kind)) {
    fail(`${c.q} → kinds=${intents.factorKinds.join('+') || '(none)'}`);
    continue;
  }
  const ev = buildFactorEvidence(c.q, intents);
  const ids = ev.filter((x) => x.type === 'ontology').map((x) => x.onto_id || String(x.id).replace(/^onto:/, ''));
  const types = new Set(ev.filter((x) => x.type === 'ontology').map((x) => x.onto_type).filter(Boolean));
  const idSet = new Set(ids);
  const missing = c.needIds.filter((id) => !idSet.has(id));
  const missingTypes = c.needTypes.filter((t) => !types.has(t));
  const forbidden = (c.forbid || []).filter((id) => idSet.has(id));
  const families = [...types].sort().join(',');
  console.log(`\n== ${c.q}`);
  console.log(`   kinds=${intents.factorKinds.join('+')} onto=${ids.length} docs=${ev.length - ids.length} types=${families}`);
  console.log(`   ids=${ids.join(' ')}`);
  if (missing.length) fail(`${c.q} missing ids: ${missing.join(', ')}`);
  if (missingTypes.length) fail(`${c.q} missing types: ${missingTypes.join(', ')}`);
  if (forbidden.length) fail(`${c.q} place leak: ${forbidden.join(', ')}`);
  if (ids.length < 6) fail(`${c.q} ontology bundle too small (${ids.length})`);
}

for (const q of NEGATIVES) {
  const intents = expandQuery(q);
  console.log(`\n== ${q} factor=${intents.isFactorIntent} water=${intents.isWaterIntent} demo=${intents.isDemoIntent}`);
  if (intents.isFactorIntent) fail(`${q} should not be a factor intent`);
}
const dma = expandQuery('¿Cuál es la DMA del acuífero 0317?');
if (!dma.isWaterIntent) fail('DMA query lost water intent');
const pop = expandQuery('¿Cuánta gente vive en La Paz?');
if (!pop.isDemoIntent) fail('population query lost demo intent');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nfactor bundle check ok');
