/**
 * Information architecture (2026-10-08 rediseño): one source of truth for the top bar, the "Temas"
 * menu, /temas, /inicio entry cards and breadcrumbs. Every route stays where it was; only the way
 * it is grouped and labelled changes. Plain, everyday wording (ES first, EN for the language toggle).
 */
export type IALink = { href: string; es: string; en: string; d_es?: string; d_en?: string };
export type IATheme = { id: string; es: string; en: string; d_es: string; d_en: string; icon: string; items: IALink[] };

export const THEMES: IATheme[] = [
  {
    id: 'territorio', icon: 'map',
    es: 'Territorio y municipios', en: 'Territory and municipalities',
    d_es: 'Mapas, los cinco municipios, población y fotos del territorio.',
    d_en: 'Maps, the five municipalities, population and territory photos.',
    items: [
      { href: '/explorar', es: 'Atlas 3D', en: '3D atlas', d_es: 'Capas sobre el relieve de todo el estado', d_en: 'Layers on the terrain of the whole state' },
      { href: '/mapas', es: 'Mapas', en: 'Maps', d_es: 'Mapa interactivo y mapas temáticos', d_en: 'Interactive map and thematic maps' },
      { href: '/studio', es: 'Municipios', en: 'Municipalities', d_es: 'Una ficha por municipio y una del estado', d_en: 'One page per municipality plus the state' },
      { href: '/territorio', es: 'Territorio', en: 'Territory', d_es: 'Censo 2020: municipios, cabeceras y localidades', d_en: 'Census 2020: municipalities, seats and localities' },
      { href: '/comunidades', es: 'Comunidades', en: 'Communities', d_es: 'Perfil de cada municipio', d_en: 'Profile of each municipality' },
      { href: '/stills', es: 'Fotos del territorio', en: 'Territory photos', d_es: 'Vistas aéreas por lugar', d_en: 'Aerial views by place' },
      { href: '/historia', es: 'Historia', en: 'History', d_es: 'Historia breve del estado y sus cabeceras', d_en: 'Short history of the state and its seats' },
    ],
  },
  {
    id: 'planeacion', icon: 'plan',
    es: 'Planeación y ordenamiento', en: 'Planning and land use',
    d_es: 'Planes urbanos y de ordenamiento, áreas protegidas, catastro y riesgos.',
    d_en: 'Current plans, ecological zoning, cadastre and hazards.',
    items: [
      { href: '/planeacion', es: 'Planeación', en: 'Planning', d_es: 'Planes urbanos y de ordenamiento', d_en: 'Urban and land-use plans' },
      { href: '/planes-archivo', es: 'Archivo de planes', en: 'Plans archive', d_es: 'Todos los instrumentos de planeación', d_en: 'All planning instruments' },
      { href: '/ambiente', es: 'Ambiente', en: 'Environment', d_es: 'Áreas naturales protegidas federales', d_en: 'Federal protected areas' },
      { href: '/riesgos', es: 'Riesgos', en: 'Hazards', d_es: 'Sismicidad, tenencia ejidal y mapas de riesgo', d_en: 'Seismicity, ejido tenure and hazard maps' },
      { href: '/catastro', es: 'Catastro e IMPLAN', en: 'Cadastre and IMPLAN', d_es: 'Portales de catastro y predial', d_en: 'Cadastre and property-tax portals' },
    ],
  },
  {
    id: 'recursos', icon: 'water',
    es: 'Agua y energía', en: 'Water and energy',
    d_es: 'Acuíferos, agua de lluvia, electricidad y su capacidad.',
    d_en: 'Aquifers, rainwater, electricity and its capacity.',
    items: [
      { href: '/agua', es: 'Agua', en: 'Water', d_es: 'Disponibilidad de acuíferos y desalación', d_en: 'Aquifer availability and desalination' },
      { href: '/agua/escorrentia', es: 'Escorrentía y agua de lluvia', en: 'Runoff and rainwater', d_es: 'Por dónde corre el agua de lluvia (modelo)', d_en: 'Where rainwater flows (model)' },
      { href: '/energia', es: 'Energía', en: 'Energy', d_es: 'Sistema eléctrico de BCS', d_en: 'BCS power system' },
    ],
  },
  {
    id: 'economia', icon: 'chart',
    es: 'Economía y crecimiento', en: 'Economy and growth',
    d_es: 'Cifras clave, turismo, vivienda, finanzas públicas y proyectos.',
    d_en: 'Key figures, tourism, housing, public finance and projects.',
    items: [
      { href: '/resumen', es: 'Resumen', en: 'Summary', d_es: 'Tablero con las cifras clave', d_en: 'Dashboard of the main data' },
      { href: '/finanzas-publicas/', es: 'Presupuesto y gasto público', en: 'Public budget and spending', d_es: 'Importes del presupuesto, informes oficiales y documentos', d_en: 'Budget amounts, official reports and documents' },
      { href: '/economia', es: 'Economía', en: 'Economy', d_es: 'PIB, inversión, empleo, turismo y minería', d_en: 'GDP, investment, jobs, tourism and mining' },
      { href: '/turismo', es: 'Turismo', en: 'Tourism', d_es: 'Atractivos turísticos y perfil de visitantes', d_en: 'Tourism assets and visitor profiles' },
      { href: '/inmobiliario', es: 'Inmobiliario', en: 'Real estate', d_es: 'Mercado residencial', d_en: 'Residential market' },
      { href: '/fiscal', es: 'Finanzas públicas', en: 'Public finance', d_es: 'Presupuestos e ingresos', d_en: 'Budgets and revenue' },
      { href: '/proyectos-federales', es: 'Proyectos federales', en: 'Federal projects', d_es: 'Inversiones federales en BCS', d_en: 'Federal investment in BCS' },
    ],
  },
  {
    id: 'conectividad', icon: 'plane',
    es: 'Conectividad', en: 'Connectivity',
    d_es: 'Aeropuertos, vuelos, puertos y carreteras.',
    d_en: 'Airports, flights, ports and highways.',
    items: [
      { href: '/conectividad', es: 'Conectividad', en: 'Connectivity', d_es: 'Aeropuertos, cruceros y carreteras federales', d_en: 'Airports, cruises and federal highways' },
      { href: '/vuelos', es: 'Conectividad aérea', en: 'Air connectivity', d_es: 'Vuelos directos desde SJD, La Paz y Loreto', d_en: 'Destinations from SJD, La Paz and Loreto' },
      { href: '/puertos', es: 'Puertos y demanda', en: 'Ports and demand', d_es: 'Aeropuertos, cruceros, carga y yates', d_en: 'Airports, cruises, cargo and yachts' },
    ],
  },
  {
    id: 'futuro', icon: 'spark',
    es: 'Actores y consultas', en: 'Stakeholders and queries',
    d_es: 'Actores del estado y consultas recientes al asistente.',
    d_en: 'State stakeholders and recent assistant queries.',
    items: [
      { href: '/stakeholders', es: 'Actores', en: 'Stakeholders', d_es: 'Instituciones, empresas y contactos', d_en: 'Institutions, companies and contacts' },
      { href: '/memoria', es: 'Consultas al asistente', en: 'Assistant queries', d_es: 'Preguntas recientes y vacíos de información', d_en: 'Recent questions and information gaps' },
    ],
  },
  {
    id: 'especialistas', icon: 'spark',
    es: 'Para especialistas', en: 'For specialists',
    d_es: 'Herramientas de análisis más técnicas: prospectiva, preguntas estratégicas, sesiones de trabajo, crecimiento y mapa de relaciones.',
    d_en: 'More technical analysis tools: foresight, strategic questions, work sessions, growth and relationship map.',
    items: [
      { href: '/gemelo', es: 'Gemelo territorial', en: 'Territorial twin', d_es: 'Mapa, cifras y escenarios para comparar el territorio', d_en: 'Map, figures and scenarios to compare the territory' },
      { href: '/consulta', es: 'Mesa de trabajo', en: 'Workspace', d_es: 'Mapa, asistente y archivos en la misma pantalla', d_en: 'Map, assistant and files on the same screen' },
      { href: '/coordinacion', es: 'Coordinación de proyectos', en: 'Project coordination', d_es: 'Institución, obra y sexenio del inventario federal', d_en: 'Institution, work and administration from the federal inventory' },
      { href: '/vistas', es: 'Vistas guardadas', en: 'Saved views', d_es: 'Enlaces con nombre para el mapa y el gemelo', d_en: 'Named links for the map and the twin' },
      { href: '/metas', es: 'Preguntas abiertas', en: 'Open questions', d_es: 'Preguntas, señales y brechas, sin porcentaje de avance', d_en: 'Questions, signals and gaps, with no progress percentage' },
      { href: '/foresights', es: 'Prospectiva', en: 'Foresight', d_es: 'Tesis y señales de cada semana', d_en: 'Weekly theses and signals' },
      { href: '/preguntas', es: 'Preguntas estratégicas', en: 'Strategic questions', d_es: 'Lo que hay que decidir y con qué evidencia', d_en: 'What must be decided and on what evidence' },
      { href: '/sesion', es: 'Sesión de estrategia', en: 'Strategy session', d_es: 'Vista para reuniones de estrategia', d_en: 'View for strategy meetings' },
      { href: '/crecimiento', es: 'Crecimiento: demanda y oferta', en: 'Growth: demand and supply', d_es: 'Lo que pide el crecimiento frente a lo disponible, por lugar', d_en: 'What growth needs versus what is available, by place' },
      { href: '/ontologia', es: 'Mapa de relaciones', en: 'Relationship map', d_es: 'Cómo se conectan lugares, proyectos y actores', d_en: 'How places, projects and stakeholders connect' },
    ],
  },
];

