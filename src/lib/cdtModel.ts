/**
 * Phase-1 territorial twin view-model.
 * Every figure is read from data already in the portal. Missing parses throw
 * at build time so a broken extract cannot ship as a blank or invented KPI.
 */
import gds from '../data/growth_demand_supply.json';
import scenariosDoc from '../data/scenarios.json';
import municipios from '../data/municipios.json';
import inmobiliario from '../data/inmobiliario_metrics.json';
import ports from '../data/ports_demand.json';
import federal from '../data/federal_projects.json';
import foresights from '../data/foresights.json';
import questionsDoc from '../data/strategic_questions.json';
import gapsDoc from '../data/data_gaps.json';
import layersDoc from '../../public/gis/layers.json';
import ontology from '../../netlify/functions/ontology_graph.json';
import fiscal from '../data/fiscal_docs.json';
import { vistas } from './vistas';

export type CdtThemeId = 'urbano' | 'economia' | 'investigacion' | 'movilidad' | 'vivienda';

export type CdtKpi = {
  value: string;
  label_es: string;
  label_en: string;
  source_es: string;
  source_en: string;
  href: string;
};

export type CdtIndicatorId =
  | 'pob'
  | 'sniiv_2025'
  | 'pobreza_pct'
  | 'anexo'
  | 'locs'
  | 'crucero_arribos'
  | 'crucero_pax'
  | 'ley';

const MUNI_ORDER = ['Los Cabos', 'La Paz', 'Comondú', 'Mulegé', 'Loreto'] as const;

const PLACE_BY_MUNI: Record<(typeof MUNI_ORDER)[number], string[]> = {
  'Los Cabos': ['los_cabos', 'east_cape'],
  'La Paz': ['la_paz', 'todos_santos'],
  Comondú: ['comondu'],
  Mulegé: ['mulege_north'],
  Loreto: ['loreto'],
};

const THEME_LAYERS: Record<CdtThemeId, string[]> = {
  urbano: ['settlements', 'osm_towns', 'poer_ugas', 'focus_corridor_cabos_lapaz'],
  economia: ['federal_projects', 'settlements', 'focus_corridor_cabos_lapaz'],
  investigacion: ['anp_federales', 'poer_ugas', 'rtp_conabio'],
  movilidad: ['osm_highways', 'highway_nodes', 'osm_transport_nodes', 'focus_ports_air'],
  vivienda: ['settlements', 'anp_federales', 'poer_ugas', 'focus_water_dmas'],
};

const BALANCE_RULE: Record<string, { es: string; en: string }> = {
  constrained: {
    es: 'No abrir más crecimiento turístico o residencial sin evidencia de margen de agua o de una fuente que no sea el acuífero. Ese margen no se transfiere desde otro municipio.',
    en: 'Do not open more tourism or residential growth without evidence of water headroom or a source other than the aquifer. That headroom does not transfer from another municipality.',
  },
  contested: {
    es: 'Respetar el techo de área protegida y de ordenamiento antes de escalar la hotelería.',
    en: 'Respect the protected-area and zoning ceiling before scaling hospitality.',
  },
  headroom: {
    es: 'El margen relativo de este lugar no compensa el déficit de otro. Puede sumar producción sin vaciar servicios ni áreas protegidas.',
    en: 'Relative headroom here does not offset a deficit elsewhere. It can add production without emptying services or protected areas.',
  },
  unknown: {
    es: 'Falta evidencia, sobre todo de agua. No asumir un escenario de crecimiento hasta cerrar esa brecha.',
    en: 'Evidence is missing, especially on water. Do not assume a growth scenario until that gap is closed.',
  },
};

const THEMES_BY_PLACE: Record<string, CdtThemeId[]> = {
  los_cabos: ['urbano', 'economia', 'movilidad', 'vivienda'],
  east_cape: ['urbano', 'economia', 'movilidad', 'vivienda'],
  todos_santos: ['urbano', 'economia', 'vivienda'],
  la_paz: ['urbano', 'economia', 'movilidad', 'vivienda'],
  loreto: ['urbano', 'economia', 'movilidad', 'vivienda'],
  comondu: ['urbano', 'economia', 'movilidad', 'vivienda'],
  mulege_north: ['urbano', 'economia', 'movilidad', 'vivienda'],
};

function scenariosForPlace(placeId: string): string[] {
  const ids = ['baseline'];
  if (['los_cabos', 'east_cape', 'todos_santos', 'la_paz'].includes(placeId)) ids.push('corridor_intensify');
  if (['los_cabos', 'east_cape', 'todos_santos', 'la_paz', 'loreto'].includes(placeId)) ids.push('water_first');
  if (['los_cabos', 'la_paz', 'loreto', 'mulege_north', 'comondu'].includes(placeId)) ids.push('ports_air_hubs');
  return ids;
}

function mustMatch(label: string, re: RegExp, text: string): string {
  const m = text.match(re);
  if (!m?.[1]) throw new Error(`CDT extract failed: ${label}`);
  return m[1];
}

function parsePoverty(md: string): Record<string, { pct: number; people: number }> {
  const section = md.split('### E1. Poverty')[1]?.split('### E2')[0] || '';
  const re =
    /\|\s*\**([^*|\n]+?)\**\s*\|\s*\**([0-9]+(?:\.[0-9]+)?)\**\s*\|\s*\**([0-9][0-9,]*)\**\s*\|/g;
  const out: Record<string, { pct: number; people: number }> = {};
  for (const m of section.matchAll(re)) {
    const name = m[1].replace(/\*/g, '').trim();
    out[name] = { pct: Number(m[2]), people: Number(m[3].replace(/,/g, '')) };
  }
  return out;
}

function fmtInt(n: number): string {
  return n.toLocaleString('es-MX');
}

const poverty = parsePoverty(ports.markdown['demand_target_groups.md']);
for (const name of MUNI_ORDER) {
  if (!poverty[name] || !Number.isFinite(poverty[name].pct)) {
    throw new Error(`CDT poverty missing for ${name}`);
  }
}

