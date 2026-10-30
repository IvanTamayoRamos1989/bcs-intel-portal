/** Studio units = BCS statewide + 5 municipalities. Maps to vocation place ids. */
export type StudioId = 'bcs' | 'los_cabos' | 'la_paz' | 'loreto' | 'comondu' | 'mulege';

export type StudioUnit = {
  id: StudioId;
  short_es: string;
  short_en: string;
  name_es: string;
  name_en: string;
  blurb_es: string;
  blurb_en: string;
  /** Nested vocation place ids (foresights / GDS / dossiers) */
  placeIds: string[];
  /** Primary place id for ?place= deep links / session (empty for bcs) */
  primaryPlace: string;
};

export const STUDIO_IDS: StudioId[] = [
  'bcs',
  'los_cabos',
  'la_paz',
  'loreto',
  'comondu',
  'mulege',
];

export const STUDIO_UNITS: StudioUnit[] = [
  {
    id: 'bcs',
    short_es: 'BCS',
    short_en: 'BCS',
    name_es: 'Baja California Sur (estado)',
    name_en: 'Baja California Sur (statewide)',
    blurb_es: 'Síntesis estatal: vocaciones que se complementan, no un solo centro.',
    blurb_en: 'Statewide synthesis: complementary roles, not a single centre.',
    placeIds: [
      'los_cabos',
      'east_cape',
      'todos_santos',
      'la_paz',
      'loreto',
      'comondu',
      'mulege_north',
    ],
    primaryPlace: '',
  },
  {
    id: 'los_cabos',
    short_es: 'Los Cabos',
    short_en: 'Los Cabos',
    name_es: 'Municipio Los Cabos',
    name_en: 'Los Cabos municipality',
    blurb_es: 'Corredor turístico y aéreo; Cabo Este como zona de transición.',
    blurb_en: 'Tourism and air corridor; East Cape as a transition area.',
    placeIds: ['los_cabos', 'east_cape'],
    primaryPlace: 'los_cabos',
  },
  {
    id: 'la_paz',
    short_es: 'La Paz',
    short_en: 'La Paz',
    name_es: 'Municipio La Paz',
    name_en: 'La Paz municipality',
    blurb_es: 'Capital de servicios + amenidad Todos Santos–Pescadero.',
    blurb_en: 'Services capital + Todos Santos–Pescadero amenity.',
    placeIds: ['la_paz', 'todos_santos'],
    primaryPlace: 'la_paz',
  },
  {
    id: 'loreto',
    short_es: 'Loreto',
    short_en: 'Loreto',
    name_es: 'Municipio Loreto',
    name_en: 'Loreto municipality',
    blurb_es: 'Crecimiento sensible junto a áreas naturales protegidas y ordenamientos locales.',
    blurb_en: 'Sensitive growth next to protected natural areas and local land-use plans.',
    placeIds: ['loreto'],
    primaryPlace: 'loreto',
  },
  {
    id: 'comondu',
    short_es: 'Comondú',
    short_en: 'Comondú',
    name_es: 'Municipio Comondú',
    name_en: 'Comondú municipality',
    blurb_es: 'Mayor margen agropecuario; no sustituye la presión del sur del estado.',
    blurb_en: 'More agricultural headroom; it does not replace pressure in the south of the state.',
    placeIds: ['comondu'],
    primaryPlace: 'comondu',
  },
  {
    id: 'mulege',
    short_es: 'Mulegé',
    short_en: 'Mulegé',
    name_es: 'Municipio Mulegé',
    name_en: 'Mulegé municipality',
    blurb_es: 'Norte y Vizcaíno: poca evidencia pública consolidada; conviene no extrapolar al estado.',
    blurb_en: 'North and Vizcaíno: limited consolidated public evidence; avoid statewide extrapolation.',
    placeIds: ['mulege_north'],
    primaryPlace: 'mulege_north',
  },
];

export const STUDIO_BY_ID: Record<string, StudioUnit> = Object.fromEntries(
  STUDIO_UNITS.map((u) => [u.id, u])
);

/** Map old vocation place id → studio municipality id */
export const PLACE_TO_STUDIO: Record<string, StudioId> = {
  los_cabos: 'los_cabos',
  east_cape: 'los_cabos',
  todos_santos: 'la_paz',
  la_paz: 'la_paz',
  loreto: 'loreto',
  comondu: 'comondu',
  mulege_north: 'mulege',
};

export function isStudioId(id: string | null | undefined): id is StudioId {
  return !!id && STUDIO_IDS.includes(id as StudioId);
}

export function studioFromPlace(placeId: string | null | undefined): StudioId {
  if (!placeId) return 'bcs';
  return PLACE_TO_STUDIO[placeId] || 'bcs';
}