export const DOCS: IALink[] = [
  { href: '/aprendizaje', es: 'Aprender de otras ciudades', en: 'Learn from other cities', d_es: 'Casos y redes externas, sin cifras de BCS', d_en: 'External cases and networks, with no BCS figures' },
  { href: '/foro', es: 'Hoja para invitados', en: 'Guest sheet', d_es: 'Cuatro enlaces para seguir la reunión', d_en: 'Four links to follow the meeting' },
  { href: '/rutas', es: 'Mapa del sitio', en: 'Site map', d_es: 'Todas las páginas, incluida la ruta de decisión', d_en: 'Every page, including the decision path' },
  { href: '/catalogo', es: 'Catálogo de datos', en: 'Data catalog', d_es: 'Todos los archivos del proyecto, con enlace para ver o descargar', d_en: 'All project files, with view/download links' },
  { href: '/biblioteca', es: 'Biblioteca', en: 'Library', d_es: 'Referencias de planeación, agua, costa, transporte y finanzas', d_en: 'References on planning, water, coast, transport and finance' },
  { href: '/planes-archivo', es: 'Archivo de planes', en: 'Plans archive', d_es: 'Instrumentos de planeación, vigentes e históricos', d_en: 'Planning instruments, current and historical' },
];

/** Section pages that are not in the menus but have a parent (for breadcrumbs). */
const EXTRA_PARENTS: Record<string, { es: string; en: string; href: string }> = {
  '/preguntas/': { es: 'Preguntas estratégicas', en: 'Strategic questions', href: '/preguntas' },
  '/studio/': { es: 'Municipios', en: 'Municipalities', href: '/studio' },
  '/blog/': { es: 'Bitácora técnica', en: 'Technical log', href: '/blog' },
  '/catalogo/': { es: 'Catálogo de datos', en: 'Data catalog', href: '/catalogo' },
};