const sniivByMuni = inmobiliario.sniiv_vivienda_bcs.registro_2025_by_municipio;
for (const name of MUNI_ORDER) {
  const v = sniivByMuni[name as keyof typeof sniivByMuni];
  if (typeof v !== 'number') throw new Error(`CDT SNIIV missing for ${name}`);
}

const cruises = ports.markdown['cruises.md'];
const cslCalls = Number(mustMatch('CSL calls', /\*\*Cabo San Lucas\*\* \| 221 \| \*\*(\d+)\*\*/, cruises));
const cslPax = Number(
  mustMatch('CSL pax', /\*\*Cabo San Lucas\*\* \| 788,537 \| \*\*([0-9,]+)\*\*/, cruises).replace(/,/g, ''),
);
const pichCalls = Number(mustMatch('Pichilingue calls', /\*\*Pichilingue\*\* \| 25 \| \*\*(\d+)\*\*/, cruises));
const pichPax = Number(
  mustMatch('Pichilingue pax', /\*\*Pichilingue\*\* \| 42,838 \| \*\*([0-9,]+)\*\*/, cruises).replace(/,/g, ''),
);

function cruise2025(start: string, end: string, needle: string): number {
  const section = cruises.split(start)[1]?.split(end)[0] || '';
  const line = section.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error(`CDT cruise row missing: ${needle}`);
  const cells = line.split('|').map((c) => c.replace(/\*/g, '').trim()).filter(Boolean);
  const n = Number(String(cells[2] || '').replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`CDT cruise value missing: ${needle}`);
  return n;
}
const cruiseCall = (needle: string) => cruise2025('## 1.', '## 2.', needle);
const cruisePax = (needle: string) => cruise2025('## 2. Passengers', '## 3.', needle);

const paxByCode: Record<string, number> = {};
for (const row of ports.airports) {
  if (row.metric === 'passengers' && row.period === 'CY2025') {
    const n = Number(row.value);
    if (Number.isFinite(n)) paxByCode[row.airport_code] = n;
  }
}
if (!paxByCode.SJD || !paxByCode.LAP || !paxByCode.BCS) throw new Error('CDT airport passengers missing');

const flights = gds.metrics.flights;
const dma = gds.metrics.dma_hm3;

const places = gds.places;
const placeById = Object.fromEntries(places.map((p) => [p.id, p]));

type MuniName = (typeof MUNI_ORDER)[number];
type MuniRow = (typeof municipios)[MuniName];

for (const name of MUNI_ORDER) {
  if (fiscal.anexo_i33_2025[name] !== municipios[name].anexo_i33_2025) {
    throw new Error(`CDT anexo mismatch ${name}`);
  }
}
for (const name of ['Los Cabos', 'La Paz', 'Comondú'] as const) {
  if (fiscal.ley_ingresos_2026[name] !== municipios[name].ley_ingresos_2026) {
    throw new Error(`CDT revenue-law mismatch ${name}`);
  }
}
if (municipios['Mulegé'].ley_ingresos_2026 != null || municipios.Loreto.ley_ingresos_2026 != null) {
  throw new Error('CDT expected a blank 2026 revenue law for Mulegé and Loreto');
}

const cruiseByMuni: Record<MuniName, { calls: number; pax: number; ports_es: string; ports_en: string }> = {
  'Los Cabos': {
    calls: cruiseCall('Cabo San Lucas'),
    pax: cruisePax('Cabo San Lucas'),
    ports_es: 'Cabo San Lucas',
    ports_en: 'Cabo San Lucas',
  },
  'La Paz': {
    calls: cruiseCall('Pichilingue') + cruiseCall('| **La Paz** |'),
    pax: cruisePax('Pichilingue') + cruisePax('| **La Paz** |'),
    ports_es: 'Pichilingue y el puerto de La Paz',
    ports_en: 'Pichilingue and the port of La Paz',
  },
  Comondú: {
    calls: cruiseCall('San Carlos'),
    pax: cruisePax('San Carlos'),
    ports_es: 'San Carlos',
    ports_en: 'San Carlos',
  },
  Mulegé: {
    calls: cruiseCall('Santa Rosalía'),
    pax: cruisePax('Santa Rosalía'),
    ports_es: 'Santa Rosalía',
    ports_en: 'Santa Rosalía',
  },
  Loreto: {
    calls: cruiseCall('| **Loreto** |') + cruiseCall('Puerto Escondido (B.C.S.)'),
    pax: cruisePax('| **Loreto** |') + cruisePax('Puerto Escondido BCS'),
    ports_es: 'Loreto y Puerto Escondido',
    ports_en: 'Loreto and Puerto Escondido',
  },
};
if (cruiseByMuni['Los Cabos'].calls !== cslCalls || cruiseByMuni['La Paz'].calls < pichCalls) {
  throw new Error('CDT cruise municipal sum failed the known Cabo San Lucas / Pichilingue check');
}

export type CdtMuni = {
  name: string;
  short: string;
  studio: string;
  pob: number;
  locs: number;
  cab_pob: number;
  cabecera: string;
  ley: number | null;
  crucero_arribos: number;
  crucero_pax: number;
  crucero_ports_es: string;
  crucero_ports_en: string;
  anexo: number;
  sniiv_2025: number;
  pobreza_pct: number;
  pobreza_personas: number;
  locks_es: string;
  locks_en: string;
  strengths_es: string;
  strengths_en: string;
  crecimiento: string;
  vista: string;
  vista_es: string;
  vista_en: string;
  subplaces: Array<{
    id: string;
    name_es: string;
    name_en: string;
    balance: string;
    balance_es: string;
    balance_en: string;
  }>;
};

const VISTA_FOR_MUNI: Record<MuniName, (typeof vistas)[number]['id']> = {
  'Los Cabos': 'corredor',
  'La Paz': 'corredor',
  Comondú: 'vivienda',
  Mulegé: 'puertos',
  Loreto: 'puertos',
};

