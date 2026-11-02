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
    sinDatoIds: ['gap_parque_industrial'],
  },
  {
    q: '¿Es viable el hidrógeno Oasis en Mulegé?',
    kind: 'viability',
    needIds: ['ev_sig_mulege_oasis', 'gap_mulege_agua_energia', 'dq_pack_mulege', 'terr_mulege'],
    needTypes: ['Evidence', 'Constraint', 'Territory'],
    sinDatoIds: ['gap_mulege_agua_energia', 'ev_sig_mulege_oasis'],
  },
  {
    q: '¿Qué restringe la viabilidad junto al acuífero 0317?',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma', 'rc_acuifero_0317', 'const_dma_deficit', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: '¿Cuáles son los riesgos del acuífero 0318 Cabo Pulmo?',
    kind: 'risk',
    needIds: ['ev_acuiferos_dma', 'rc_acuifero_0318', 'terr_anp_cabo_pulmo'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Territory'],
  },
  {
    q: 'Riesgos de escorrentía en Los Cabos',
    kind: 'risk',
    needIds: ['ev_escorrentia', 'terr_los_cabos', 'dq_riesgos_principales'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: '¿Quién decide el desarrollo urbano en Los Cabos según el organigrama?',
    kind: 'viability',
    needIds: ['ev_org_cabos_2024', 'gap_org_obras_cabos', 'actor_implan_cabos', 'ev_mesa_urbanismo'],
    needTypes: ['Evidence', 'Constraint', 'Actor'],
    sinDatoIds: ['gap_org_obras_cabos'],
  },
  {
    q: '¿Puede Comondú compensar el déficit de agua de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_preguntas_estrategicas', 'terr_comondu', 'const_dma_deficit', 'dd_agro_santo_domingo'],
    needTypes: ['Evidence', 'Territory', 'Constraint', 'DemandDriver'],
  },
  {
    q: '¿Es viable un hotel en Los Cabos con el dossier del lugar?',
    kind: 'viability',
    needIds: ['ev_dossiers_lugar', 'ev_fiscal_anexo_2025', 'terr_los_cabos', 'rc_acuifero_0317', 'const_dma_deficit'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: '¿Qué dice el POER sobre el cambio de uso de suelo y las políticas AS, PR, PT y RT?',
    kind: 'landuse',
    needIds: ['dq_cambio_uso_suelo', 'inst_pa_aprovechamiento', 'inst_pa_preservacion', 'inst_pa_proteccion', 'inst_pa_restauracion', 'gap_politica_uga_leyenda'],
    needTypes: ['Instrument', 'Constraint'],
    glossary: true,
  },
  {
    q: '¿Es viable un desarrollo en East Cape frente a Cabo Pulmo?',
    kind: 'viability',
    needIds: ['dq_pack_east_cape', 'rc_acuifero_0318', 'terr_anp_cabo_pulmo', 'gap_east_cape_instrumento', 'gap_east_cape_carga'],
    needTypes: ['ResourceCapacity', 'Territory', 'Constraint'],
  },
  {
    q: '¿Cuáles son los riesgos principales en Loreto?',
    kind: 'risk',
    needIds: ['dq_pack_loreto', 'proj_fed_agu_005', 'gap_loreto_dma', 'gap_psdu_loreto_gazette', 'terr_anp_loreto', 'inst_poel_loreto'],
    needTypes: ['Project', 'Constraint', 'Territory', 'Instrument'],
  },
  {
    q: 'Compara la viabilidad de Los Cabos y La Paz',
    kind: 'viability',
    needIds: ['dq_comparar_polos', 'terr_los_cabos', 'terr_la_paz', 'rc_acuifero_0317', 'rc_acuifero_0324'],
    needTypes: ['Territory', 'ResourceCapacity', 'DecisionQuestion'],
  },
  {
    q: 'Compara oportunidades de Los Cabos y Comondú',
    kind: 'opportunity',
    needIds: ['dq_comparar_polos', 'terr_los_cabos', 'terr_comondu', 'dd_turismo_cabos', 'dd_agro_santo_domingo'],
    needTypes: ['Territory', 'DemandDriver'],
  },
  {
    q: '¿Quién opera el agua de un hotel en Los Cabos?',
    kind: 'viability',
    needIds: ['ev_mesas_trabajo', 'ev_mesa_agua', 'actor_oomsapas_cabos', 'actor_cea', 'actor_conagua'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién decide un cambio de uso de suelo?',
    kind: 'landuse',
    also: 'viability',
    needIds: ['actor_sepuimm', 'dq_cambio_uso_suelo', 'inst_poerbcs', 'ev_mesas_trabajo'],
    needTypes: ['Actor', 'Instrument'],
  },
  {
    q: 'En el escenario agua primero, ¿es viable una desaladora en Los Cabos?',
    kind: 'viability',
    needIds: ['ev_esc_water_first', 'proj_desal_cabos', 'dq_viabilidad_proyecto', 'rc_acuifero_0317'],
    needTypes: ['Evidence', 'Project', 'ResourceCapacity'],
  },
  {
    q: 'Compara riesgos de Loreto y Mulegé',
    kind: 'risk',
    needIds: ['dq_comparar_polos', 'terr_loreto', 'terr_mulege', 'gap_loreto_dma', 'gap_pdu_mulege', 'gap_mulege_agua_energia'],
    needTypes: ['Territory', 'Constraint'],
    noInvent: true,
  },
  {
    q: '¿Es viable vivienda turística en Los Cabos según el mercado?',
    kind: 'viability',
    needIds: ['ev_inmob_jll_2025', 'dd_residencial_cabos', 'rc_acuifero_0317', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'DemandDriver', 'ResourceCapacity'],
    gaps: true,
  },
  {
    q: 'Oportunidades de cruceros y aeropuertos en BCS',
    kind: 'opportunity',
    needIds: ['ev_cruceros_datatur', 'ev_aereo_setue', 'rc_aeropuerto_sjd', 'dq_oportunidades'],
    needTypes: ['Evidence', 'ResourceCapacity'],
  },
  {
    q: 'Riesgos principales de huracanes en el estado',
    kind: 'risk',
    needIds: ['ev_sig_hurricanes', 'dq_riesgos_principales'],
    needTypes: ['Evidence', 'Constraint'],
    libraryPage: true,
  },
  {
    q: 'Riesgos principales y oportunidades en Mulegé y el Vizcaíno',
    kind: 'opportunity',
    also: 'risk',
    needIds: ['dq_pack_mulege', 'terr_anp_vizcaino', 'gap_pdu_mulege', 'gap_mulege_agua_energia'],
    needTypes: ['Territory', 'Constraint'],
    newsPlace: 'mulege_north',
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
  if (!intents.isFactorIntent || !intents.factorKinds.includes(c.kind) || (c.also && !intents.factorKinds.includes(c.also))) {
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
  if (c.glossary) {
    const resto = ev.find((x) => (x.onto_id || '') === 'inst_pa_restauracion');
    const text = `${resto?.sum_es || ''} ${resto?.sum_en || ''}`;
    if (!/restauraci[oó]n/i.test(text)) fail(`${c.q} restoration policy name missing`);
    if (/RT\s*=\s*Restaur|RT significa|sigla RT equivale/i.test(text)) fail(`${c.q} invented RT equivalence`);
    if (!ev.some((x) => x.type === 'library')) fail(`${c.q} expected a library reference chunk`);
  }
  if (c.sinDatoIds) {
    for (const id of c.sinDatoIds) {
      const node = ev.find((x) => (x.onto_id || '') === id);
      const text = `${node?.sum_es || ''} ${node?.sum_en || ''}`;
      if (!/sin dato/i.test(text)) fail(`${c.q} ${id} must say sin dato`);
      if (/\b\d+\s*mw\b/i.test(text)) fail(`${c.q} ${id} must not invent MW`);
    }
  }
  if (c.noInvent) {
    const dma = ev.find((x) => (x.onto_id || '') === 'gap_loreto_dma');
    const mule = ev.find((x) => (x.onto_id || '') === 'gap_mulege_agua_energia');
    const text = `${dma?.sum_es || ''} ${mule?.sum_es || ''}`;
    if (!/sin dato/i.test(text)) fail(`${c.q} Loreto/Mulegé gaps must stay sin dato`);
  }
  if (c.gaps && !ev.some((x) => String(x.id || '').startsWith('gapcard:') || x.id === 'factor:huecos')) {
    fail(`${c.q} expected a data_gaps card`);
  }
  if (c.libraryPage) {
    const pages = ev.filter((x) => x.type === 'library' && String(x.id || '').includes(':p'));
    console.log(`   libpages=${pages.map((x) => x.id).join(' ') || '(none)'}`);
    if (!pages.length) fail(`${c.q} expected a page-level library extract`);
  }
  if (c.newsPlace) {
    const news = ev.filter((x) => x.type === 'news' && x.outlet && x.date && (x.place_ids || []).includes(c.newsPlace));
    console.log(`   news=${news.map((n) => `${n.outlet} ${n.date}`).join(' | ') || '(none)'}`);
    if (!news.length) fail(`${c.q} expected sourced news for ${c.newsPlace}`);
  }
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
