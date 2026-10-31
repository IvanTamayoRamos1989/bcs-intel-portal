/**
 * Named views for guests. Every URL uses scenario and layer ids the map already loads.
 * `layers=` replaces a scenario’s priority layers. The scenario still supplies the frame.
 */
import scenariosDoc from '../data/scenarios.json';
import layersDoc from '../../public/gis/layers.json';

type GisLayer = { id: string; name_es: string; name_en: string };
type Scenario = {
  id: string;
  title_es: string;
  title_en: string;
  priority_layer_ids: string[];
  focus_bbox: number[];
};

const layerById = new Map((layersDoc as GisLayer[]).map((l) => [l.id, l]));
const scenarioById = new Map((scenariosDoc.scenarios as Scenario[]).map((s) => [s.id, s]));

function listEs(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function listEn(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function mapQuery(href: string): { scenario: string | null; layers: string[] } {
  const q = href.split('#')[0].split('?')[1] || '';
  const params = new URLSearchParams(q);
  const scenario = params.get('scenario');
  const layers = (params.get('layers') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { scenario, layers };
}

function previewFor(mapas: string): { preview_es: string; preview_en: string } {
  const { scenario, layers } = mapQuery(mapas);
  let sc: Scenario | undefined;
  if (scenario) {
    sc = scenarioById.get(scenario);
    if (!sc) throw new Error(`Vista scenario is not a /mapas scenario: ${scenario} (${mapas})`);
    if (!Array.isArray(sc.priority_layer_ids) || sc.focus_bbox?.length !== 4) {
      throw new Error(`Vista scenario has no layers or frame: ${scenario}`);
    }
  }
  const ids = layers.length ? layers : sc?.priority_layer_ids || [];
  if (!ids.length) throw new Error(`Vista map link turns nothing on: ${mapas}`);
  for (const id of ids) {
    if (!layerById.has(id)) throw new Error(`Vista map layer missing from GIS catalog: ${id} (${mapas})`);
  }
  const es = ids.map((id) => layerById.get(id)!.name_es);
  const en = ids.map((id) => layerById.get(id)!.name_en);
  if (sc && layers.length) {
    return {
      preview_es: `Encuadre de «${sc.title_es}». Capas que se encienden, en lugar de las del escenario: ${listEs(es)}.`,
      preview_en: `Frame of “${sc.title_en}”. Layers turned on, in place of the scenario layers: ${listEn(en)}.`,
    };
  }
  if (sc) {
    return {
      preview_es: `Escenario «${sc.title_es}»: ${listEs(es)}. Encuadre de ese escenario.`,
      preview_en: `Scenario “${sc.title_en}”: ${listEn(en)}. Frame of that scenario.`,
    };
  }
  return {
    preview_es: `Sin escenario: ${listEs(es)}. Encuadre de todo el estado.`,
    preview_en: `No scenario: ${listEn(en)}. Statewide frame.`,
  };
}

const VISTA_LINKS = [
  {
    id: 'agua-sur',
    es: 'Agua primero en el sur',
    en: 'Water first in the south',
    plain_es: 'Verá el sur del estado: la franja entre Cabos y La Paz, el East Cape y marcas de acuíferos que ya están en déficit.',
    plain_en: 'You will see the south of the state: the belt between Cabos and La Paz, East Cape, and marks for aquifers already in deficit.',
    note_es:
      'Escenario «agua primero»: corredor, East Cape y marcadores de acuíferos en déficit. La comparación del gemelo usa población y pobreza, no un balance municipal de agua.',
    note_en:
      '“Water first” scenario: corridor, East Cape and deficit-aquifer markers. The twin comparison uses population and poverty, not a municipal water balance.',
    gemelo: '/gemelo/?theme=vivienda&scenario=water_first&x=pob&y=pobreza_pct',
    mapas: '/mapas?scenario=water_first#gis',
  },
  {
    id: 'corredor',
    es: 'Crecimiento Cabos–La Paz',
    en: 'Cabos–La Paz growth',
    plain_es: 'Verá la carretera y los pueblos entre Los Cabos y La Paz, más la línea eléctrica y el ordenamiento del suelo.',
    plain_en: 'You will see the highway and the towns between Los Cabos and La Paz, plus the power line and the land-use zoning.',
    note_es:
      'Escenario del corredor: carretera, asentamientos, transmisión y unidades de ordenamiento. East Cape queda dentro de Los Cabos.',
    note_en:
      'Corridor scenario: highway, settlements, transmission and zoning units. East Cape stays inside Los Cabos.',
    gemelo: '/gemelo/?theme=movilidad&scenario=corridor_intensify&x=pob&y=crucero_arribos',
    mapas: '/mapas?scenario=corridor_intensify#gis',
  },
  {
    id: 'puertos',
    es: 'Puertos y aeropuertos',
    en: 'Ports and airports',
    plain_es: 'Verá aeropuertos y puertos, de Los Cabos hasta Loreto y Ciudad Constitución.',
    plain_en: 'You will see airports and ports, from Los Cabos up to Loreto and Ciudad Constitución.',
    note_es:
      'Anclas SJD, La Paz, Loreto y puertos, más Loreto y Ciudad Constitución. Los pasajeros de crucero del gráfico son la suma DataTur por municipio.',
    note_en:
      'SJD, La Paz and Loreto anchors plus ports, and Loreto and Ciudad Constitución. Cruise passengers on the chart are the DataTur sum by municipality.',
    gemelo: '/gemelo/?theme=movilidad&scenario=ports_air_hubs&x=pob&y=crucero_pax',
    mapas: '/mapas?scenario=ports_air_hubs#gis',
  },
  {
    id: 'vivienda',
    es: 'Contexto de vivienda',
    en: 'Housing context',
    plain_es: 'Verá pueblos, el ordenamiento del suelo y marcas de acuíferos en déficit, sobre el estado entero.',
    plain_en: 'You will see towns, land-use zoning and marks for aquifers in deficit, across the whole state.',
    note_es:
      'Asentamientos, ordenamiento y marcadores de acuíferos en déficit. El rezago CONAVI es estatal: esta vista no lo reparte por municipio.',
    note_en:
      'Settlements, zoning and deficit-aquifer markers. The CONAVI backlog is statewide: this view does not split it by municipality.',
    gemelo: '/gemelo/?theme=vivienda&scenario=baseline&x=sniiv_2025&y=pobreza_pct',
    mapas: '/mapas?layers=settlements,poer_ugas,focus_water_dmas#gis',
  },
  {
    id: 'east-cape',
    es: 'East Cape y áreas protegidas',
    en: 'East Cape and protected areas',
    plain_es: 'Verá la franja del East Cape, dentro de Los Cabos, y las áreas naturales protegidas de esa costa.',
    plain_en: 'You will see the East Cape belt, inside Los Cabos, and the protected areas on that coast.',
    note_es: 'Franja de foco East Cape más áreas naturales protegidas. No es una capa de predios.',
    note_en: 'East Cape focus belt plus protected areas. It is not a parcel layer.',
    gemelo: '/gemelo/?theme=urbano&scenario=baseline&x=pob&y=locs&muni=Los%20Cabos',
    mapas: '/mapas?scenario=baseline&layers=focus_east_cape,anp_federales#gis',
  },
] as const;

export const vistas = VISTA_LINKS.map((v) => ({
  ...v,
  ...previewFor(v.mapas),
}));