const munis: CdtMuni[] = MUNI_ORDER.map((name) => {
  const row = municipios[name] as MuniRow;
  const subs = PLACE_BY_MUNI[name].map((id) => {
    const p = placeById[id];
    if (!p) throw new Error(`CDT place missing: ${id}`);
    return {
      id,
      name_es: p.name_es,
      name_en: p.name_en,
      balance: p.balance_read,
      balance_es: p.balance_read_es,
      balance_en: p.balance_read_en,
    };
  });
  return {
    name,
    short: name === 'Los Cabos' ? 'Cabos' : name === 'Comondú' ? 'Comondú' : name,
    studio: `/studio/${PLACE_BY_MUNI[name][0] === 'mulege_north' ? 'mulege' : PLACE_BY_MUNI[name][0]}/`,
    pob: row.pob,
    locs: row.locs,
    cab_pob: row.cab_pob,
    cabecera: row.cabecera,
    ley: row.ley_ingresos_2026,
    crucero_arribos: cruiseByMuni[name].calls,
    crucero_pax: cruiseByMuni[name].pax,
    crucero_ports_es: cruiseByMuni[name].ports_es,
    crucero_ports_en: cruiseByMuni[name].ports_en,
    anexo: row.anexo_i33_2025,
    sniiv_2025: sniivByMuni[name as keyof typeof sniivByMuni] as number,
    pobreza_pct: poverty[name].pct,
    pobreza_personas: poverty[name].people,
    locks_es: row.locks_es,
    locks_en: row.locks_en,
    strengths_es: row.strengths_es,
    strengths_en: row.strengths_en,
    crecimiento: `/crecimiento/#${PLACE_BY_MUNI[name][0]}`,
    vista: `/vistas/#${VISTA_FOR_MUNI[name]}`,
    vista_es: vistas.find((v) => v.id === VISTA_FOR_MUNI[name])!.es,
    vista_en: vistas.find((v) => v.id === VISTA_FOR_MUNI[name])!.en,
    subplaces: subs,
  };
});

const popSum = munis.reduce((s, m) => s + m.pob, 0);
const locSum = munis.reduce((s, m) => s + m.locs, 0);
if (popSum !== 798447) throw new Error(`CDT population sum ${popSum} != 798447`);
if (locSum !== 2543) throw new Error(`CDT locality sum ${locSum} != 2543`);

const leyKnown = munis.filter((m) => typeof m.ley === 'number') as Array<CdtMuni & { ley: number }>;
const leyMissing = munis.filter((m) => m.ley == null).map((m) => m.name).join(' y ');

const dmaLine = ['0317', '0319', '0324', '0313', '0318'].map((k) => `${k} ${dma[k as keyof typeof dma]}`).join(' · ');

const layerIds = new Set<string>();
for (const ids of Object.values(THEME_LAYERS)) ids.forEach((id) => layerIds.add(id));
for (const sc of scenariosDoc.scenarios) sc.priority_layer_ids.forEach((id) => layerIds.add(id));

const layerCatalog = (layersDoc as ReadonlyArray<{
  id: string;
  url: string;
  type: string;
  color?: string;
  name_es: string;
  name_en: string;
}>)
  .filter((l) => layerIds.has(l.id))
  .map((l) => ({
    id: l.id,
    url: l.url,
    type: l.type,
    color: l.color || '#0083C4',
    name_es: l.name_es,
    name_en: l.name_en,
  }));

const found = new Set(layerCatalog.map((l) => l.id));
for (const id of layerIds) {
  if (!found.has(id)) throw new Error(`CDT layer missing from GIS catalog: ${id}`);
}

const indicators: Array<{
  id: CdtIndicatorId;
  label_es: string;
  label_en: string;
  unit_es: string;
  unit_en: string;
  source_es: string;
  source_en: string;
  quality_es: string;
  quality_en: string;
  complete: boolean;
}> = [
  {
    id: 'pob',
    label_es: 'Población 2020',
    label_en: 'Population 2020',
    unit_es: 'habitantes',
    unit_en: 'people',
    source_es: 'INEGI Censo 2020',
    source_en: 'INEGI Census 2020',
    quality_es: 'Serie completa en los cinco municipios. Escala municipal.',
    quality_en: 'Complete series for all five municipalities. Municipal scale.',
    complete: true,
  },
  {
    id: 'sniiv_2025',
    label_es: 'Registro de vivienda 2025',
    label_en: 'Housing registry 2025',
    unit_es: 'viviendas',
    unit_en: 'homes',
    source_es: 'SNIIV / SEDATU, registro 2025',
    source_en: 'SNIIV / SEDATU, 2025 registry',
    quality_es: 'Serie completa. No es el rezago CONAVI ni el mercado de alto valor.',
    quality_en: 'Complete series. It is not the CONAVI backlog and not the high-value market.',
    complete: true,
  },
  {
    id: 'pobreza_pct',
    label_es: 'Pobreza 2020',
    label_en: 'Poverty 2020',
    unit_es: '% de personas',
    unit_en: '% of people',
    source_es: 'CONEVAL, pobreza municipal 2020',
    source_en: 'CONEVAL, municipal poverty 2020',
    quality_es: 'Serie completa. La base de personas CONEVAL no es la misma que el Censo.',
    quality_en: 'Complete series. The CONEVAL person base is not the Census base.',
    complete: true,
  },
  {
    id: 'locs',
    label_es: 'Localidades 2020',
    label_en: 'Localities 2020',
    unit_es: 'localidades',
    unit_en: 'localities',
    source_es: 'INEGI Censo 2020',
    source_en: 'INEGI Census 2020',
    quality_es: 'Serie completa. Cuenta localidades, no manzanas ni forma urbana.',
    quality_en: 'Complete series. It counts localities, not blocks or urban form.',
    complete: true,
  },
  {
    id: 'anexo',
    label_es: 'Anexo I.33 2025',
    label_en: 'Annex I.33 2025',
    unit_es: 'MXN',
    unit_en: 'MXN',
    source_es: 'Finanzas BCS, transferencias y participaciones 2025',
    source_en: 'BCS finance, 2025 transfers and revenue shares',
    quality_es: 'Serie completa. Es transferencia federal, no ingreso propio ni PIB.',
    quality_en: 'Complete series. Federal transfers, not own-source revenue or GDP.',
    complete: true,
  },
  {
    id: 'crucero_arribos',
    label_es: 'Arribos de crucero 2025',
    label_en: 'Cruise calls 2025',
    unit_es: 'arribos',
    unit_en: 'calls',
    source_es: 'SECTUR DataTur 2025, suma de puertos del municipio',
    source_en: 'SECTUR DataTur 2025, sum of ports in the municipality',
    quality_es: 'Serie completa. Cada municipio suma solo los puertos que le corresponden. No es pasaje aéreo.',
    quality_en: 'Complete series. Each municipality sums only its own ports. Not air passengers.',
    complete: true,
  },
  {
    id: 'crucero_pax',
    label_es: 'Pasajeros de crucero 2025',
    label_en: 'Cruise passengers 2025',
    unit_es: 'pasajeros',
    unit_en: 'passengers',
    source_es: 'SECTUR DataTur 2025, suma de puertos del municipio',
    source_en: 'SECTUR DataTur 2025, sum of ports in the municipality',
    quality_es: 'Serie completa y distinta de los pasajeros de avión. Visita de un día, no pernocta.',
    quality_en: 'Complete series, separate from air passengers. Day visits, not overnight stays.',
    complete: true,
  },
  {
    id: 'ley',
    label_es: 'Ley de Ingresos 2026',
    label_en: 'Revenue law 2026',
    unit_es: 'MXN',
    unit_en: 'MXN',
    source_es: 'Leyes de ingresos municipales 2026 en el portal',
    source_en: '2026 municipal revenue laws in the portal',
    quality_es: 'Serie incompleta: Mulegé y Loreto no tienen cifra. Esos puntos no entran al gráfico.',
    quality_en: 'Incomplete series: Mulegé and Loreto have no figure. Those points stay off the chart.',
    complete: false,
  },
];

