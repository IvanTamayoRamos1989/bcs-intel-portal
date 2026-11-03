#!/usr/bin/env node
/**
 * Retrieval check for the factor pack. No LLM.
 * Asserts intents and that the ontology bundle covers several factor families.
 */
import { expandQuery, buildFactorEvidence, composeFactorBrief, inferPlaceId, targetMunis } from '../../netlify/functions/chat.mjs';

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
  {
    q: '¿Cuáles son los riesgos de la señal de huracanes Polo y Rachel?',
    kind: 'risk',
    needIds: ['ev_sig_hurricanes', 'dq_riesgos_principales', 'terr_comondu', 'const_red_aislada'],
    needTypes: ['Evidence', 'Constraint', 'Territory'],
  },
  {
    q: '¿La señal de acoplamiento agua-energía hace viable una desaladora en La Paz?',
    kind: 'viability',
    needIds: ['ev_sig_water_energy', 'dq_viabilidad_proyecto', 'rc_sibcs', 'rc_acuifero_0324'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Project'],
  },
  {
    q: '¿La población del Censo 2020 de Los Cabos condiciona la viabilidad?',
    kind: 'viability',
    needIds: ['ev_pob_censo_2020', 'terr_los_cabos', 'const_dma_deficit', 'rc_acuifero_0317'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    census: true,
  },
  {
    q: '¿Quién opera el puerto de Cabo San Lucas?',
    kind: 'viability',
    needIds: ['ev_sig_asipona', 'proj_fed_pue_001', 'ev_cruceros_datatur'],
    needTypes: ['Evidence', 'Project'],
    portOperator: true,
  },
  {
    q: 'Compara la viabilidad y la población de Loreto y Mulegé',
    kind: 'viability',
    needIds: ['ev_pob_censo_2020', 'dq_comparar_polos', 'gap_loreto_dma', 'gap_mulege_agua_energia'],
    needTypes: ['Evidence', 'DecisionQuestion', 'Constraint'],
    noInvent: true,
  },
  {
    q: '¿Qué cambio de uso de suelo cierra el Parque Nacional Cabo Pulmo?',
    kind: 'landuse',
    needIds: ['terr_anp_cabo_pulmo', 'const_anp_nucleos', 'dq_cambio_uso_suelo', 'inst_poerbcs', 'ev_anp_avisos'],
    needTypes: ['Territory', 'Constraint', 'Instrument', 'Evidence'],
  },
  {
    q: '¿Es viable un hotel en Los Cabos con el candado de Cabo Pulmo?',
    kind: 'viability',
    needIds: ['terr_anp_cabo_pulmo', 'const_anp_nucleos', 'dq_viabilidad_proyecto', 'rc_acuifero_0317', 'ev_anp_avisos'],
    needTypes: ['Territory', 'Constraint', 'ResourceCapacity', 'Evidence'],
  },
  {
    q: '¿Es viable Los Cabos según la Ley de Ingresos 2026?',
    kind: 'viability',
    needIds: ['ev_fiscal_ley_2026', 'ev_fiscal_anexo_2025', 'terr_los_cabos', 'dq_viabilidad_proyecto', 'gap_fiscal_ingresos_2026'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    fiscal2026: true,
  },
  {
    q: '¿Quién decide el agua de la desaladora de Los Cabos en la mesa?',
    kind: 'viability',
    needIds: ['ev_mesa_agua', 'actor_conagua', 'actor_cea', 'proj_fed_agu_001', 'proj_desal_cabos'],
    needTypes: ['Evidence', 'Actor', 'Project'],
  },
  {
    q: '¿Qué cambio de uso de suelo condiciona la reserva El Vizcaíno?',
    kind: 'landuse',
    needIds: ['terr_anp_vizcaino', 'const_anp_nucleos', 'dq_cambio_uso_suelo', 'proj_transpeninsular', 'ev_anp_avisos'],
    needTypes: ['Territory', 'Constraint', 'Project', 'Evidence'],
    vizcainoGap: true,
  },
  {
    q: '¿Qué oportunidades hay en los cruceros de Cabo San Lucas y la concesión de ASIPONA?',
    kind: 'opportunity',
    needIds: ['ev_cruceros_datatur', 'ev_sig_asipona', 'proj_fed_pue_001', 'dq_oportunidades', 'rc_aeropuerto_sjd'],
    needTypes: ['Evidence', 'Project', 'ResourceCapacity'],
    cruiseSeries: true,
  },
  {
    q: '¿Qué oportunidad de vivienda muestra el reporte JLL 2025 en Loreto?',
    kind: 'opportunity',
    needIds: ['ev_jll_zonas_2025', 'ev_sniiv_vivienda', 'terr_loreto', 'dq_oportunidades', 'gap_loreto_dma'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    jllZones: true,
  },
  {
    q: '¿Cuáles son los riesgos de la compuerta de transmisión de 237 MW?',
    kind: 'risk',
    needIds: ['rc_tx_lapaz_cabos', 'proj_p23_bs1', 'const_red_aislada', 'dq_riesgos_principales', 'rc_sibcs'],
    needTypes: ['ResourceCapacity', 'Project', 'Constraint'],
  },
  {
    q: '¿Es viable un hotel en East Cape sin vuelo propio?',
    kind: 'viability',
    needIds: ['ev_dossiers_movilidad', 'gap_east_cape_carga', 'terr_anp_cabo_pulmo', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'Constraint', 'Territory'],
    noAirport: true,
  },
  {
    q: '¿Cuáles son los riesgos de usar Mulegé como offset energético?',
    kind: 'risk',
    also: 'viability',
    needIds: ['ev_dossiers_movilidad', 'ev_sig_mulege_oasis', 'gap_mulege_agua_energia', 'terr_mulege'],
    needTypes: ['Evidence', 'Constraint', 'Territory'],
    sinDatoIds: ['gap_mulege_agua_energia', 'ev_sig_mulege_oasis'],
    noAirport: true,
  },
  {
    q: '¿Cuál es la renta hotelera y el cap rate de un hotel en Los Cabos?',
    kind: 'viability',
    needIds: ['gap_rentas_hoteleras', 'ev_news_ocupacion', 'dq_viabilidad_proyecto'],
    needTypes: ['Constraint', 'Evidence'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    noRent: true,
  },
  {
    q: '¿Es viable Loreto con un solo total de pasajeros 2025?',
    kind: 'viability',
    needIds: ['gap_loreto_pax', 'ev_aereo_setue', 'terr_loreto', 'gap_loreto_dma'],
    needTypes: ['Constraint', 'Evidence', 'Territory'],
    sinDatoIds: ['gap_loreto_pax', 'gap_loreto_dma'],
    noPaxTotal: true,
  },
  {
    q: '¿El acuífero 0302 hace viable a Mulegé?',
    kind: 'viability',
    needIds: ['gap_acuifero_0302', 'ev_acuiferos_dma', 'terr_mulege'],
    needTypes: ['Constraint', 'Evidence', 'Territory'],
    sinDatoIds: ['gap_acuifero_0302'],
    noAssign0302: true,
  },
  {
    q: '¿Es viable un desarrollo en East Cape si no conocemos su carga?',
    kind: 'viability',
    needIds: ['gap_east_cape_carga', 'dq_pack_east_cape', 'rc_acuifero_0318'],
    needTypes: ['Constraint', 'ResourceCapacity'],
    sinDatoIds: ['gap_east_cape_carga'],
  },
  {
    q: '¿Quién es el titular de Obras Públicas en Los Cabos?',
    kind: 'viability',
    needIds: ['gap_org_obras_cabos', 'ev_org_cabos_2024'],
    needTypes: ['Constraint', 'Evidence'],
    sinDatoIds: ['gap_org_obras_cabos'],
    forbid: ['actor_cabos_dg_obras_publicas'],
  },
  {
    q: '¿Los 128 MW móviles de CFE hacen viable a Los Cabos?',
    kind: 'viability',
    needIds: ['ev_news_cfe_128', 'rc_sibcs', 'const_red_aislada', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Constraint'],
    mobileMw: true,
  },
  {
    q: '¿Las turbinas móviles de CFE en Los Cabos son el proyecto Oasis?',
    kind: 'viability',
    needIds: ['ev_news_cfe_128', 'ev_sig_mulege_oasis', 'gap_mulege_agua_energia', 'rc_sibcs'],
    needTypes: ['Evidence', 'Constraint', 'ResourceCapacity'],
    sinDatoIds: ['gap_mulege_agua_energia', 'ev_sig_mulege_oasis'],
    mobileMw: true,
  },
  {
    q: '¿La ocupación hotelera de Los Cabos es una renta?',
    kind: 'viability',
    needIds: ['gap_rentas_hoteleras', 'ev_news_ocupacion'],
    needTypes: ['Constraint', 'Evidence'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    noRent: true,
  },
  {
    q: '¿El acuífero Vizcaíno pertenece a Mulegé?',
    kind: 'viability',
    needIds: ['gap_acuifero_0302', 'ev_acuiferos_dma', 'terr_mulege'],
    needTypes: ['Constraint', 'Evidence', 'Territory'],
    sinDatoIds: ['gap_acuifero_0302'],
    noAssign0302: true,
  },
  {
    q: '¿Puede un hotel junto a Cabo Pulmo?',
    kind: 'viability',
    needIds: ['terr_anp_cabo_pulmo', 'const_anp_nucleos', 'ev_anp_avisos'],
    needTypes: ['Territory', 'Constraint', 'Evidence'],
  },
  {
    q: '¿Cabo Pulmo cierra la construcción?',
    kind: 'landuse',
    needIds: ['terr_anp_cabo_pulmo', 'dq_cambio_uso_suelo', 'const_anp_nucleos'],
    needTypes: ['Territory', 'DecisionQuestion', 'Constraint'],
  },
  {
    q: '¿ASIPONA administra la marina de Cabo San Lucas?',
    kind: 'viability',
    needIds: ['ev_sig_asipona', 'proj_fed_pue_001', 'ev_cruceros_datatur'],
    needTypes: ['Evidence', 'Project'],
  },
  {
    q: '¿Qué pasa con los 237 MW de transmisión entre La Paz y Los Cabos?',
    kind: 'viability',
    needIds: ['rc_tx_lapaz_cabos', 'proj_p23_bs1', 'const_red_aislada'],
    needTypes: ['ResourceCapacity', 'Project', 'Constraint'],
  },
  {
    q: '¿Cuánto ingresa Los Cabos en 2026?',
    kind: 'viability',
    needIds: ['ev_fiscal_ley_2026', 'gap_fiscal_ingresos_2026'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_fiscal_ingresos_2026'],
    fiscal2026: true,
  },
  {
    q: '¿Quién decide la desaladora de 250 litros por segundo en Los Cabos?',
    kind: 'viability',
    needIds: ['ev_mesa_agua', 'proj_fed_agu_001', 'proj_desal_cabos', 'actor_conagua'],
    needTypes: ['Evidence', 'Project', 'Actor'],
  },
  {
    q: '¿Comondú puede cubrir el déficit de agua de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_preguntas_estrategicas', 'terr_comondu', 'const_dma_deficit', 'dd_agro_santo_domingo'],
    needTypes: ['Evidence', 'Territory', 'Constraint', 'DemandDriver'],
  },
  {
    q: 'Compara los cinco municipios',
    kind: 'viability',
    needIds: ['dq_comparar_polos', 'terr_los_cabos', 'terr_la_paz', 'terr_loreto', 'terr_comondu', 'terr_mulege'],
    needTypes: ['DecisionQuestion', 'Territory'],
  },
  {
    q: '¿Cuántos pasajeros de crucero llegaron a Cabo San Lucas?',
    kind: 'opportunity',
    needIds: ['ev_cruceros_datatur', 'ev_sig_asipona'],
    needTypes: ['Evidence'],
    cruiseSeries: true,
  },
  {
    q: '¿Qué dice JLL de la vivienda en Loreto?',
    kind: 'opportunity',
    needIds: ['ev_jll_zonas_2025', 'terr_loreto', 'gap_loreto_dma'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    jllZones: true,
  },
  {
    q: '¿Cuántas viviendas registró SNIIV en La Paz?',
    kind: 'opportunity',
    needIds: ['ev_sniiv_vivienda'],
    needTypes: ['Evidence'],
  },
  {
    q: '¿La Sierra La Laguna impide un hotel?',
    kind: 'viability',
    needIds: ['terr_anp_sierra_laguna', 'const_anp_nucleos'],
    needTypes: ['Territory', 'Constraint'],
  },
  {
    q: '¿El parque Bahía de Loreto limita el crecimiento?',
    kind: 'viability',
    needIds: ['terr_anp_loreto', 'const_anp_nucleos', 'gap_loreto_dma'],
    needTypes: ['Territory', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: '¿API BCS opera Pichilingue?',
    kind: 'viability',
    needIds: ['proj_fed_pue_002', 'ev_cruceros_datatur'],
    needTypes: ['Project', 'Evidence'],
  },
  {
    q: '¿Quién opera el aeropuerto de Los Cabos?',
    kind: 'viability',
    needIds: ['rc_aeropuerto_sjd', 'proj_fed_aer_001'],
    needTypes: ['ResourceCapacity', 'Project'],
  },
  {
    q: 'Concesión GAP de los aeropuertos de Los Cabos y La Paz',
    kind: 'viability',
    needIds: ['rc_aeropuerto_sjd', 'rc_aeropuerto_lap', 'proj_fed_aer_001'],
    needTypes: ['ResourceCapacity', 'Project'],
  },
  {
    q: 'En el escenario agua primero, ¿qué se prioriza?',
    kind: 'viability',
    needIds: ['ev_esc_water_first', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'DecisionQuestion'],
  },
  {
    q: '¿Cuántos destinos sin escala tiene SJD?',
    kind: 'opportunity',
    needIds: ['ev_sig_vuelos', 'rc_aeropuerto_sjd'],
    needTypes: ['Evidence', 'ResourceCapacity'],
  },
  {
    q: '¿Cuándo se creó Los Cabos con FONATUR?',
    kind: 'viability',
    needIds: ['ev_historia_bcs', 'terr_los_cabos'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: '¿BCS es una isla eléctrica?',
    kind: 'viability',
    needIds: ['rc_sibcs', 'const_red_aislada', 'ev_sig_sibcs'],
    needTypes: ['ResourceCapacity', 'Constraint', 'Evidence'],
  },
  {
    q: '¿Cuándo alivia P23 la transmisión entre La Paz y Los Cabos?',
    kind: 'viability',
    needIds: ['proj_p23_bs1', 'rc_tx_lapaz_cabos'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: '¿Hay baterías BESS en BCS?',
    kind: 'viability',
    needIds: ['rc_bess_gap'],
    needTypes: ['Constraint'],
  },
  {
    q: '¿La presa El Novillo abastece a La Paz?',
    kind: 'viability',
    needIds: ['proj_fed_agu_003'],
    needTypes: ['Project'],
  },
  {
    q: '¿Hay desaladora en La Paz?',
    kind: 'viability',
    needIds: ['proj_fed_agu_002', 'rc_acuifero_0324'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: 'La PTAR de Loreto está en obra',
    kind: 'viability',
    needIds: ['proj_fed_agu_005', 'terr_loreto', 'gap_loreto_dma'],
    needTypes: ['Project', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: '¿Qué hace la mesa de agua?',
    kind: 'viability',
    needIds: ['ev_mesa_agua', 'actor_cea', 'actor_conagua'],
    needTypes: ['Evidence', 'Actor'],
  },
  {
    q: '¿IMPLAN puede cambiar el uso de suelo?',
    kind: 'landuse',
    needIds: ['actor_implan_cabos', 'ev_mesa_urbanismo', 'inst_pdu_cabos', 'dq_cambio_uso_suelo'],
    needTypes: ['Actor', 'Evidence', 'Instrument'],
  },
  {
    q: 'Escenario de intensificar el corredor Cabos La Paz',
    kind: 'viability',
    needIds: ['ev_esc_corridor'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Escenario de puertos y aeropuertos como anclas',
    kind: 'viability',
    needIds: ['ev_esc_ports', 'rc_aeropuerto_sjd'],
    needTypes: ['Evidence', 'ResourceCapacity'],
  },
  {
    q: 'IED turística frente a la falta de agua en Cabos',
    kind: 'opportunity',
    needIds: ['ev_sig_tourism_fdi', 'const_dma_deficit'],
    needTypes: ['Evidence', 'Constraint'],
  },
  {
    q: 'Desaladoras y apagones acoplan agua y energía',
    kind: 'viability',
    needIds: ['ev_sig_water_energy', 'rc_sibcs'],
    needTypes: ['Evidence', 'ResourceCapacity'],
  },
  {
    q: '¿Qué planes cita el PEOTDU para La Paz?',
    kind: 'landuse',
    needIds: ['ev_peotdu_instrumentos', 'inst_pdu_lapaz'],
    needTypes: ['Evidence', 'Instrument'],
  },
  {
    q: '¿Hay plan para Los Barriles?',
    kind: 'landuse',
    needIds: ['ev_psdu_barriles', 'gap_east_cape_carga'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_east_cape_carga'],
  },
  {
    q: 'La nota dice que el PDU de Cabo del Este no salió en el boletín',
    kind: 'landuse',
    needIds: ['ev_news_pdu_este', 'gap_east_cape_instrumento'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_east_cape_instrumento'],
  },
  {
    q: '¿Cuál es la renta por noche en Los Cabos?',
    kind: 'viability',
    needIds: ['gap_rentas_hoteleras'],
    needTypes: ['Constraint'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    noRent: true,
  },
  {
    q: 'Segundas residencias en el corredor de Los Cabos',
    kind: 'opportunity',
    needIds: ['dd_residencial_cabos', 'ev_inmob_jll_2025'],
    needTypes: ['DemandDriver', 'Evidence'],
  },
  {
    q: 'Turismo en La Paz frente al acuífero',
    kind: 'opportunity',
    needIds: ['dd_turismo_lapaz', 'rc_acuifero_0324'],
    needTypes: ['DemandDriver', 'ResourceCapacity'],
  },
  {
    q: '¿OOMSAPAS opera el agua de Cabo San Lucas?',
    kind: 'viability',
    needIds: ['actor_oomsapas_cabos', 'ev_mesa_agua'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿SEPUIMM ordena el territorio del estado?',
    kind: 'viability',
    needIds: ['actor_sepuimm', 'inst_poerbcs'],
    needTypes: ['Actor', 'Instrument'],
  },
  {
    q: '¿CONANP administra Cabo Pulmo?',
    kind: 'viability',
    needIds: ['actor_conanp', 'terr_anp_cabo_pulmo', 'const_anp_nucleos'],
    needTypes: ['Actor', 'Territory', 'Constraint'],
  },
  {
    q: '¿Qué hace la Comisión Estatal del Agua?',
    kind: 'viability',
    needIds: ['actor_cea', 'ev_mesa_agua'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'El POEL de Los Cabos exige agua a los desarrolladores',
    kind: 'landuse',
    needIds: ['ev_sig_poel_cabos', 'inst_poel_cabos'],
    needTypes: ['Evidence', 'Instrument'],
  },
  {
    q: 'Vivienda social en Comondú y Mulegé',
    kind: 'opportunity',
    needIds: ['ev_sig_vivienda_social', 'terr_comondu', 'terr_mulege', 'gap_permisos_uso_suelo'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_permisos_uso_suelo'],
  },
  {
    q: 'Desaladora de Comondú y PTAR de Loreto',
    kind: 'viability',
    needIds: ['ev_sig_comondu_loreto', 'proj_fed_agu_005', 'gap_loreto_dma'],
    needTypes: ['Evidence', 'Project', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: 'Rachel cerró puertos en Los Cabos',
    kind: 'risk',
    needIds: ['ev_sig_hurricanes', 'dq_riesgos_principales'],
    needTypes: ['Evidence', 'DecisionQuestion'],
  },
  {
    q: 'Si seguimos la trayectoria actual del turismo',
    kind: 'viability',
    needIds: ['ev_esc_baseline', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'DecisionQuestion'],
  },
  {
    q: 'Amenidad en Todos Santos y el acuífero 0313',
    kind: 'viability',
    needIds: ['terr_todos_santos', 'rc_acuifero_0313', 'ev_acuiferos_dma'],
    needTypes: ['Territory', 'ResourceCapacity', 'Evidence'],
  },
  {
    q: 'East Cape recibe el desborde de Cabos',
    kind: 'viability',
    needIds: ['dq_pack_east_cape', 'gap_east_cape_carga', 'terr_anp_cabo_pulmo'],
    needTypes: ['DecisionQuestion', 'Constraint', 'Territory'],
    sinDatoIds: ['gap_east_cape_carga'],
  },
  {
    q: 'La transpeninsular cruza El Vizcaíno',
    kind: 'viability',
    needIds: ['terr_anp_vizcaino', 'proj_transpeninsular'],
    needTypes: ['Territory', 'Project'],
  },
  {
    q: '¿Quién dirige el IMPLAN de Los Cabos?',
    kind: 'viability',
    needIds: ['actor_implan_cabos', 'ev_org_cabos_2024', 'ev_mesa_urbanismo'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'Página de biblioteca sobre ordenamiento y el POER',
    kind: 'landuse',
    needIds: ['inst_poerbcs', 'inst_poer_politicas'],
    needTypes: ['Instrument'],
  },
  {
    q: '¿Cuántos MW tiene Oasis?',
    kind: 'viability',
    needIds: ['ev_sig_mulege_oasis', 'gap_mulege_agua_energia'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['ev_sig_mulege_oasis', 'gap_mulege_agua_energia'],
  },
  {
    q: '¿El turismo de Los Cabos cabe con el agua?',
    kind: 'viability',
    needIds: ['dd_turismo_cabos', 'const_dma_deficit'],
    needTypes: ['DemandDriver', 'Constraint'],
  },
  {
    q: 'Turismo en Los Cabos y en La Paz',
    kind: 'opportunity',
    needIds: ['dd_turismo_cabos', 'dd_turismo_lapaz'],
    needTypes: ['DemandDriver'],
  },
  {
    q: '¿El foro de noviembre cambia la viabilidad?',
    kind: 'viability',
    needIds: ['dd_eventos_foro', 'dq_viabilidad_proyecto'],
    needTypes: ['DemandDriver', 'DecisionQuestion'],
  },
  {
    q: 'Foro de Baja California Sur en noviembre',
    kind: 'opportunity',
    needIds: ['dd_eventos_foro', 'dq_oportunidades'],
    needTypes: ['DemandDriver', 'DecisionQuestion'],
  },
  {
    q: 'Mercado del Pacífico en Todos Santos según JLL',
    kind: 'opportunity',
    needIds: ['terr_todos_santos', 'ev_jll_zonas_2025'],
    needTypes: ['Territory', 'Evidence'],
    jllZones: true,
  },
  {
    q: '¿Quién dirige ecología en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_ecologia', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige catastro en Los Cabos?',
    kind: 'viability',
    needIds: ['ev_org_cabos_2024', 'actor_cabos_presidencia'],
    needTypes: ['Evidence', 'Actor'],
  },
  {
    q: '¿Quién dirige desarrollo urbano en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_desarrollo_urbano', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige fomento económico en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_fomento_economico', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige desarrollo social en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_desarrollo_social', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige servicios públicos en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_servicios_publicos', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige seguridad pública en Los Cabos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_seguridad_publica', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'Presidencia municipal de Los Cabos 2024',
    kind: 'viability',
    needIds: ['actor_cabos_presidencia', 'ev_org_cabos_2024', 'actor_ayunt_cabos'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'Qué dice el dossier de Mulegé',
    kind: 'viability',
    needIds: ['ev_dossiers_lugar', 'terr_mulege', 'gap_mulege_agua_energia'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_mulege_agua_energia'],
  },
  {
    q: 'Dossier de Loreto y su vocación',
    kind: 'viability',
    needIds: ['ev_dossiers_lugar', 'terr_loreto', 'gap_loreto_dma'],
    needTypes: ['Evidence', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: 'Mulegé es un desierto de evidencia',
    kind: 'viability',
    needIds: ['ev_dossiers_movilidad', 'gap_mulege_agua_energia', 'terr_mulege'],
    needTypes: ['Evidence', 'Constraint', 'Territory'],
    sinDatoIds: ['gap_mulege_agua_energia'],
  },
  {
    q: 'Mapas de orientación aérea del territorio',
    kind: 'viability',
    needIds: ['ev_orientacion_aerea'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Programa subregional de Las Playitas',
    kind: 'landuse',
    needIds: ['ev_peotdu_instrumentos', 'terr_todos_santos', 'inst_pdu_lapaz'],
    needTypes: ['Evidence', 'Territory', 'Instrument'],
    forbid: ['inst_pdu_cabos'],
  },
  {
    q: 'Plan de San Juan de la Costa',
    kind: 'landuse',
    needIds: ['ev_peotdu_instrumentos', 'inst_pdu_lapaz'],
    needTypes: ['Evidence', 'Instrument'],
    forbid: ['inst_pdu_cabos'],
  },
  {
    q: 'Veda de 1954 en el sur',
    kind: 'landuse',
    needIds: ['inst_veda_1954'],
    needTypes: ['Instrument'],
  },
  {
    q: 'Intrusión marina en La Paz',
    kind: 'risk',
    needIds: ['const_intrusion_marina', 'rc_acuifero_0324'],
    needTypes: ['Constraint', 'ResourceCapacity'],
  },
  {
    q: 'Tenencia de la tierra en Los Barriles',
    kind: 'landuse',
    needIds: ['const_tenencia', 'ev_psdu_barriles'],
    needTypes: ['Constraint', 'Evidence'],
  },
  {
    q: 'Cabo Pulmo y Bahía de Loreto como candados',
    kind: 'viability',
    needIds: ['terr_anp_cabo_pulmo', 'terr_anp_loreto', 'const_anp_nucleos'],
    needTypes: ['Territory', 'Constraint'],
  },
  {
    q: '¿Qué dice el organigrama de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_organigrama_cabos', 'ev_org_cabos_2024', 'gap_org_obras_cabos'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_org_obras_cabos'],
  },
  {
    q: '¿Quién dirige la delegación de La Ribera?',
    kind: 'viability',
    needIds: ['actor_cabos_delegaciones', 'actor_cabos_presidencia'],
    needTypes: ['Actor'],
  },
  {
    q: 'Delegado de Santiago en Los Cabos',
    kind: 'viability',
    needIds: ['actor_cabos_delegaciones'],
    needTypes: ['Actor'],
    forbid: ['rc_acuifero_0320'],
  },
  {
    q: '¿Quién es la delegada de Miraflores?',
    kind: 'viability',
    needIds: ['actor_cabos_delegaciones', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién dirige la Dirección General de Obras Públicas y Asentamientos Humanos?',
    kind: 'viability',
    needIds: ['actor_cabos_dg_obras_publicas', 'gap_org_obras_cabos'],
    needTypes: ['Actor', 'Constraint'],
    sinDatoIds: ['gap_org_obras_cabos'],
  },
  {
    q: '¿El APFF de Cabo San Lucas limita la costa?',
    kind: 'viability',
    needIds: ['terr_anp_apff_csl'],
    needTypes: ['Territory'],
  },
  {
    q: 'Corredor hotelero de Cabo San Lucas a San José del Cabo',
    kind: 'viability',
    needIds: ['terr_corredor_cabos', 'dd_turismo_cabos'],
    needTypes: ['Territory', 'DemandDriver'],
  },
  {
    q: 'Densificación costera observada en Los Cabos',
    kind: 'viability',
    needIds: ['terr_obs_cabos_coast', 'terr_los_cabos', 'dq_stills_densification'],
    needTypes: ['Territory'],
  },
  {
    q: 'Programa de manejo de Cabo Pulmo',
    kind: 'viability',
    needIds: ['ev_anp_pm', 'terr_anp_cabo_pulmo'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: 'Programa de manejo de El Vizcaíno',
    kind: 'viability',
    needIds: ['ev_anp_pm', 'terr_anp_vizcaino'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: 'Expediente del POER y su pronóstico',
    kind: 'landuse',
    needIds: ['ev_poerbcs', 'inst_poerbcs'],
    needTypes: ['Evidence', 'Instrument'],
  },
  {
    q: 'Plan Estatal de Desarrollo y el POER',
    kind: 'landuse',
    needIds: ['inst_ped', 'inst_poerbcs'],
    needTypes: ['Instrument'],
  },
  {
    q: '¿Qué dice el PRODESEN del SIBCS?',
    kind: 'viability',
    needIds: ['ev_prodesen', 'rc_sibcs'],
    needTypes: ['Evidence', 'ResourceCapacity'],
  },
  {
    q: 'Ficha APP de la desaladora de Los Cabos',
    kind: 'viability',
    needIds: ['ev_desal_app', 'proj_desal_cabos'],
    needTypes: ['Evidence', 'Project'],
  },
  {
    q: 'Perfil turístico SETUE de Los Cabos',
    kind: 'opportunity',
    needIds: ['ev_setue_ie', 'actor_setues'],
    needTypes: ['Evidence', 'Actor'],
  },
  {
    q: '¿CENACE opera la red aislada?',
    kind: 'viability',
    needIds: ['actor_cenace', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Actor', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Qué pasa en Todos Santos',
    kind: 'viability',
    needIds: ['terr_todos_santos', 'rc_acuifero_0313'],
    needTypes: ['Territory', 'ResourceCapacity'],
  },
  {
    q: 'Pescadero y su acuífero',
    kind: 'viability',
    needIds: ['terr_todos_santos', 'rc_acuifero_0313', 'ev_acuiferos_dma'],
    needTypes: ['Territory', 'ResourceCapacity', 'Evidence'],
  },
  {
    q: 'La Ribera no tiene PDU',
    kind: 'landuse',
    needIds: ['gap_east_cape_instrumento', 'gap_east_cape_carga'],
    needTypes: ['Constraint'],
    sinDatoIds: ['gap_east_cape_instrumento', 'gap_east_cape_carga'],
  },
  {
    q: 'Santiago y el acuífero 0320',
    kind: 'viability',
    needIds: ['rc_acuifero_0320', 'ev_acuiferos_dma', 'inst_veda_1954'],
    needTypes: ['ResourceCapacity', 'Evidence', 'Instrument'],
  },
  {
    q: 'Ciudad Constitución y el agro',
    kind: 'viability',
    needIds: ['terr_comondu', 'dd_agro_santo_domingo'],
    needTypes: ['Territory', 'DemandDriver'],
  },
  {
    q: 'Exportadora de Sal en Guerrero Negro',
    kind: 'viability',
    needIds: ['proj_fed_min_003', 'terr_mulege'],
    needTypes: ['Project', 'Territory'],
  },
  {
    q: 'Santa Rosalía y su puerto de cruceros',
    kind: 'opportunity',
    needIds: ['ev_cruceros_datatur', 'terr_mulege'],
    needTypes: ['Evidence', 'Territory'],
    cruiseSeries: true,
  },
  {
    q: 'Sierra La Laguna y Cabo Pulmo como parques',
    kind: 'viability',
    needIds: ['terr_anp_sierra_laguna', 'terr_anp_cabo_pulmo', 'const_anp_nucleos'],
    needTypes: ['Territory', 'Constraint'],
  },
  {
    q: 'East Cape y La Paz en el mismo corredor',
    kind: 'viability',
    needIds: ['terr_obs_east_cape', 'terr_la_paz', 'gap_east_cape_carga'],
    needTypes: ['Territory', 'Constraint'],
    sinDatoIds: ['gap_east_cape_carga'],
  },
  {
    q: 'Los Cabos y Loreto frente al agua',
    kind: 'viability',
    needIds: ['terr_los_cabos', 'terr_loreto', 'gap_loreto_dma'],
    needTypes: ['Territory', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: 'Mulegé y La Paz no comparten acuífero',
    kind: 'viability',
    needIds: ['terr_mulege', 'terr_la_paz', 'rc_acuifero_0324'],
    needTypes: ['Territory', 'ResourceCapacity'],
    forbid: ['dq_comparar_polos'],
  },
  {
    q: 'Todos Santos y Los Cabos no son el mismo polo',
    kind: 'viability',
    needIds: ['terr_todos_santos', 'terr_los_cabos'],
    needTypes: ['Territory'],
    forbid: ['ev_sig_hurricanes'],
  },
  {
    q: 'Paso a desnivel de la Glorieta Fonatur',
    kind: 'viability',
    needIds: ['proj_fed_car_002'],
    needTypes: ['Project'],
  },
  {
    q: '¿La CFE suma 70 MVA en la red de BCS?',
    kind: 'viability',
    needIds: ['proj_fed_ene_008', 'rc_sibcs'],
    needTypes: ['Project', 'ResourceCapacity'],
    forbid: ['rc_subestaciones_gap'],
  },
  {
    q: 'Subestación Buenavista y Cabo Falso',
    kind: 'viability',
    needIds: ['proj_fed_ene_007', 'rc_sibcs'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: '¿Cuál es la capacidad de carga de Los Cabos?',
    kind: 'viability',
    needIds: ['dq_capacidad_carga', 'const_dma_deficit', 'rc_sibcs'],
    needTypes: ['DecisionQuestion', 'Constraint', 'ResourceCapacity'],
  },
  {
    q: 'Integridad ecológica de Sierra La Laguna',
    kind: 'viability',
    needIds: ['dq_integridad_ecologica', 'terr_anp_sierra_laguna', 'const_anp_nucleos'],
    needTypes: ['DecisionQuestion', 'Territory', 'Constraint'],
  },
  {
    q: '¿Cuántas localidades hay en BCS?',
    kind: 'viability',
    needIds: ['ev_communities_master'],
    needTypes: ['Evidence'],
  },
  {
    q: '¿Qué acuerdo DOF actualizó la DMA de La Paz?',
    kind: 'viability',
    needIds: ['ev_dma', 'proj_fed_agu_008', 'rc_acuifero_0324'],
    needTypes: ['Evidence', 'Project', 'ResourceCapacity'],
  },
  {
    q: '¿La interconexión de BCS con el SIN está pausada?',
    kind: 'viability',
    needIds: ['proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Project', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: '¿Don Diego en el Golfo de Ulloa sigue vigente?',
    kind: 'viability',
    needIds: ['proj_fed_min_002'],
    needTypes: ['Project'],
  },
  {
    q: 'Glorieta de las Mujeres Libres',
    kind: 'viability',
    needIds: ['proj_fed_tur_002', 'proj_fed_car_002'],
    needTypes: ['Project'],
  },
  {
    q: '¿Cuántos puntos de costa protegida muestran los stills del estado?',
    kind: 'viability',
    needIds: ['ev_stills_intel'],
    needTypes: ['Evidence'],
  },
  {
    q: 'East Cape y Loreto no comparten aeropuerto',
    kind: 'viability',
    needIds: ['ev_dossiers_movilidad', 'terr_obs_east_cape', 'terr_loreto'],
    needTypes: ['Evidence', 'Territory'],
    forbid: ['dq_comparar_polos'],
  },
  {
    q: 'Comondú y La Paz frente al agro y al agua',
    kind: 'viability',
    needIds: ['terr_comondu', 'terr_la_paz', 'dd_agro_santo_domingo', 'rc_acuifero_0324'],
    needTypes: ['Territory', 'DemandDriver', 'ResourceCapacity'],
  },
  {
    q: '¿El POER cabe en la constitución política?',
    kind: 'landuse',
    needIds: ['inst_poerbcs', 'inst_poer_politicas'],
    needTypes: ['Instrument'],
    forbid: ['terr_comondu', 'dd_agro_santo_domingo'],
  },
  {
    q: '¿El acuífero 0314 compensa el déficit de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma', 'const_dma_deficit'],
    needTypes: ['Evidence', 'Constraint'],
    forbid: ['terr_comondu', 'dd_agro_santo_domingo'],
  },
  {
    q: '¿La escorrentía de La Paz es un volumen de inundación?',
    kind: 'viability',
    needIds: ['ev_escorrentia'],
    needTypes: ['Evidence'],
    noFloodVolume: true,
  },
  {
    q: '¿Qué dice la Ley de Aguas sobre la desaladora?',
    kind: 'viability',
    needIds: ['inst_ley_aguas', 'actor_cea', 'actor_conagua'],
    needTypes: ['Instrument', 'Actor'],
  },
  {
    q: '¿La costa protegida es un buffer frente al hotel en East Cape?',
    kind: 'viability',
    needIds: ['dq_coast_anp_buffers', 'const_coast_anp_pressure', 'terr_anp_cabo_pulmo'],
    needTypes: ['DecisionQuestion', 'Constraint', 'Territory'],
  },
  {
    q: '¿Un anuncio de proyecto federal ya está construido?',
    kind: 'viability',
    needIds: ['ev_federal_projects_inventory', 'inst_federal_pipeline'],
    needTypes: ['Evidence', 'Instrument'],
  },
  {
    q: '¿Cuál es el techo regulatorio de Baja California Sur?',
    kind: 'viability',
    needIds: ['terr_bcs', 'inst_poerbcs', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Territory', 'Instrument', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Nopoló en Loreto y el parque nacional',
    kind: 'viability',
    needIds: ['terr_loreto', 'terr_anp_loreto', 'gap_loreto_dma'],
    needTypes: ['Territory', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: 'Ciudad Insurgentes en Comondú',
    kind: 'viability',
    needIds: ['terr_comondu', 'dd_agro_santo_domingo'],
    needTypes: ['Territory', 'DemandDriver'],
    forbid: ['rc_plant_sol_insurgentes'],
  },
  {
    q: '¿Quién opera Puerto San Carlos?',
    kind: 'viability',
    needIds: ['ev_sig_asipona', 'terr_comondu'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: '¿Qué es el PAMRNT para la red de BCS?',
    kind: 'viability',
    needIds: ['inst_pamrnt', 'rc_sibcs', 'proj_p23_bs1', 'const_red_aislada'],
    needTypes: ['Instrument', 'ResourceCapacity', 'Project', 'Constraint'],
  },
  {
    q: '¿Qué cubre el plan de centro de población de La Paz?',
    kind: 'landuse',
    needIds: ['inst_pdu_lapaz', 'gap_pmdu_lapaz_texto', 'rc_acuifero_0324'],
    needTypes: ['Instrument', 'Constraint', 'ResourceCapacity'],
    sinDatoIds: ['gap_pmdu_lapaz_texto'],
  },
  {
    q: '¿Está publicado el texto del PMDU de La Paz?',
    kind: 'landuse',
    needIds: ['gap_pmdu_lapaz_texto', 'inst_pdu_lapaz'],
    needTypes: ['Constraint', 'Instrument'],
    sinDatoIds: ['gap_pmdu_lapaz_texto'],
  },
  {
    q: '¿El POEL de Loreto limita la bahía?',
    kind: 'landuse',
    needIds: ['inst_poel_loreto', 'gap_psdu_loreto_gazette', 'terr_anp_loreto'],
    needTypes: ['Instrument', 'Constraint', 'Territory'],
    sinDatoIds: ['gap_psdu_loreto_gazette'],
  },
  {
    q: 'Escasez de agua en Los Cabos',
    kind: 'viability',
    needIds: ['const_escasez_agua', 'const_dma_deficit', 'ev_acuiferos_dma'],
    needTypes: ['Constraint', 'Evidence'],
  },
  {
    q: '¿Cuándo se creó Baja California Sur?',
    kind: 'viability',
    needIds: ['ev_historia_bcs'],
    needTypes: ['Evidence'],
  },
  {
    q: '¿Cuándo se creó el municipio de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_historia_bcs'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Tercera actualización del PDU 2040',
    kind: 'landuse',
    needIds: ['gap_pdu_cabos_3a', 'inst_pdu_cabos'],
    needTypes: ['Constraint', 'Instrument'],
    sinDatoIds: ['gap_pdu_cabos_3a'],
  },
  {
    q: '¿Cuántos MVA tiene la subestación?',
    kind: 'viability',
    needIds: ['rc_subestaciones_gap', 'rc_sibcs'],
    needTypes: ['ResourceCapacity'],
    noSubstationList: true,
  },
  {
    q: '¿Cuántas llaves nuevas caben en Los Cabos?',
    kind: 'viability',
    needIds: ['rc_vivienda_cabos', 'const_dma_deficit', 'inst_pdu_cabos'],
    needTypes: ['ResourceCapacity', 'Constraint', 'Instrument'],
    noKeyCount: true,
  },
  {
    q: '¿El reúso sustituye la desaladora de Los Cabos?',
    kind: 'viability',
    needIds: ['const_escasez_agua', 'const_dma_deficit', 'proj_desal_cabos'],
    needTypes: ['Constraint', 'Project'],
  },
  {
    q: '¿La NOM-011 es la DMA?',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma'],
    needTypes: ['Evidence'],
  },
  {
    q: '8 de octubre de 1974',
    kind: 'viability',
    needIds: ['ev_historia_bcs'],
    needTypes: ['Evidence'],
  },
  {
    q: '¿La desaladora alcanza si crece Los Cabos?',
    kind: 'viability',
    needIds: ['dq_desal_vs_crecimiento', 'proj_desal_cabos', 'const_dma_deficit', 'rc_sibcs'],
    needTypes: ['DecisionQuestion', 'Project', 'Constraint', 'ResourceCapacity'],
  },
  {
    q: '¿El corredor del Vizcaíno tiene carretera?',
    kind: 'viability',
    needIds: ['dq_vizcaino_corridor', 'proj_transpeninsular', 'terr_anp_vizcaino'],
    needTypes: ['DecisionQuestion', 'Project', 'Territory'],
  },
  {
    q: '¿Qué infraestructura está lista para una APP?',
    kind: 'viability',
    needIds: ['dq_readiness_inversion', 'proj_desal_cabos', 'rc_sibcs', 'rc_aeropuerto_sjd'],
    needTypes: ['DecisionQuestion', 'Project', 'ResourceCapacity'],
  },
  {
    q: 'Los Cabos y Mulegé frente a la energía',
    kind: 'viability',
    needIds: ['terr_los_cabos', 'terr_mulege', 'rc_sibcs', 'gap_mulege_agua_energia'],
    needTypes: ['Territory', 'ResourceCapacity', 'Constraint'],
    sinDatoIds: ['gap_mulege_agua_energia'],
  },
  {
    q: 'Ayuntamiento de Comondú',
    kind: 'viability',
    needIds: ['actor_ayunt_comondu', 'terr_comondu', 'ev_fiscal_ley_2026'],
    needTypes: ['Actor', 'Territory', 'Evidence'],
  },
  {
    q: 'Ayuntamiento de Mulegé',
    kind: 'viability',
    needIds: ['actor_ayunt_mulege', 'terr_mulege', 'gap_fiscal_ingresos_2026'],
    needTypes: ['Actor', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_fiscal_ingresos_2026'],
  },
  {
    q: '¿Quién está en la mesa de energía?',
    kind: 'viability',
    needIds: ['ev_mesa_energia', 'actor_cfe', 'rc_sibcs'],
    needTypes: ['Evidence', 'Actor', 'ResourceCapacity'],
  },
  {
    q: '¿Qué hace la mesa de urbanismo?',
    kind: 'viability',
    needIds: ['ev_mesa_urbanismo', 'actor_implan_cabos', 'inst_pdu_cabos'],
    needTypes: ['Evidence', 'Actor', 'Instrument'],
  },
  {
    q: '¿GAP opera San José y La Paz?',
    kind: 'viability',
    needIds: ['rc_aeropuerto_sjd', 'rc_aeropuerto_lap', 'proj_fed_aer_001'],
    needTypes: ['ResourceCapacity', 'Project'],
  },
  {
    q: 'Agua primero antes de más hoteles',
    kind: 'viability',
    needIds: ['ev_esc_water_first', 'const_dma_deficit'],
    needTypes: ['Evidence', 'Constraint'],
  },
  {
    q: 'Si seguimos como vamos con el turismo',
    kind: 'viability',
    needIds: ['ev_esc_baseline', 'dq_viabilidad_proyecto'],
    needTypes: ['Evidence', 'DecisionQuestion'],
  },
  {
    q: 'Riesgos y oportunidades del agua en Los Cabos',
    kind: 'opportunity',
    also: 'risk',
    needIds: ['dq_riesgos_principales', 'dq_oportunidades', 'const_dma_deficit'],
    needTypes: ['DecisionQuestion', 'Constraint'],
  },
  {
    q: '¿Cuántos cruceristas llegaron a Cabo San Lucas?',
    kind: 'opportunity',
    needIds: ['ev_cruceros_datatur'],
    needTypes: ['Evidence'],
    cruiseSeries: true,
  },
  {
    q: '¿Se puede construir junto al parque de Cabo Pulmo?',
    kind: 'landuse',
    needIds: ['terr_anp_cabo_pulmo', 'const_anp_nucleos'],
    needTypes: ['Territory', 'Constraint'],
  },
  {
    q: 'Sierra La Laguna como recarga',
    kind: 'viability',
    needIds: ['terr_anp_sierra_laguna', 'dq_integridad_ecologica', 'const_anp_nucleos'],
    needTypes: ['Territory', 'DecisionQuestion', 'Constraint'],
  },
  {
    q: '¿Qué dice el ordenamiento ecológico del estado?',
    kind: 'landuse',
    needIds: ['inst_poerbcs', 'inst_poer_politicas'],
    needTypes: ['Instrument'],
  },
  {
    q: 'Ordenamiento ecológico de Loreto',
    kind: 'landuse',
    needIds: ['inst_poel_loreto', 'gap_psdu_loreto_gazette'],
    needTypes: ['Instrument', 'Constraint'],
    sinDatoIds: ['gap_psdu_loreto_gazette'],
  },
  {
    q: 'Programa de ampliación de la red eléctrica',
    kind: 'viability',
    needIds: ['inst_pamrnt', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Instrument', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: '¿Sigue pausada la unión con la red nacional?',
    kind: 'viability',
    needIds: ['proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Project', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Interconexión con el sistema nacional pausada',
    kind: 'viability',
    needIds: ['proj_fed_ene_010', 'rc_sibcs'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: 'Mesa del agua de Los Cabos',
    kind: 'viability',
    needIds: ['ev_mesa_agua', 'actor_cea', 'actor_conagua'],
    needTypes: ['Evidence', 'Actor'],
  },
  {
    q: '¿Quién cobra el agua en Cabo San Lucas?',
    kind: 'viability',
    needIds: ['actor_oomsapas_cabos', 'ev_mesa_agua'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'Titular de ecología en Los Cabos',
    kind: 'viability',
    needIds: ['actor_cabos_dg_ecologia', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién lleva el catastro municipal de Los Cabos?',
    kind: 'viability',
    needIds: ['ev_org_cabos_2024'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Línea de transmisión La Paz Los Cabos',
    kind: 'viability',
    needIds: ['rc_tx_lapaz_cabos', 'rc_sibcs'],
    needTypes: ['ResourceCapacity'],
  },
  {
    q: '¿Cuánta potencia pasa de La Paz a Los Cabos?',
    kind: 'viability',
    needIds: ['rc_tx_lapaz_cabos'],
    needTypes: ['ResourceCapacity'],
  },
  {
    q: 'Abrir más hoteles antes que el agua',
    kind: 'viability',
    needIds: ['ev_esc_water_first', 'const_dma_deficit'],
    needTypes: ['Evidence', 'Constraint'],
  },
  {
    q: 'Segunda casa en el corredor de Cabos',
    kind: 'opportunity',
    needIds: ['dd_residencial_cabos', 'ev_inmob_jll_2025'],
    needTypes: ['DemandDriver', 'Evidence'],
  },
  {
    q: '¿Un hotel cabe en El Vizcaíno?',
    kind: 'viability',
    needIds: ['terr_anp_vizcaino', 'const_anp_nucleos'],
    needTypes: ['Territory', 'Constraint'],
  },
  {
    q: 'Área de protección de Cabo San Lucas',
    kind: 'viability',
    needIds: ['terr_anp_apff_csl'],
    needTypes: ['Territory'],
  },
  {
    q: 'Plan de desarrollo urbano de Los Cabos',
    kind: 'landuse',
    needIds: ['inst_pdu_cabos', 'gap_pdu_cabos_3a'],
    needTypes: ['Instrument', 'Constraint'],
    sinDatoIds: ['gap_pdu_cabos_3a'],
  },
  {
    q: 'Plan de desarrollo urbano de La Paz',
    kind: 'landuse',
    needIds: ['inst_pdu_lapaz', 'gap_pmdu_lapaz_texto'],
    needTypes: ['Instrument', 'Constraint'],
    sinDatoIds: ['gap_pmdu_lapaz_texto'],
  },
  {
    q: 'Programa de desarrollo del sistema eléctrico',
    kind: 'viability',
    needIds: ['ev_prodesen', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Evidence', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Plan sexenal del gobierno del estado',
    kind: 'landuse',
    needIds: ['inst_ped', 'inst_poerbcs'],
    needTypes: ['Instrument'],
  },
  {
    q: 'Ocupación de hoteles en octubre',
    kind: 'viability',
    needIds: ['ev_news_ocupacion', 'gap_rentas_hoteleras'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    noRent: true,
  },
  {
    q: 'Titular de servicios públicos en Los Cabos',
    kind: 'viability',
    needIds: ['actor_cabos_dg_servicios_publicos', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: '¿Quién administra las áreas naturales protegidas?',
    kind: 'viability',
    needIds: ['actor_conanp', 'const_anp_nucleos'],
    needTypes: ['Actor', 'Constraint'],
  },
  {
    q: 'Secretaría de planeación del estado',
    kind: 'landuse',
    needIds: ['inst_poerbcs', 'inst_poer_politicas'],
    needTypes: ['Instrument'],
    forbid: ['actor_fp'],
  },
  {
    q: 'Energía que comparten La Paz y Los Cabos',
    kind: 'viability',
    needIds: ['rc_tx_lapaz_cabos', 'rc_sibcs'],
    needTypes: ['ResourceCapacity'],
    forbid: ['dq_comparar_polos'],
  },
  {
    q: 'Agua de Los Cabos y de La Paz',
    kind: 'viability',
    needIds: ['rc_acuifero_0317', 'rc_acuifero_0324', 'const_dma_deficit'],
    needTypes: ['ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Desaladoras de Los Cabos y La Paz',
    kind: 'viability',
    needIds: ['proj_desal_cabos', 'proj_fed_agu_002', 'const_dma_deficit'],
    needTypes: ['Project', 'Constraint'],
  },
  {
    q: 'Qué huecos tiene un hotel en Los Cabos',
    kind: 'viability',
    needIds: ['gap_rentas_hoteleras', 'const_dma_deficit'],
    needTypes: ['Constraint'],
    sinDatoIds: ['gap_rentas_hoteleras'],
  },
  {
    q: '¿Es viable y qué riesgos tiene un hotel en Los Cabos?',
    kind: 'viability',
    also: 'risk',
    needIds: ['dq_viabilidad_proyecto', 'dq_riesgos_principales'],
    needTypes: ['DecisionQuestion'],
  },
  {
    q: 'Quién decide y qué oportunidades hay en el agua de Cabos',
    kind: 'viability',
    also: 'opportunity',
    needIds: ['ev_mesa_agua', 'dq_oportunidades'],
    needTypes: ['Evidence', 'DecisionQuestion'],
  },
  {
    q: 'Núcleo de Cabo Pulmo',
    kind: 'viability',
    needIds: ['const_anp_nucleos', 'terr_anp_cabo_pulmo'],
    needTypes: ['Constraint', 'Territory'],
  },
  {
    q: 'Ordenamiento local de Los Cabos',
    kind: 'landuse',
    needIds: ['inst_poel_cabos', 'terr_los_cabos'],
    needTypes: ['Instrument', 'Territory'],
  },
  {
    q: 'Ampliar la red eléctrica de BCS',
    kind: 'viability',
    needIds: ['inst_pamrnt', 'rc_sibcs', 'const_red_aislada'],
    needTypes: ['Instrument', 'ResourceCapacity', 'Constraint'],
  },
  {
    q: 'Techo ecológico del estado',
    kind: 'landuse',
    needIds: ['inst_poerbcs', 'inst_poer_politicas'],
    needTypes: ['Instrument'],
  },
  {
    q: 'Aprovechamiento sustentable del ordenamiento',
    kind: 'landuse',
    needIds: ['inst_pa_aprovechamiento', 'gap_politica_uga_leyenda'],
    needTypes: ['Instrument', 'Constraint'],
    sinDatoIds: ['gap_politica_uga_leyenda'],
  },
  {
    q: 'Restauración en el ordenamiento estatal',
    kind: 'landuse',
    needIds: ['inst_pa_restauracion', 'gap_politica_uga_leyenda'],
    needTypes: ['Instrument', 'Constraint'],
    sinDatoIds: ['inst_pa_restauracion', 'gap_politica_uga_leyenda'],
  },
  {
    q: 'API en Loreto',
    kind: 'viability',
    needIds: ['proj_fed_pue_002'],
    needTypes: ['Project'],
  },
  {
    q: 'Aeropuerto de Loreto',
    kind: 'viability',
    needIds: ['ev_dossiers_movilidad', 'gap_loreto_dma'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_loreto_dma'],
  },
  {
    q: 'Densificar la costa de Los Cabos',
    kind: 'viability',
    needIds: ['terr_obs_cabos_coast', 'inst_pdu_cabos'],
    needTypes: ['Territory', 'Instrument'],
    forbid: ['gap_permisos_uso_suelo'],
  },
  {
    q: 'Cabildo de Comondú',
    kind: 'viability',
    needIds: ['actor_ayunt_comondu', 'terr_comondu', 'ev_fiscal_ley_2026'],
    needTypes: ['Actor', 'Territory', 'Evidence'],
  },
  {
    q: 'Cabildo de Mulegé',
    kind: 'viability',
    needIds: ['actor_ayunt_mulege', 'terr_mulege', 'gap_fiscal_ingresos_2026'],
    needTypes: ['Actor', 'Territory', 'Constraint'],
    sinDatoIds: ['gap_fiscal_ingresos_2026'],
  },
  {
    q: '¿Quién es la Comisión Nacional del Agua aquí?',
    kind: 'viability',
    needIds: ['actor_conagua', 'ev_acuiferos_dma'],
    needTypes: ['Actor', 'Evidence'],
  },
  {
    q: 'Marina de Cabo San Lucas quién la opera',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Escurrimiento en La Paz no es inundación',
    kind: 'viability',
    needIds: ['ev_escorrentia'],
    needTypes: ['Evidence'],
    noFloodVolume: true,
  },
  {
    q: '10 de abril de 1980',
    kind: 'viability',
    needIds: ['ev_historia_bcs'],
    needTypes: ['Evidence'],
  },
  {
    q: '20 de agosto de 1992 Loreto',
    kind: 'viability',
    needIds: ['ev_historia_bcs', 'terr_loreto'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: 'East Cape sin aeropuerto',
    kind: 'viability',
    needIds: ['ev_dossiers_movilidad', 'gap_east_cape_carga'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_east_cape_carga'],
    noAirport: true,
  },
  {
    q: 'Riesgos y quién decide el agua en Cabos',
    kind: 'viability',
    also: 'risk',
    needIds: ['dq_riesgos_principales', 'ev_mesa_agua'],
    needTypes: ['DecisionQuestion', 'Evidence'],
  },
  {
    q: 'Tarifas del puerto de Cabo San Lucas',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: '222 cuadros del Vizcaíno',
    kind: 'viability',
    needIds: ['dq_vizcaino_corridor', 'terr_anp_vizcaino'],
    needTypes: ['DecisionQuestion', 'Territory'],
  },
  {
    q: '6 de junio de 1995',
    kind: 'viability',
    needIds: ['ev_historia_bcs', 'terr_anp_cabo_pulmo'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: '30 de noviembre de 1988',
    kind: 'viability',
    needIds: ['ev_historia_bcs', 'terr_anp_vizcaino'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: 'Cuatro acuíferos en déficit',
    kind: 'viability',
    needIds: ['const_escasez_agua', 'ev_acuiferos_dma'],
    needTypes: ['Constraint', 'Evidence'],
  },
  {
    q: 'Tabla de disponibilidad de acuíferos',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Un remanente no compensa otro déficit',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma'],
    needTypes: ['Evidence'],
    forbid: ['terr_comondu', 'dd_agro_santo_domingo'],
  },
  {
    q: 'Ciudad Constitución',
    kind: 'viability',
    needIds: ['terr_comondu'],
    needTypes: ['Territory'],
  },
  {
    q: 'Ocupación en octubre no es renta',
    kind: 'viability',
    needIds: ['ev_news_ocupacion', 'gap_rentas_hoteleras'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    noRent: true,
  },
  {
    q: 'La conexión con la red del país sigue en pausa',
    kind: 'viability',
    needIds: ['proj_fed_ene_010', 'rc_sibcs'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: 'Anexo de participaciones 2025',
    kind: 'viability',
    needIds: ['ev_fiscal_anexo_2025'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Huecos, viabilidad y riesgos de un hotel en Cabos',
    kind: 'viability',
    also: 'risk',
    needIds: ['gap_rentas_hoteleras', 'dq_viabilidad_proyecto', 'dq_riesgos_principales'],
    needTypes: ['Constraint', 'DecisionQuestion'],
    sinDatoIds: ['gap_rentas_hoteleras'],
  },
  {
    q: 'Primero el agua, después los hoteles',
    kind: 'viability',
    needIds: ['ev_esc_water_first', 'const_dma_deficit'],
    needTypes: ['Evidence', 'Constraint'],
  },
  {
    q: 'Decreto de 1973 del área de Cabo San Lucas',
    kind: 'viability',
    needIds: ['terr_anp_apff_csl'],
    needTypes: ['Territory'],
  },
  {
    q: 'Amortiguamiento de la reserva El Vizcaíno',
    kind: 'viability',
    needIds: ['terr_anp_vizcaino', 'dq_vizcaino_corridor'],
    needTypes: ['Territory', 'DecisionQuestion'],
  },
  {
    q: 'Donde la costa toca un área protegida',
    kind: 'viability',
    needIds: ['dq_coast_anp_buffers', 'const_coast_anp_pressure'],
    needTypes: ['DecisionQuestion', 'Constraint'],
  },
  {
    q: 'Falta agua en Los Cabos',
    kind: 'viability',
    needIds: ['const_escasez_agua', 'const_dma_deficit'],
    needTypes: ['Constraint'],
  },
  {
    q: 'La ley estatal de aguas',
    kind: 'viability',
    needIds: ['inst_ley_aguas', 'actor_cea'],
    needTypes: ['Instrument', 'Actor'],
  },
  {
    q: 'Norma de disponibilidad media',
    kind: 'viability',
    needIds: ['ev_acuiferos_dma'],
    needTypes: ['Evidence'],
  },
  {
    q: '128 megawatts móviles',
    kind: 'viability',
    needIds: ['ev_news_cfe_128', 'rc_sibcs'],
    needTypes: ['Evidence', 'ResourceCapacity'],
    mobileMw: true,
  },
  {
    q: 'Eso no es el proyecto de hidrógeno',
    kind: 'viability',
    needIds: ['ev_sig_mulege_oasis', 'gap_mulege_agua_energia'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['ev_sig_mulege_oasis', 'gap_mulege_agua_energia'],
  },
  {
    q: 'El enlace con el sistema eléctrico nacional está pausado',
    kind: 'viability',
    needIds: ['proj_fed_ene_010', 'rc_sibcs'],
    needTypes: ['Project', 'ResourceCapacity'],
  },
  {
    q: 'Insurgentes y el valle agrícola',
    kind: 'viability',
    needIds: ['terr_comondu', 'dd_agro_santo_domingo'],
    needTypes: ['Territory', 'DemandDriver'],
    forbid: ['rc_plant_sol_insurgentes'],
  },
  {
    q: 'San Carlos lo opera API',
    kind: 'viability',
    needIds: ['ev_sig_asipona', 'proj_fed_pue_002'],
    needTypes: ['Evidence', 'Project'],
  },
  {
    q: 'Concesión de 50 años del puerto de Cabo',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: 'No hubo transferencia del puerto a API',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: 'El reporte de vivienda no es renta hotelera',
    kind: 'viability',
    needIds: ['ev_jll_zonas_2025', 'gap_rentas_hoteleras'],
    needTypes: ['Evidence', 'Constraint'],
    sinDatoIds: ['gap_rentas_hoteleras'],
    jllZones: true,
  },
  {
    q: 'El puerto de San Carlos',
    kind: 'viability',
    needIds: ['ev_sig_asipona', 'terr_comondu'],
    needTypes: ['Evidence', 'Territory'],
  },
  {
    q: 'El reúso no alcanza si crece Cabos',
    kind: 'viability',
    needIds: ['const_escasez_agua', 'dq_desal_vs_crecimiento', 'proj_desal_cabos'],
    needTypes: ['Constraint', 'DecisionQuestion', 'Project'],
  },
  {
    q: 'La desaladora no borra el déficit',
    kind: 'viability',
    needIds: ['proj_desal_cabos', 'const_dma_deficit'],
    needTypes: ['Project', 'Constraint'],
  },
  {
    q: 'Cuellos de la red en el programa de ampliación',
    kind: 'viability',
    needIds: ['inst_pamrnt', 'rc_sibcs'],
    needTypes: ['Instrument', 'ResourceCapacity'],
  },
  {
    q: 'Concesión de febrero de 2024 en Cabo',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: 'Tarifas del 1 de octubre en el puerto',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
  },
  {
    q: 'El gobernador pidió que API administre Cabo',
    kind: 'viability',
    needIds: ['ev_sig_asipona'],
    needTypes: ['Evidence'],
    forbid: ['actor_gobernador'],
  },
  {
    q: 'Rosa Esther Natali de ecología',
    kind: 'viability',
    needIds: ['actor_cabos_dg_ecologia', 'ev_org_cabos_2024'],
    needTypes: ['Actor', 'Evidence'],
  },
];

const NEGATIVES = [
  '¿Cuánta gente vive en La Paz?',
  '¿Cuál es la DMA del acuífero 0317?',
  '¿Cuántos campos de golf hay en Los Cabos?',
  '¿Una desaladora del triple en Los Cabos?',
  '¿Cuántas viviendas dañó Polo?',
  'El discurso cita 3000 lotes en Los Cabos',
  'Sin luz en las delegaciones de La Paz',
  '1980',
  'La constitución política del estado',
  'la sierra recarga',
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
  if (c.census) {
    const pob = ev.find((x) => (x.onto_id || '') === 'ev_pob_censo_2020');
    const text = `${pob?.sum_es || ''} ${pob?.sum_en || ''}`;
    if (!/351111/.test(text) || !/18052/.test(text)) fail(`${c.q} census figures missing`);
    if (/\bageb\b/i.test(text) && !/no es ageb|not an ageb/i.test(text)) fail(`${c.q} AGEB invented`);
  }
  if (c.fiscal2026) {
    const ley = ev.find((x) => (x.onto_id || '') === 'ev_fiscal_ley_2026');
    const text = `${ley?.sum_es || ''} ${ley?.sum_en || ''}`;
    if (!/7421559352/.test(text)) fail(`${c.q} Cabos 2026 revenue-law amount missing`);
    if (!/sin dato/i.test(text)) fail(`${c.q} Mulegé/Loreto revenue-law gap missing`);
    if (/muleg[eé][^.]{0,40}\d{7,}/i.test(text)) fail(`${c.q} invented a Mulegé revenue amount`);
  }
  if (c.cruiseSeries) {
    const cru = ev.find((x) => (x.onto_id || '') === 'ev_cruceros_datatur');
    const text = `${cru?.sum_es || ''} ${cru?.sum_en || ''}`;
    if (!/1,057,758|1057758/.test(text)) fail(`${c.q} published cruise series missing`);
    if (/loreto[^.]{0,40}89,?600/i.test(text)) fail(`${c.q} reconciled Loreto passengers into cruises`);
  }
  if (c.jllZones) {
    const z = ev.find((x) => (x.onto_id || '') === 'ev_jll_zonas_2025');
    const text = `${z?.sum_es || ''} ${z?.sum_en || ''}`;
    if (!/\b42\b/.test(text)) fail(`${c.q} Loreto MLS volume missing`);
    if (!/no es renta hotelera|not hotel rent/i.test(text)) fail(`${c.q} must keep hotel rents out`);
  }
  if (c.noKeyCount) {
    const keys = ev.find((x) => (x.onto_id || '') === 'rc_vivienda_cabos');
    const text = `${keys?.sum_es || ''} ${keys?.sum_en || ''}`;
    if (/\b\d+\s*llaves\b/i.test(text)) fail(`${c.q} invented a key count`);
  }
  if (c.noSubstationList) {
    const sub = ev.find((x) => (x.onto_id || '') === 'rc_subestaciones_gap');
    const text = `${sub?.sum_es || ''} ${sub?.sum_en || ''}`;
    if (!/falta listado|not consolidated|no consolidado/i.test(text)) fail(`${c.q} substation list must stay unpublished`);
    if (/\b\d+\s*mva\b/i.test(text)) fail(`${c.q} invented a substation MVA`);
  }
  if (c.noFloodVolume) {
    const run = ev.find((x) => (x.onto_id || '') === 'ev_escorrentia');
    const text = `${run?.sum_es || ''} ${run?.sum_en || ''}`;
    if (!/no caudales|not a discharge|not an official flood/i.test(text)) fail(`${c.q} runoff must stay a reach count`);
  }
  if (c.noAirport) {
    const mob = ev.find((x) => (x.onto_id || '') === 'ev_dossiers_movilidad');
    const text = `${mob?.sum_es || ''} ${mob?.sum_en || ''}`;
    if (!/sin aeropuerto propio|no airport of its own/i.test(text)) fail(`${c.q} East Cape airport fact missing`);
    if (!/no se reconcilia|not reconciled/i.test(text)) fail(`${c.q} Loreto passengers must stay unreconciled`);
  }
  if (c.noRent) {
    const news = ev.find((x) => (x.onto_id || '') === 'ev_news_ocupacion');
    const text = `${news?.sum_es || ''} ${news?.sum_en || ''}`;
    if (!/no son renta|are not rents/i.test(text)) fail(`${c.q} occupancy notes must not become rents`);
    if (/\b\d+\s*(usd|dolares|pesos)\s+por noche\b/i.test(text)) fail(`${c.q} invented a nightly rate`);
  }
  if (c.noPaxTotal) {
    const gap = ev.find((x) => (x.onto_id || '') === 'gap_loreto_pax');
    const text = `${gap?.sum_es || ''} ${gap?.sum_en || ''}`;
    if (!/89600/.test(text) || !/no se suman|not added/i.test(text)) fail(`${c.q} Loreto passengers must stay unreconciled`);
  }
  if (c.noAssign0302) {
    const gap = ev.find((x) => (x.onto_id || '') === 'gap_acuifero_0302');
    const text = `${gap?.sum_es || ''} ${gap?.sum_en || ''}`;
    if (!/no se asigna a muleg|not assigned to muleg/i.test(text)) fail(`${c.q} 0302 must stay unassigned`);
  }
  if (c.mobileMw) {
    const news = ev.find((x) => (x.onto_id || '') === 'ev_news_cfe_128');
    const text = `${news?.sum_es || ''} ${news?.sum_en || ''}`;
    if (!/128/.test(text) || !/no es el proyecto oasis|not the oasis project/i.test(text)) {
      fail(`${c.q} mobile megawatts must stay separate from Oasis`);
    }
  }
  if (c.vizcainoGap) {
    const avisos = ev.find((x) => (x.onto_id || '') === 'ev_anp_avisos');
    const text = `${avisos?.sum_es || ''} ${avisos?.sum_en || ''}`;
    if (!/no asigna el acu[ií]fero 0302|does not assign aquifer 0302/i.test(text)) {
      fail(`${c.q} Vizcaíno notice must keep 0302 unassigned`);
    }
  }
  if (c.portOperator) {
    const op = ev.find((x) => (x.onto_id || '') === 'ev_sig_asipona');
    const text = `${op?.sum_es || ''} ${op?.sum_en || ''}`;
    if (!/no es una transferencia|not a transfer/i.test(text)) fail(`${c.q} must keep the ASIPONA transfer as intention`);
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
if (!dma.isWaterIntent || dma.isFactorIntent) fail('DMA query lost water intent');
const dma0302 = expandQuery('¿Cuál es la DMA del acuífero 0302?');
if (!dma0302.isWaterIntent || dma0302.isFactorIntent) fail('bare DMA 0302 became a factor intent');
const pop = expandQuery('¿Cuánta gente vive en La Paz?');
if (!pop.isDemoIntent || pop.isFactorIntent) fail('population query lost demo intent');
if (inferPlaceId('¿El POER cabe en la constitución política?') === 'comondu') fail('constitución política became Comondú');
if (inferPlaceId('Ciudad Constitución y el agro') !== 'comondu') fail('Ciudad Constitución lost Comondú');
if (inferPlaceId('Nopoló y el parque') !== 'loreto') fail('Nopoló lost Loreto');
const constiMaps = targetMunis('¿El POER cabe en la constitución política?');
if (constiMaps && constiMaps.includes('Comondú')) fail('constitución política pulled Comondú maps');

function briefOf(q) {
  const intents = expandQuery(q);
  return composeFactorBrief(buildFactorEvidence(q, intents), 'es');
}
const SECTION = /^(Viabilidad|Riesgos y restricciones|Oportunidades|Quién decide|Capacidades|Instrumentos|HUECOS — sin dato)/;
function sectionCount(text) {
  return text.split('\n').filter((line) => SECTION.test(line)).length;
}
const hotelBrief = briefOf('¿Es viable un hotel en Los Cabos?');
if (sectionCount(hotelBrief) < 2) fail(`hotel brief names fewer than two factor sections\n${hotelBrief.slice(0, 400)}`);
const rentBrief = briefOf('¿Cuál es la renta hotelera y el cap rate de un hotel en Los Cabos?');
if (!/HUECO — sin dato:/.test(rentBrief) || !/sin dato/i.test(rentBrief)) fail('rent brief hid the sin-dato gap');
const multiBrief = briefOf('Riesgos principales y oportunidades en Mulegé y el Vizcaíno');
if (sectionCount(multiBrief) < 2) fail(`multi-factor brief names fewer than two sections\n${multiBrief.slice(0, 400)}`);
const oasisBrief = briefOf('¿Las turbinas móviles de CFE en Los Cabos son el proyecto Oasis?');
if (!/HUECO — sin dato:/.test(oasisBrief) || !/\b128\b/.test(oasisBrief)) fail('turbine brief lost the gap or the 128 MW card');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nfactor bundle check ok');