export type Crumb = { es: string; en: string; href?: string };
/** Breadcrumb trail for a path ("/agua/escorrentia" → Inicio › Agua y energía › Escorrentía y lluvia). */
export function breadcrumbs(path: string, pageEs: string, pageEn?: string): Crumb[] {
  const p = (path.replace(/\/$/, '') || '/');
  const out: Crumb[] = [{ es: 'Inicio', en: 'Home', href: '/inicio' }];
  if (p === '/inicio' || p === '/') return [];
  if (p === '/temas') return [...out, { es: 'Temas', en: 'Topics' }];
  if (p === '/catalogo') return [...out, { es: 'Documentos', en: 'Documents' }];
  const theme = THEMES.find((t) => t.items.some((i) => i.href === p));
  const doc = DOCS.find((i) => i.href === p);
  if (theme) {
    out.push({ es: theme.es, en: theme.en, href: `/temas#${theme.id}` });
    const it = theme.items.find((i) => i.href === p)!;
    // nested page (e.g. /agua/escorrentia) also shows its parent page
    const parent = theme.items.find((i) => i.href !== p && p.startsWith(i.href + '/'));
    if (parent) out.push({ es: parent.es, en: parent.en, href: parent.href });
    out.push({ es: it.es, en: it.en });
    return out;
  }
  if (doc) return [...out, { es: 'Documentos', en: 'Documents', href: '/temas#documentos' }, { es: doc.es, en: doc.en }];
  if (p === '/noticias') return [...out, { es: 'Noticias', en: 'News' }];
  if (p === '/ayuda') return [...out, { es: 'Ayuda y fuentes', en: 'Help and sources' }];
  for (const [pre, par] of Object.entries(EXTRA_PARENTS)) {
    if ((p + '/').startsWith(pre) && p + '/' !== pre) {
      const th = THEMES.find((t) => t.items.some((i) => i.href === par.href));
      if (th) out.push({ es: th.es, en: th.en, href: `/temas#${th.id}` });
      out.push({ es: par.es, en: par.en, href: par.href });
      out.push({ es: pageEs, en: pageEn || pageEs });
      return out;
    }
  }
  return [...out, { es: pageEs, en: pageEn || pageEs }];
}

/** Which top-bar entry is "current" for a path. */
export function topSection(path: string): 'inicio' | 'explorar' | 'temas' | 'documentos' | 'noticias' | 'ayuda' | '' {
  const p = (path.replace(/\/$/, '') || '/');
  if (p === '/inicio' || p === '/') return 'inicio';
  if (p === '/explorar') return 'explorar';
  if (p === '/noticias') return 'noticias';
  if (p === '/ayuda') return 'ayuda';
  if (DOCS.some((d) => d.href === p) || p.startsWith('/catalogo')) return 'documentos';
  if (p === '/temas' || THEMES.some((t) => t.items.some((i) => p === i.href || p.startsWith(i.href + '/')))) return 'temas';
  return '';
}