const indicatorYear: Record<CdtIndicatorId, string> = {
  pob: '2020',
  sniiv_2025: '2025',
  pobreza_pct: '2020',
  locs: '2020',
  anexo: '2025',
  crucero_arribos: '2025',
  crucero_pax: '2025',
  ley: '2026',
};
const indicatorsDated = indicators.map((i) => ({ ...i, year: indicatorYear[i.id] }));

const themes: Array<{
  id: CdtThemeId;
  es: string;
  en: string;
  hint_es: string;
  hint_en: string;
  diagnostic_es: string;
  diagnostic_en: string;
  gap_es: string;
  gap_en: string;
  layers: string[];
  kpis: CdtKpi[];
}> = [
  {
    id: 'urbano',
    es: 'Diseño urbano',
    en: 'Urban design',
    hint_es: 'Forma del asentamiento',
    hint_en: 'Settlement form',
    diagnostic_es:
      'El Censo 2020 compara los cinco municipios: el corredor Cabos–La Paz concentra población y el norte queda más disperso.',
    diagnostic_en:
      'The 2020 Census compares the five municipalities: the Cabos–La Paz corridor concentrates population and the north stays more spread out.',
    gap_es: 'Fase 2: AGEB, mancha urbana y morfometría. Hoy el color del mapa compara municipios, no manzanas.',
    gap_en: 'Phase 2: AGEB, urban footprint and morphometrics. Today the map color compares municipalities, not blocks.',
    layers: THEME_LAYERS.urbano,
    kpis: [
      {
        value: fmtInt(popSum),
        label_es: 'Habitantes en los cinco municipios',
        label_en: 'People in the five municipalities',
        source_es: 'INEGI Censo 2020',
        source_en: 'INEGI Census 2020',
        href: '/comunidades/',
      },
      {
        value: fmtInt(locSum),
        label_es: 'Localidades',
        label_en: 'Localities',
        source_es: 'INEGI Censo 2020',
        source_en: 'INEGI Census 2020',
        href: '/territorio/',
      },
      {
        value: '5',
        label_es: 'Municipios (unidad de comparación)',
        label_en: 'Municipalities (comparison unit)',
        source_es: 'Límites municipales del mapa',
        source_en: 'Municipal boundaries on the map',
        href: '/mapas/',
      },
      {
        value: dmaLine,
        label_es: 'Disponibilidad de acuíferos en polos, hm³/año',
        label_en: 'Aquifer availability at growth poles, hm³/year',
        source_es: 'CONAGUA DMA 2024',
        source_en: 'CONAGUA DMA 2024',
        href: '/agua/',
      },
    ],
  },
  {
    id: 'economia',
    es: 'Desarrollo económico',
    en: 'Economic development',
    hint_es: 'Ingresos y proyectos',
    hint_en: 'Revenue and projects',
    diagnostic_es: `La Ley de Ingresos 2026 tiene monto para ${leyKnown.map((m) => m.name).join(', ')}; ${leyMissing} siguen sin monto aquí porque el decreto está catalogado y el total no está copiado.`,
    diagnostic_en: `The 2026 revenue law has an amount for ${leyKnown.map((m) => m.name).join(', ')}; ${leyMissing} stay without an amount here because the decree is catalogued and the total is not copied.`,
    gap_es: 'No hay producto interno por municipio ni empleo detallado en este tablero. Las celdas sin número siguen en Crecimiento.',
    gap_en: 'This board has no municipal GDP and no detailed jobs series. Cells without numbers stay on Growth.',
    layers: THEME_LAYERS.economia,
    kpis: [
      {
        value: String(federal.count),
        label_es: 'Proyectos federales en el inventario',
        label_en: 'Federal projects in the inventory',
        source_es: 'Inventario de proyectos federales',
        source_en: 'Federal project inventory',
        href: '/proyectos-federales/',
      },
      {
        value: `${federal.by_sector.energy} energía · ${federal.by_sector.water} agua · ${federal.by_sector.roads} carreteras`,
        label_es: 'Proyectos por sector (recorte)',
        label_en: 'Projects by sector (slice)',
        source_es: 'Inventario de proyectos federales',
        source_en: 'Federal project inventory',
        href: '/proyectos-federales/',
      },
      {
        value: `${gds.metrics.balance_counts.constrained} restringidos · ${gds.metrics.balance_counts.contested} en disputa · ${gds.metrics.balance_counts.headroom} con margen · ${gds.metrics.balance_counts.unknown} sin evidencia`,
        label_es: 'Lectura demanda–oferta por vocación',
        label_en: 'Demand–supply read by vocation',
        source_es: 'Crecimiento: demanda y oferta',
        source_en: 'Growth: demand and supply',
        href: '/crecimiento/',
      },
      {
        value: `${gds.metrics.sibcs_peak_mw} MW`,
        label_es: 'Pico del sistema eléctrico aislado',
        label_en: 'Isolated grid peak',
        source_es: 'Guía de energía del portal',
        source_en: 'Portal energy guide',
        href: '/energia/',
      },
    ],
  },
  {
    id: 'investigacion',
    es: 'Innovación e investigación',
    en: 'Innovation and research',
    hint_es: 'Relaciones, no universidades',
    hint_en: 'Relationships, not universities',
    diagnostic_es: `No hay una red de universidades en el acervo: el mapa de relaciones tiene ${ontology.nodes.length} nodos y ${ontology.edges.length} vínculos, con ${questionsDoc.questions.length} preguntas, ${foresights.signals.length} señales y ${gapsDoc.gaps.length} brechas.`,
    diagnostic_en: `The archive has no university network: the relationship map has ${ontology.nodes.length} nodes and ${ontology.edges.length} links, with ${questionsDoc.questions.length} questions, ${foresights.signals.length} signals and ${gapsDoc.gaps.length} gaps.`,
    gap_es: 'Fase 2: instituciones de investigación, patentes y colaboración, cuando haya una fuente. Hoy el enlace útil es el mapa de relaciones.',
    gap_en: 'Phase 2: research institutions, patents and collaboration, once a source exists. Today the useful link is the relationship map.',
    layers: THEME_LAYERS.investigacion,
    kpis: [
      {
        value: `${ontology.nodes.length} / ${ontology.edges.length}`,
        label_es: 'Nodos / vínculos del mapa de relaciones',
        label_en: 'Relationship-map nodes / links',
        source_es: 'Mapa de relaciones',
        source_en: 'Relationship map',
        href: '/ontologia/',
      },
      {
        value: String(questionsDoc.questions.length),
        label_es: 'Preguntas estratégicas',
        label_en: 'Strategic questions',
        source_es: 'Preguntas del portal',
        source_en: 'Portal questions',
        href: '/preguntas/',
      },
      {
        value: String(foresights.signals.length),
        label_es: `Señales de prospectiva (${foresights.updated})`,
        label_en: `Foresight signals (${foresights.updated})`,
        source_es: 'Prospectiva',
        source_en: 'Foresight',
        href: '/foresights/',
      },
      {
        value: String(gapsDoc.gaps.length),
        label_es: 'Brechas de datos abiertas',
        label_en: 'Open data gaps',
        source_es: 'Lista de brechas del portal',
        source_en: 'Portal gap list',
        href: '/memoria/',
      },
    ],
  },
  {
    id: 'movilidad',
    es: 'Movilidad y logística',
    en: 'Mobility and logistics',
    hint_es: 'Aire, carretera y puerto',
    hint_en: 'Air, road and port',
    diagnostic_es: `En 2025 hay pasajeros aéreos para Los Cabos (${fmtInt(paxByCode.SJD)}) y La Paz (${fmtInt(paxByCode.LAP)}), no para Loreto, y los cruceros de DataTur son otra serie.`,
    diagnostic_en: `2025 air passengers are published for Los Cabos (${fmtInt(paxByCode.SJD)}) and La Paz (${fmtInt(paxByCode.LAP)}), not for Loreto, and DataTur cruises are a different series.`,
    gap_es: 'No hay capa de flujos origen-destino ni logística por AGEB. El mapa usa carreteras, nodos de transporte y anclas de puertos y aeropuertos.',
    gap_en: 'There is no origin-destination flow layer and no AGEB logistics. The map uses highways, transport nodes, and port and airport anchors.',
    layers: THEME_LAYERS.movilidad,
    kpis: [
      {
        value: `${fmtInt(paxByCode.SJD)} · ${fmtInt(paxByCode.LAP)}`,
        label_es: 'Pasajeros 2025 SJD · La Paz',
        label_en: '2025 passengers SJD · La Paz',
        source_es: 'SETUE, información estratégica 2026',
        source_en: 'SETUE strategic brief 2026',
        href: '/puertos/',
      },
      {
        value: `${flights.SJD.destinations} · ${flights.LAP.destinations} · ${flights.LTO.destinations}`,
        label_es: 'Destinos sin escalas SJD · LAP · LTO',
        label_en: 'Non-stop destinations SJD · LAP · LTO',
        source_es: 'FlightConnections, consulta 2026-09-17',
        source_en: 'FlightConnections, retrieved 2026-09-17',
        href: '/vuelos/',
      },
      {
        value: `${fmtInt(cslCalls)} / ${fmtInt(cslPax)}`,
        label_es: 'Cruceros Cabo San Lucas 2025: arribos / pasajeros',
        label_en: 'Cabo San Lucas cruises 2025: calls / passengers',
        source_es: 'SECTUR DataTur 2025',
        source_en: 'SECTUR DataTur 2025',
        href: '/puertos/',
      },
      {
        value: `${federal.by_sector.roads} · ${federal.by_sector.ports} · ${federal.by_sector.airports}`,
        label_es: 'Proyectos federales: carreteras · puertos · aeropuertos',
        label_en: 'Federal projects: roads · ports · airports',
        source_es: 'Inventario de proyectos federales',
        source_en: 'Federal project inventory',
        href: '/proyectos-federales/',
      },
    ],
  },
  {
    id: 'vivienda',
    es: 'Vivienda y nivel de vida',
    en: 'Housing and living standard',
    hint_es: 'Registro, rezago, pobreza',
    hint_en: 'Registry, backlog, poverty',
    diagnostic_es: `El rezago de vivienda CONAVI 2024 es estatal (${inmobiliario.conavi_rezago_2024.bcs_pct_rezago}%); el registro SNIIV 2025 sí se compara por municipio, y ninguna de las dos cifras es un predio.`,
    diagnostic_en: `The CONAVI 2024 housing backlog is statewide (${inmobiliario.conavi_rezago_2024.bcs_pct_rezago}%); the SNIIV 2025 registry is what can be compared by municipality, and neither figure is a parcel.`,
    gap_es: 'No hay catastro de predios ni deseabilidad por lote. El registro SNIIV no es lo mismo que el rezago CONAVI ni que el mercado de alto valor de Los Cabos.',
    gap_en: 'There is no parcel cadastre and no lot desirability score. The SNIIV registry is not the CONAVI backlog and not the Los Cabos high-value market.',
    layers: THEME_LAYERS.vivienda,
    kpis: [
      {
        value: `${inmobiliario.conavi_rezago_2024.bcs_pct_rezago}%`,
        label_es: 'Rezago habitacional estatal',
        label_en: 'Statewide housing backlog',
        source_es: 'CONAVI, rezago 2024',
        source_en: 'CONAVI backlog 2024',
        href: '/inmobiliario/',
      },
      {
        value: fmtInt(inmobiliario.sniiv_vivienda_bcs.registro_vivienda_entidad.find((r) => r.year === 2025)?.units || 0),
        label_es: 'Viviendas registradas en 2025',
        label_en: 'Homes registered in 2025',
        source_es: 'SNIIV / SEDATU',
        source_en: 'SNIIV / SEDATU',
        href: '/inmobiliario/',
      },
      {
        value: `${fmtInt(inmobiliario.jll_2025_bcs.units['2025'])} · US$${fmtInt(inmobiliario.jll_2025_bcs.volume_m_usd['2025'])} M`,
        label_es: 'Mercado residencial BCS 2025: unidades · volumen',
        label_en: 'BCS residential market 2025: units · volume',
        source_es: 'JLL 2025',
        source_en: 'JLL 2025',
        href: '/inmobiliario/',
      },
      {
        value: `${Math.min(...munis.map((m) => m.pobreza_pct))}% – ${Math.max(...munis.map((m) => m.pobreza_pct))}%`,
        label_es: 'Rango de pobreza municipal 2020',
        label_en: 'Municipal poverty range 2020',
        source_es: 'CONEVAL, pobreza municipal 2020',
        source_en: 'CONEVAL, municipal poverty 2020',
        href: '/comunidades/',
      },
    ],
  },
];

