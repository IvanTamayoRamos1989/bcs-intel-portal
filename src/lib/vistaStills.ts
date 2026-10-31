/**
 * One territory photo per saved view, taken from public/stills/stills.geojson.
 * The file is gitignored. When it is missing or empty, every card stays text-only.
 * Captions are the feature's own name. Paths must already point under /stills/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import scenariosDoc from '../data/scenarios.json';

export type VistaStill = {
  id: string;
  name: string;
  thumb: string;
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

export function vistaStills(): Record<string, VistaStill | null> {
  const stills = loadStills();
  const rings = eastCapeRings();
  const out: Record<string, VistaStill | null> = {};
  for (const id of Object.keys(PREFER)) out[id] = stills.length ? pick(id, stills, rings, MUNI_FOR[id] || '') : null;
  return out;
}
