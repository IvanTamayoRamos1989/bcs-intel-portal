/**
 * One territory photo per saved view, taken from public/stills/stills.geojson.
 * The file is gitignored. When it is missing or empty, every card stays text-only.
 * Captions are the feature's own name. Paths must already point under /stills/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import scenariosDoc from '../data/scenarios.json';
import stillsCatalog from '../data/stills.json';

export type VistaStill = {
  id: string;
  name: string;
  thumb: string;
};

export type FicheStill = {
  id: string;
  name: string;
  thumb: string;
  category: string;
  vista: string;
};

type Still = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  municipio: string;
  thumb: string;
};

type Bbox = [number, number, number, number];

const STATE_FRAME: Bbox = [-115.2, 22.8, -109.3, 28.0];

const PREFER: Record<string, string[]> = {
  'agua-sur': ['cabecera', 'localidad', 'puerto'],
  corredor: ['carretera', 'cabecera', 'localidad'],
  puertos: ['puerto', 'cabecera'],
  vivienda: ['cabecera', 'localidad'],
  'east-cape': ['localidad', 'anp', 'cabecera'],
};

const SCENARIO_FOR: Record<string, string> = {
  'agua-sur': 'water_first',
  corredor: 'corridor_intensify',
  puertos: 'ports_air_hubs',
};

function safeThumb(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/stills/') || value.includes('..') || value.includes('\\')) return null;
  return value;
}

function inBox(lon: number, lat: number, box: Bbox): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const dy = yj - yi;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (dy || 1e-15) + xi) inside = !inside;
  }
  return inside;
}

function eastCapeRings(): number[][][] {
  const file = join(process.cwd(), 'public/gis/focus_east_cape.geojson');
  if (!existsSync(file)) return [];
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      features?: Array<{ geometry?: { type?: string; coordinates?: number[][][] } }>;
    };
    const rings: number[][][] = [];
    for (const feature of doc.features || []) {
      const geometry = feature.geometry;
      if (geometry?.type !== 'Polygon' || !geometry.coordinates?.[0]) continue;
      rings.push(geometry.coordinates[0]);
    }
    return rings;
  } catch {
    return [];
  }
}

function loadStills(): Still[] {
  const file = join(process.cwd(), 'public/stills/stills.geojson');
  if (!existsSync(file)) return [];
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { features?: Array<{ properties?: Record<string, unknown> }> };
    const out: Still[] = [];
    for (const feature of doc.features || []) {
      const p = feature.properties || {};
      const thumb = safeThumb(p.thumb);
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      if (!thumb || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (p.category === 'grid') continue;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const id = typeof p.id === 'string' ? p.id : '';
      if (!name || !id) continue;
      out.push({
        id,
        name,
        lat,
        lon,
        category: typeof p.category === 'string' ? p.category : '',
        municipio: typeof p.municipio === 'string' ? p.municipio : '',
        thumb,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function frameFor(vistaId: string): Bbox | null {
  if (vistaId === 'vivienda') return STATE_FRAME;
  const scenarioId = SCENARIO_FOR[vistaId];
  if (!scenarioId) return null;
  const scenario = scenariosDoc.scenarios.find((item) => item.id === scenarioId);
  const box = scenario?.focus_bbox;
  if (!box || box.length !== 4) return null;
  return [box[0], box[1], box[2], box[3]];
}

function pick(vistaId: string, stills: Still[], rings: number[][][], muni: string): VistaStill | null {
  const prefs = PREFER[vistaId];
  if (!prefs) return null;
  const box = frameFor(vistaId);
  const pool = stills.filter((still) => {
    if (!prefs.includes(still.category)) return false;
    if (vistaId === 'east-cape') return rings.some((ring) => inRing(still.lon, still.lat, ring));
    return box ? inBox(still.lon, still.lat, box) : false;
  });
  if (!pool.length) return null;
  const narrowed = muni && pool.some((still) => still.municipio === muni) ? pool.filter((still) => still.municipio === muni) : pool;
  narrowed.sort((a, b) => prefs.indexOf(a.category) - prefs.indexOf(b.category) || a.id.localeCompare(b.id));
  const best = narrowed[0];
  return { id: best.id, name: best.name, thumb: best.thumb };
}

const MUNI_FOR: Record<string, string> = {
  'east-cape': 'Los Cabos',
};

/** Same saved view the twin already attaches to each municipality. */
const VISTA_FOR_MUNI: Record<string, string> = {
  'Los Cabos': 'corredor',
  'La Paz': 'corredor',
  Comondú: 'vivienda',
  Mulegé: 'puertos',
  Loreto: 'puertos',
};

function loadCatalog(): Still[] {
  const rows = stillsCatalog as Array<Record<string, unknown>>;
  const out: Still[] = [];
  for (const p of rows) {
    const thumb = safeThumb(p.thumb);
    const lon = Number(p.lon);
    const lat = Number(p.lat);
    if (!thumb || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (p.category === 'grid') continue;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const id = typeof p.id === 'string' ? p.id : '';
    if (!name || !id) continue;
    out.push({
      id,
      name,
      lat,
      lon,
      category: typeof p.category === 'string' ? p.category : '',
      municipio: typeof p.municipio === 'string' ? p.municipio : '',
      thumb,
    });
  }
  return out;
}

export function vistaStills(): Record<string, VistaStill | null> {
  const stills = loadStills();
  const rings = eastCapeRings();
  const out: Record<string, VistaStill | null> = {};
  for (const id of Object.keys(PREFER)) out[id] = stills.length ? pick(id, stills, rings, MUNI_FOR[id] || '') : null;
  return out;
}

/** Up to three frames already catalogued for that municipality’s saved view. Empty when none match. */
export function ficheStills(): Record<string, FicheStill[]> {
  const fromDisk = loadStills();
  const stills = fromDisk.length ? fromDisk : loadCatalog();
  const out: Record<string, FicheStill[]> = {};
  for (const [muni, vistaId] of Object.entries(VISTA_FOR_MUNI)) {
    const prefs = PREFER[vistaId] || [];
    const pool = stills.filter((still) => still.municipio === muni && prefs.includes(still.category));
    pool.sort((a, b) => prefs.indexOf(a.category) - prefs.indexOf(b.category) || a.id.localeCompare(b.id));
    out[muni] = pool.slice(0, 3).map((still) => ({
      id: still.id,
      name: still.name,
      thumb: still.thumb,
      category: still.category,
      vista: vistaId,
    }));
  }
  return out;
}