const recommendations = places.map((p) => {
  const rule = BALANCE_RULE[p.balance_read];
  if (!rule) throw new Error(`CDT unknown balance ${p.balance_read} on ${p.id}`);
  return {
    id: p.id,
    name_es: p.name_es,
    name_en: p.name_en,
    balance: p.balance_read,
    balance_label_es: { constrained: 'Restringido', contested: 'En disputa', headroom: 'Con margen', unknown: 'Sin evidencia suficiente' }[p.balance_read] || p.balance_read,
    balance_label_en: { constrained: 'Constrained', contested: 'Contested', headroom: 'Has room', unknown: 'Not enough evidence' }[p.balance_read] || p.balance_read,
    rule_es: rule.es,
    rule_en: rule.en,
    because_es: p.balance_read_es,
    because_en: p.balance_read_en,
    themes: THEMES_BY_PLACE[p.id] || ['urbano'],
    scenarios: scenariosForPlace(p.id),
    href: `/crecimiento/#${p.id}`,
  };
});

const researchRecs = [
  {
    id: 'research-graph',
    name_es: 'Mapa de relaciones',
    name_en: 'Relationship map',
    balance: 'unknown',
    balance_label_es: 'Sin red de investigación',
    balance_label_en: 'No research network',
    rule_es: 'No inventar clústeres universitarios. Usar el mapa de relaciones y las preguntas estratégicas como lectura de quién se conecta con qué lugar.',
    rule_en: 'Do not invent university clusters. Use the relationship map and the strategic questions to see who connects to which place.',
    because_es: `El acervo tiene ${ontology.nodes.length} nodos y ${ontology.edges.length} vínculos, y ${questionsDoc.questions.length} preguntas. No hay matriz de colaboración entre escuelas.`,
    because_en: `The archive has ${ontology.nodes.length} nodes and ${ontology.edges.length} links, and ${questionsDoc.questions.length} questions. There is no school collaboration matrix.`,
    themes: ['investigacion'] as CdtThemeId[],
    scenarios: ['baseline', 'corridor_intensify', 'water_first', 'ports_air_hubs'],
    href: '/ontologia/',
  },
  {
    id: 'research-gaps',
    name_es: 'Brechas antes de afinar',
    name_en: 'Gaps before going finer',
    balance: 'unknown',
    balance_label_es: 'Evidencia incompleta',
    balance_label_en: 'Incomplete evidence',
    rule_es: 'Cerrar brechas de evidencia antes de pedir un escenario más fino o una recomendación por predio.',
    rule_en: 'Close evidence gaps before asking for a finer scenario or a parcel recommendation.',
    because_es: `Hay ${gapsDoc.gaps.length} brechas abiertas en la lista del portal. La prospectiva del ${foresights.updated} es lectura, no un plan.`,
    because_en: `The portal lists ${gapsDoc.gaps.length} open gaps. Foresight dated ${foresights.updated} is a reading, not a plan.`,
    themes: ['investigacion'] as CdtThemeId[],
    scenarios: ['baseline', 'corridor_intensify', 'water_first', 'ports_air_hubs'],
    href: '/foresights/',
  },
];

