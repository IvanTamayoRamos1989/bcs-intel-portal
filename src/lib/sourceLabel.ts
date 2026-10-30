/**
 * Plain source labels for anything shown to users (2026-10-08). Mirror of scripts/source_labels.py.
 * Internal lake/repo paths (BCSFP/…, 11_bcs_hub, src/data/…) and *.json file names are never displayed:
 *  - files named `YYYY[-MM[-DD]]_<Institución>_<Título>.ext` → "Institución — Título (año)" (the name's own info);
 *  - documented portal data files → their real underlying source (e.g. municipios.json → INEGI Censo 2020);
 *  - anything else → "Base de datos BCS 2050 — <tema>". Nothing is invented.
 * Enforced by scripts/check_visible_paths.mjs during `npm run build`.
 */
export const GENERIC = 'Base de datos BCS 2050';

const FOLDER_THEME: Record<string, string> = {
  '00_catalog': 'catálogo', '01_planning': 'planeación', '02_water': 'agua', '03_energy': 'energía',
  '04_mobility_waste': 'movilidad y residuos', '05_demographics': 'población', '06_environment': 'ambiente',
  '07_economy_investment': 'economía e inversión', '09_shadow_programme': 'estudios temáticos',
  '10_data_lake': 'acervo de datos', '11_bcs_hub': 'portal', '12_ontology': 'ontología',
  '13_federal_projects': 'proyectos federales', '13_library': 'biblioteca',
  '13_territorial_intelligence': 'inteligencia territorial', '14_gis_atlas': 'atlas SIG', '14_gobierno': 'gobierno',
  '15_decision_platform': 'estrategia', '16_escorrentia': 'escorrentía', '17_insumos_capacidad': 'insumos de capacidad',
};
const SUB_THEME: Record<string, string> = {
  ports_demand: 'puertos y demanda', plans: 'planes', plans_archive: 'archivo de planes', fiscal: 'finanzas públicas',
  hazards: 'riesgos', histories: 'historia', land_tenure: 'tenencia de la tierra', ssn_cenapred: 'sismicidad',
  atlas_riesgos_bcs: 'riesgos', poerbcs_shapes: 'ordenamiento ecológico (POERBCS)', maps: 'mapas',
  guide_assets: 'mapas', catastro_implan: 'catastro', maps_catalog: 'catálogo de mapas', connectivity: 'conectividad aérea',
  communities: 'comunidades', gis: 'capa SIG', stills: 'imágenes del territorio', tourism_assets: 'turismo', data: 'acervo de datos',
};
const ORG_FIX: Record<string, string> = {
  'Gobierno-BCS': 'Gobierno de BCS', 'Finanzas-BCS': 'Finanzas BCS', 'Congreso-BCS': 'Congreso de BCS',
  'BOGE-BCS': 'Boletín Oficial BCS', 'SECTUR-DataTur': 'SECTUR DataTur', 'SETUE-BCS': 'SETUE BCS',
  'Gobierno-BCS-UABCS': 'Gobierno de BCS y UABCS',
};
export const JSON_LABEL: Record<string, string> = {
  'municipios.json': `${GENERIC} — municipios`,
  'aquifers_bcs.json': 'CONAGUA — disponibilidad media anual de acuíferos (DOF 2023)',
  'escorrentia.json': 'Modelo de terreno HydroSHEDS / HydroRIVERS',
  'flight_connections_bcs.json': 'FlightConnections.com — rutas sin escalas (consultado 2026-09-17)',
  'ports_demand.json': `${GENERIC} — puertos y demanda`,
  'stills_points.json': `${GENERIC} — imágenes del territorio`,
  'growth_demand_supply.json': `${GENERIC} — demanda y oferta de crecimiento`,
  'tourism_detail.json': `${GENERIC} — turismo`,
  'data_gaps.json': `${GENERIC} — brechas de datos`,
  'stills_intelligence.json': `${GENERIC} — análisis de imágenes del territorio`,
  'news.json': `${GENERIC} — noticias`,
  'foresights.json': `${GENERIC} — prospectiva`,
  'catalog.json': `${GENERIC} — catálogo de documentos`,
  'portals.json': `${GENERIC} — catastro`,
  'graph.json': `${GENERIC} — ontología`,
  'ontology_graph.json': `${GENERIC} — ontología`,
  'portal_facts.json': `${GENERIC} — cifras del portal`,
  'osm_municipalities.geojson': 'OpenStreetMap — límites municipales',
};

export function labelForJson(name: string): string {
  return JSON_LABEL[name] || (name.endsWith('.geojson') ? `${GENERIC} — capa SIG` : `${GENERIC} — datos del portal`);
}

function themeOf(parts: string[]): string {
  let t = '';
  for (const p of parts) {
    if (FOLDER_THEME[p] && !t) t = FOLDER_THEME[p];
    if (SUB_THEME[p]) t = SUB_THEME[p];
  }
  return t || 'acervo de datos';
}

