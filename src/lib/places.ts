/** Shared BCS 2050 place-vocation spine (7 places). IDs match foresights.json + growth_demand_supply.json. */
export type PlaceId =
  | 'los_cabos'
  | 'east_cape'
  | 'todos_santos'
  | 'la_paz'
  | 'loreto'
  | 'comondu'
  | 'mulege_north';

export type PlaceDef = {
  id: PlaceId;
  short_es: string;
  short_en: string;
  name_es: string;
  name_en: string;
};

export const PLACE_IDS: PlaceId[] = [
  'los_cabos',
  'east_cape',
  'todos_santos',
  'la_paz',
  'loreto',
  'comondu',
  'mulege_north',
];

export const PLACES: PlaceDef[] = [
  {
    id: 'los_cabos',
    short_es: 'Los Cabos',
    short_en: 'Los Cabos',
    name_es: 'Los Cabos / San José–Cabo San Lucas',
    name_en: 'Los Cabos / San José–Cabo San Lucas',
  },
  {
    id: 'east_cape',
    short_es: 'Cabo Este',
    short_en: 'East Cape',
    name_es: 'East Cape / Cabo del Este',
    name_en: 'East Cape / Cabo del Este',
  },
  {
    id: 'todos_santos',
    short_es: 'Todos Santos',
    short_en: 'Todos Santos',
    name_es: 'Todos Santos–El Pescadero',
    name_en: 'Todos Santos–El Pescadero',
  },
  {
    id: 'la_paz',
    short_es: 'La Paz',
    short_en: 'La Paz',
    name_es: 'La Paz',
    name_en: 'La Paz',
  },
  {
    id: 'loreto',
    short_es: 'Loreto',
    short_en: 'Loreto',
    name_es: 'Loreto',
    name_en: 'Loreto',
  },
  {
    id: 'comondu',
    short_es: 'Comondú',
    short_en: 'Comondú',
    name_es: 'Ciudad Constitución / Comondú',
    name_en: 'Ciudad Constitución / Comondú',
  },
  {
    id: 'mulege_north',
    short_es: 'Mulegé N.',
    short_en: 'Mulegé N.',
    name_es: 'Mulegé / Santa Rosalía / Vizcaíno',
    name_en: 'Mulegé / Santa Rosalía / Vizcaíno',
  },
];

export const PLACE_BY_ID: Record<string, PlaceDef> = Object.fromEntries(
  PLACES.map((p) => [p.id, p])
);

export function isPlaceId(id: string | null | undefined): id is PlaceId {
  return !!id && PLACE_IDS.includes(id as PlaceId);
}


/** PlaceStrip primary chips: BCS + 5 municipios (maps to place ids for filters). */
export type MuniChipId = 'los_cabos' | 'la_paz' | 'loreto' | 'comondu' | 'mulege_north';

export const MUNI_CHIPS: { id: MuniChipId; short_es: string; short_en: string; name_es: string; name_en: string; placeIds: string[] }[] = [
  { id: 'los_cabos', short_es: 'Los Cabos', short_en: 'Los Cabos', name_es: 'Municipio Los Cabos', name_en: 'Los Cabos municipality', placeIds: ['los_cabos', 'east_cape'] },
  { id: 'la_paz', short_es: 'La Paz', short_en: 'La Paz', name_es: 'Municipio La Paz', name_en: 'La Paz municipality', placeIds: ['la_paz', 'todos_santos'] },
  { id: 'loreto', short_es: 'Loreto', short_en: 'Loreto', name_es: 'Municipio Loreto', name_en: 'Loreto municipality', placeIds: ['loreto'] },
  { id: 'comondu', short_es: 'Comondú', short_en: 'Comondú', name_es: 'Municipio Comondú', name_en: 'Comondú municipality', placeIds: ['comondu'] },
  { id: 'mulege_north', short_es: 'Mulegé', short_en: 'Mulegé', name_es: 'Municipio Mulegé', name_en: 'Mulegé municipality', placeIds: ['mulege_north'] },
];