const QUESTION_THEMES: Record<string, CdtThemeId[]> = {
  'sq-cabos-water-energy': ['urbano', 'economia', 'movilidad', 'vivienda'],
  'sq-east-cape-edge': ['urbano', 'vivienda'],
  'sq-la-paz-capital': ['economia', 'investigacion'],
  'sq-loreto-anp': ['urbano', 'vivienda'],
  'sq-comondu-non-offset': ['economia', 'vivienda'],
  'sq-mulege-evidence-desert': ['investigacion', 'economia'],
  'sq-todos-santos-amenity': ['urbano', 'vivienda'],
  'sq-carrying-capacity-metrics': ['urbano', 'investigacion'],
};

const goals = questionsDoc.questions.map((q) => {
  const themesForQ = QUESTION_THEMES[q.id];
  if (!themesForQ) throw new Error(`CDT question missing a theme map: ${q.id}`);
  return {
    id: q.id,
    href: `/preguntas/${q.id}/`,
    places: q.places as string[],
    themes: themesForQ,
    question_es: q.question_es,
    question_en: q.question_en,
  };
});

const placeAims = foresights.places.map((p) => {
  if (!p.open_question_es || !p.open_question_en) throw new Error(`CDT foresight question missing: ${p.id}`);
  return {
    id: p.id,
    href: '/foresights/#places',
    question_es: p.open_question_es,
    question_en: p.open_question_en,
  };
});