export function labelForFile(name: string): string | null {
  const stem = name.replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const m = stem.match(/^(\d{4})(-\d{4}|-\d{2}(?:-\d{2})?)?_([^_]+)_(.+)$/);
  if (!m) return null;
  const [, y0, rng, org0, title0] = m;
  const year = rng && rng.length === 5 ? `${y0}–${rng.slice(1)}` : y0;
  const unverified = /UNVERIFIED/.test(title0);
  const title = title0.replace(/[-_]?image-only[-_]?UNVERIFIED/, '').replace(/[-_ .…]*(?:\.\.\.|…|\.\.)[-_ .…]*$/, '')
    .replace(/[-_]+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').trim();
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]{2}/.test(title)) return null;
  const org = ORG_FIX[org0] || org0.replace(/-/g, ' ');
  return `${org} — ${title} (${year})${unverified ? ' — sin verificar' : ''}`;
}

export function labelForPath(path: string): string {
  const p = String(path || '').trim().replace(/^`|`$/g, '').replace(/#.*$/, '').replace(/\\\\/g, '\\');
  let parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length && ['BCSFP', 'src', 'public'].includes(parts[0])) parts = parts.slice(1);
  const last = parts[parts.length - 1] || '';
  const name = last.includes('.') && !/[\\/]$/.test(p) ? last : '';
  if (name && JSON_LABEL[name]) return JSON_LABEL[name];
  if (name && !name.includes('*')) {
    const lab = labelForFile(name);
    if (lab) return lab;
    if (/\.(geo)?json$/.test(name)) return labelForJson(name);
  }
  if (parts.includes('guide_assets') || /\.(jpe?g|png|webp)$/i.test(name)) return `${GENERIC} — galería de mapas`;
  return `${GENERIC} — ${themeOf(name ? parts.slice(0, -1) : parts)}`;
}

export const FILE_LABEL: Record<string, string> = {
  'communities_master.csv': `${GENERIC} — comunidades`,
  'top_localities_by_municipio.csv': `${GENERIC} — localidades principales por municipio`,
  'settlement_hierarchy.md': `${GENERIC} — jerarquía de asentamientos`,
  'fiscal_municipal.md': `${GENERIC} — finanzas municipales`,
  'strengths_opportunities.md': `${GENERIC} — fortalezas y oportunidades`,
  'plans_master.csv': `${GENERIC} — archivo de planes`,
  'plans_by_community.md': `${GENERIC} — planes por comunidad`,
  'plans_timeline.md': `${GENERIC} — cronología de planes`,
};
const DOC_RE = /(?<![\w/.-])`?(_?[\w-]+\.(md|csv|xlsx))`?(?![\w/])/g;

/** Readable document title from its own file name (institution — title (year), else humanized name). */
export function docTitle(name: string): string {
  const n = String(name || '').split(/[\\/]/).pop() || '';
  if (FILE_LABEL[n]) return FILE_LABEL[n];
  const lab = labelForFile(n);
  if (lab) return lab;
  const stem = n.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/^_+/, '');
  if (stem === 'README') return 'Nota de la carpeta';
  const t = stem.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const PATH_RE = /(?:BCSFP[\\/]|11_bcs_hub[\\/]|src\/data\/|public\/(?=[\w*])|(?<![\w/.-])\d{2}_[a-z][a-z_]+[\\/])[^\s`|<>"')\]]*(?: (?!BCSFP|11_bcs_hub|src\/|public\/)[A-Z][^\s`|<>"')\]\\/]*[\\/][^\s`|<>"')\]]*)*/g;
const JSON_RE = /(?<![\w.-])\/?([\w-]+\.(?:json|geojson))\b/g;

/** Replace internal paths and *.json names inside any display string by plain source labels. */
export function cleanSourceText(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(PATH_RE, (m) => labelForPath(m))
    .replace(JSON_RE, (_m, n) => labelForJson(n))
    .replace(DOC_RE, (_m, n, ext) => FILE_LABEL[n] || `${GENERIC} — ${ext === 'md' ? 'nota de trabajo' : 'tabla de datos'}`)
    .replace(/^[\s\S]*$/, tidy);
}

/** Drop repeated ' · ' segments and the generic municipios label when INEGI is already cited. */
function tidy(s: string): string {
  s = s.replace(/`(Base de datos BCS 2050 — [^`]+)`/g, '$1');
  if (!s.includes(' · ')) return s;
  let out: string[] = [];
  for (const g of s.split(' · ')) if (!(g.trim() && out.some((o) => o.trim() === g.trim()))) out.push(g);
  if (out.some((g) => g.includes('INEGI'))) {
    const f = out.filter((g) => g.trim() !== `${GENERIC} — municipios`);
    if (f.length) out = f;
  }
  return out.join(' · ');
}