const couplings: Record<CdtThemeId, Array<{ to: CdtThemeId; es: string; en: string; href: string }>> = {
  urbano: [
    { to: 'vivienda', es: 'La forma del asentamiento y la vivienda se leen juntas: más presión costera sin agua no es margen urbanizable.', en: 'Settlement form and housing are read together: more coastal pressure without water is not buildable headroom.', href: '/crecimiento/' },
    { to: 'movilidad', es: 'El corredor concentra población donde ya están el aeropuerto y la carretera. Intensificarlo empuja agua y energía.', en: 'The corridor concentrates population where the airport and highway already are. Intensifying it pushes water and energy.', href: '/mapas/?scenario=corridor_intensify#gis' },
    { to: 'economia', es: 'El motor fiscal del sur no compensa el déficit de otro municipio.', en: 'The south’s fiscal engine does not offset another municipality’s deficit.', href: '/fiscal/' },
    { to: 'investigacion', es: 'Sin AGEB ni morfometría, la pregunta útil es la de capacidad de carga, no un índice de forma.', en: 'Without AGEB or morphometrics, the useful question is carrying capacity, not a form index.', href: '/preguntas/sq-carrying-capacity-metrics/' },
  ],
  economia: [
    { to: 'vivienda', es: 'Ingreso municipal y registro de vivienda no miden el mismo mercado. El rezago habitacional sigue siendo estatal.', en: 'Municipal revenue and the housing registry do not measure the same market. The housing backlog stays statewide.', href: '/inmobiliario/' },
    { to: 'movilidad', es: 'La puerta aérea y el crucero son demanda. No son capacidad de agua ni de red.', en: 'The air gateway and the cruise pier are demand. They are not water or grid capacity.', href: '/puertos/' },
    { to: 'urbano', es: 'Un proyecto federal en el municipio depende de la institución que lo reporta y de su estado, no de una fecha inventada.', en: 'A federal project in the municipality depends on the institution that reports it and on its status, not on an invented date.', href: '/proyectos-federales/' },
    { to: 'investigacion', es: 'Donde falta la ley de ingresos, la lectura económica queda incompleta.', en: 'Where the revenue law is missing, the economic reading stays incomplete.', href: '/fiscal/' },
  ],
  investigacion: [
    { to: 'urbano', es: 'El mapa de relaciones conecta lugares y proyectos. No sustituye una red de universidades.', en: 'The relationship map connects places and projects. It does not stand in for a university network.', href: '/ontologia/' },
    { to: 'economia', es: 'Las brechas abiertas frenan un escenario más fino antes de pedir cifras nuevas.', en: 'Open gaps hold back a finer scenario before anyone asks for new figures.', href: '/memoria/' },
    { to: 'vivienda', es: 'La pregunta de Loreto y de East Cape es de techo de conservación, no de un puntaje de lote.', en: 'The Loreto and East Cape question is a conservation ceiling, not a lot score.', href: '/preguntas/sq-loreto-anp/' },
    { to: 'movilidad', es: 'Aprender de otras ciudades es un intercambio de casos, no una cifra de BCS.', en: 'Learning from other cities is a case exchange, not a BCS figure.', href: '/aprendizaje/' },
  ],
  movilidad: [
    { to: 'economia', es: 'Pasajeros de avión y de crucero son series distintas. Sumarlas inventaría una demanda que el portal no publica.', en: 'Air passengers and cruise passengers are different series. Adding them would invent a demand figure the portal does not publish.', href: '/puertos/' },
    { to: 'vivienda', es: 'Más arribos en un municipio con acuífero en déficit no abren vivienda nueva por sí solos.', en: 'More arrivals in a municipality with an aquifer deficit do not by themselves open new housing.', href: '/agua/' },
    { to: 'urbano', es: 'El corredor Cabos–La Paz es el lugar donde carretera, asentamiento y anclas de viaje se tocan.', en: 'The Cabos–La Paz corridor is where the highway, settlement and travel anchors meet.', href: '/mapas/?scenario=corridor_intensify#gis' },
    { to: 'investigacion', es: 'Loreto tiene arribos de crucero publicados y no tiene pasajeros aéreos 2025 en el acervo.', en: 'Loreto has published cruise calls and does not have 2025 air passengers in the archive.', href: '/vuelos/' },
  ],
  vivienda: [
    { to: 'urbano', es: 'El registro SNIIV es municipal. El rezago CONAVI es estatal. No se reparte el rezago entre municipios.', en: 'The SNIIV registry is municipal. The CONAVI backlog is statewide. The backlog is not split across municipalities.', href: '/inmobiliario/' },
    { to: 'economia', es: 'Pobreza y ley de ingresos cuentan cosas distintas. Donde falta la ley, se deja el hueco.', en: 'Poverty and the revenue law count different things. Where the law is missing, the cell stays blank.', href: '/comunidades/' },
    { to: 'movilidad', es: 'La presión de viajes se lee en vuelos y cruceros, no como cuota de viviendas.', en: 'Travel pressure is read in flights and cruises, not as a housing quota.', href: '/crecimiento/' },
    { to: 'investigacion', es: 'Las celdas de 500 m de algunos estudios no son predios y no entran como meta de vivienda.', en: 'The 500 m cells in some studies are not parcels and are not used as a housing target.', href: '/studio/' },
  ],
};

const fedProjects = (federal.projects as ReadonlyArray<{
  id: string;
  proyecto: string;
  dependencia: string;
  sexenio: string;
  estado: string;
  'municipio(s)': string;
}>).map((p) => ({
  id: p.id,
  name: p.proyecto,
  owner: p.dependencia,
  horizon: p.sexenio,
  status: p.estado,
  where: p['municipio(s)'],
  href: '/proyectos-federales/',
}));

const guides = [
  {
    theme: 'vivienda',
    scenario: 'water_first',
    x: 'pob',
    y: 'pobreza_pct',
    es: 'Agua y nivel de vida en el sur',
    en: 'Water and living standard in the south',
  },
  {
    theme: 'movilidad',
    scenario: 'corridor_intensify',
    x: 'pob',
    y: 'crucero_arribos',
    es: 'Corredor y cruceros',
    en: 'Corridor and cruises',
  },
  {
    theme: 'economia',
    scenario: 'baseline',
    x: 'pob',
    y: 'anexo',
    es: 'Población y transferencias',
    en: 'Population and transfers',
  },
  {
    theme: 'urbano',
    scenario: 'baseline',
    x: 'pob',
    y: 'locs',
    es: 'Población y localidades',
    en: 'Population and localities',
  },
] as const;

const questionCounts = (['urbano', 'economia', 'investigacion', 'movilidad', 'vivienda'] as const).map((id) => ({
  id,
  n: goals.filter((g) => g.themes.includes(id)).length,
}));
if (questionCounts.some((c) => c.n < 1)) throw new Error('CDT theme missing strategic questions');

const signalLabel: Record<string, { es: string; en: string }> = {
  tourism: { es: 'turismo', en: 'tourism' },
  water: { es: 'agua', en: 'water' },
  energy: { es: 'energía', en: 'energy' },
  environment: { es: 'ambiente', en: 'environment' },
  land_use: { es: 'suelo', en: 'land use' },
  planning: { es: 'planeación', en: 'planning' },
};
const signalCounts: Record<string, number> = {};
for (const s of foresights.signals) {
  if (!signalLabel[s.theme]) throw new Error(`CDT foresight theme unmapped: ${s.theme}`);
  signalCounts[s.theme] = (signalCounts[s.theme] || 0) + 1;
}
const foresightThemes = Object.entries(signalCounts).map(([id, n]) => ({
  id,
  n,
  es: signalLabel[id].es,
  en: signalLabel[id].en,
}));

export const cdtModel = {
  themes,
  indicators: indicatorsDated,
  questionCounts,
  foresightThemes,
  munis,
  layerCatalog,
  recommendations: [...recommendations, ...researchRecs],
  goals,
  placeAims,
  couplings,
  fedProjects,
  guides,
  pedagogy_es:
    'Esto es el tablero para mirar el territorio con calma. Elige un tema, luego un escenario, compara municipios y lee las recomendaciones. Complementa la consulta ciudadana de Inicio: aquí las cifras ya publicadas se ponen juntas. No calcula predios.',
  pedagogy_en:
    'This is the board for looking at the territory carefully. Pick a theme, then a scenario, compare municipalities and read the recommendations. It complements the citizen consultation on Home: figures already published are placed side by side. It does not score parcels.',
  integrated_es:
    'Solución integrada: el tema activo no se decide solo. Estas cuatro lecturas vienen de la demanda y oferta, de las preguntas y de los proyectos ya publicados. Es apoyo a la decisión, no una simulación calibrada.',
  integrated_en:
    'Integrated solution: the active theme is not decided on its own. These four readings come from demand and supply, from the questions and from projects already published. This is decision support, not a calibrated simulation.',
  compareSkip_es:
    'No entran a esta comparación: pasajeros aéreos 2025 (falta Loreto), rezago de vivienda CONAVI (solo estatal), pico eléctrico (un solo sistema) y déficit de acuíferos (va por acuífero, no por municipio).',
  compareSkip_en:
    'Left out of this comparison: 2025 air passengers (Loreto is missing), CONAVI housing backlog (statewide only), the power peak (one grid) and aquifer deficit (reported per aquifer, not per municipality).',
  regional_es:
    'Estas cifras son de Baja California Sur. No están alineadas a una serie regional. Para ver otras ciudades de América Latina, la referencia abierta es la Plataforma Urbana y de Ciudades de CEPAL. Este portal no copia números de esa plataforma.',
  regional_en:
    'These figures are for Baja California Sur. They are not aligned to a regional series. To see other Latin American cities, the open reference is ECLAC’s Urban and Cities Platform. This portal does not copy numbers from that platform.',
  stateRules: gds.state_rollup.must_be_true_es.map((es, i) => ({
    es,
    en: gds.state_rollup.must_be_true_en[i] || es,
  })),
  scenarios: scenariosDoc.scenarios.map((sc) => ({
    id: sc.id,
    title_es: sc.title_es,
    title_en: sc.title_en,
    blurb_es: sc.blurb_es,
    blurb_en: sc.blurb_en,
    priority_layer_ids: sc.priority_layer_ids,
    focus_bbox: sc.focus_bbox,
    questions_es: sc.decision_questions_es,
    questions_en: sc.decision_questions_en,
  })),
  disclaimer_es:
    'Apoyo a la decisión con reglas del portal (demanda y oferta de crecimiento, más el escenario elegido). No es un modelo de predios, ni una puntuación de deseabilidad por parcela, ni un plan oficial.',
  disclaimer_en:
    'Decision support from portal rules (growth demand and supply, plus the scenario you pick). It is not a parcel model, not a lot desirability score, and not an official plan.',
  notMunicipal_es:
    'East Cape está leído dentro de Los Cabos y Todos Santos–El Pescadero dentro de La Paz. La comparación pinta municipios completos: no hay capa AGEB para separarlos.',
  notMunicipal_en:
    'East Cape is read inside Los Cabos, and Todos Santos–El Pescadero inside La Paz. The comparison colors whole municipalities: there is no AGEB layer to split them.',
};

export type CdtModel = typeof cdtModel;
