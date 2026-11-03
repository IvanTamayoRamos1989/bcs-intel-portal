/**
 * BCS Portal chat — RAG over catalog + guides + ontology + stills.
 * Env: BCS_CHAT_API_KEY, BCS_CHAT_PROVIDER (openai|xai)
 */
import corpusData from './chat_corpus.json' with { type: 'json' };
import graphData from './ontology_graph.json' with { type: 'json' };
import stakeholdersSeed from './stakeholders_seed.json' with { type: 'json' };
import foresightsData from './foresights.json' with { type: 'json' };
import growthData from './growth_demand_supply.json' with { type: 'json' };
import strategicQuestionsData from './strategic_questions.json' with { type: 'json' };
import chatMedia from './chat_media.json' with { type: 'json' };
import { isAuthenticated } from '../lib/auth_shared.mjs';
import { logChatTurn, BODY_MAX_BYTES } from '../lib/chat_memory.mjs';
import {
  buildIndex as buildRagIndex,
  search as ragSearch,
  inferPlace as ragInferPlace,
  cleanSummary as ragCleanSummary,
  unsupportedNumbers,
  overlap as ragOverlap,
} from '../lib/rag.mjs';

const FP_TEAM_HIDE = /08_fp_team_research/i;
function scrubCorpus(rows) {
  return (Array.isArray(rows) ? rows : []).filter((c) => !FP_TEAM_HIDE.test(String(c?.path || '')));
}
let CORPUS = scrubCorpus(corpusData);
const GRAPH = graphData && typeof graphData === 'object' ? graphData : { nodes: [], edges: [] };
const GRAPH_NODES = Array.isArray(GRAPH.nodes) ? GRAPH.nodes : [];
const GRAPH_EDGES = Array.isArray(GRAPH.edges) ? GRAPH.edges : [];
const NODE_BY_ID = new Map(GRAPH_NODES.map((n) => [n.id, n]));
const ADJ = (() => {
  const m = new Map();
  for (const n of GRAPH_NODES) m.set(n.id, []);
  for (const e of GRAPH_EDGES) {
    const a = e.from;
    const b = e.to;
    const pred = e.predicate || 'related';
    if (m.has(a) && NODE_BY_ID.has(b)) m.get(a).push({ pred, id: b });
    if (m.has(b) && NODE_BY_ID.has(a)) m.get(b).push({ pred: pred + '_of', id: a });
  }
  return m;
})();

const STAKEHOLDERS = (() => {
  const raw = stakeholdersSeed;
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
})();

/** Place-vocation spine IDs (shared with portal PlaceStrip) */
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PLACE_SPINE = {
  los_cabos: { es: 'Los Cabos', en: 'Los Cabos', tokens: ['cabos', 'lucas', 'jose'] },
  east_cape: { es: 'Cabo Este', en: 'East Cape', tokens: ['este', 'east', 'cape'] },
  todos_santos: { es: 'Todos Santos', en: 'Todos Santos', tokens: ['todos', 'santos', 'pescadero'] },
  la_paz: { es: 'La Paz', en: 'La Paz', tokens: ['paz'] },
  loreto: { es: 'Loreto', en: 'Loreto', tokens: ['loreto'] },
  comondu: { es: 'Comondú', en: 'Comondú', tokens: ['comondu', 'constitucion'] },
  mulege_north: { es: 'Mulegé / norte', en: 'Mulegé / north', tokens: ['mulege', 'rosalia', 'vizcaino'] },
};

function inferPlaceId(message, explicit) {
  if (explicit && PLACE_SPINE[explicit]) return explicit;
  const hay = fold(String(message || '').toLowerCase());
  const checks = [
    ['los_cabos', ['los cabos', 'cabo san lucas', 'san jose del cabo', 'sjd', 'cabos']],
    ['east_cape', ['east cape', 'cabo del este', 'cabo pulmo', 'la ribera']],
    ['todos_santos', ['todos santos', 'pescadero']],
    ['la_paz', ['la paz', 'lap']],
    ['loreto', ['loreto', 'lto', 'nopolo']],
    ['comondu', ['comondu', 'ciudad constitucion', 'ciudad insurgentes', 'puerto san carlos', 'puerto de san carlos']],
    ['mulege_north', ['mulege', 'santa rosalia', 'vizcaino']],
  ];
  for (const [id, toks] of checks) {
    if (toks.some((t) => hay.includes(fold(t)))) return id;
  }
  return null;
}

function formatForesightContext(placeId, lang) {
  const fs = foresightsData && typeof foresightsData === 'object' ? foresightsData : {};
  const lines = [];
  const thesis = lang === 'en' ? (fs.edition_thesis_en || fs.headline_en) : (fs.edition_thesis_es || fs.headline_es);
  if (thesis) lines.push(`Edition thesis: ${thesis}`);
  const signals = Array.isArray(fs.signals) ? fs.signals : [];
  const filtered = placeId
    ? signals.filter((s) => (s.place_ids || []).includes(placeId) || fold(`${s.title_es} ${s.title_en} ${s.why_es} ${s.why_en}`).includes(fold(PLACE_SPINE[placeId]?.es || '')))
    : signals;
  for (const s of (filtered.length ? filtered : signals).slice(0, 4)) {
    const title = lang === 'en' ? s.title_en || s.title_es : s.title_es || s.title_en;
    lines.push(`Signal ${s.id} [${s.theme || ''}]: ${title}`);
  }
  const g = growthData && typeof growthData === 'object' ? growthData : {};
  const places = Array.isArray(g.places) ? g.places : [];
  const pl = placeId ? places.find((p) => p.id === placeId) : null;
  if (pl) {
    const name = lang === 'en' ? pl.name_en || pl.name_es : pl.name_es || pl.name_en;
    const bal = lang === 'en' ? pl.balance_read_en || pl.balance_read_es : pl.balance_read_es || pl.balance_read_en;
    lines.push(`Growth scorecard ${pl.id} (${name}): ${bal || pl.balance_read || ''}`);
  } else if (placeId) {
    lines.push(`Growth scorecard: see /crecimiento/?place=${placeId}`);
  }
  return lines.join('\n');
}

function pickForesightSignals(placeId, message, limit = 3) {
  const fs = foresightsData && typeof foresightsData === 'object' ? foresightsData : {};
  const signals = Array.isArray(fs.signals) ? fs.signals : [];
  const q = fold(String(message || ''));
  const scored = signals.map((s) => {
    let score = 0;
    const hay = fold(`${s.id} ${s.title_es} ${s.title_en} ${s.why_es} ${s.why_en} ${s.theme}`);
    const pids = s.place_ids || [];
    if (placeId && pids.includes(placeId)) score += 6;
    if (placeId && PLACE_SPINE[placeId]) {
      for (const t of PLACE_SPINE[placeId].tokens || []) {
        if (hay.includes(fold(t))) score += 2;
      }
    }
    for (const w of q.split(/\s+/).filter((x) => x.length > 3).slice(0, 10)) {
      if (hay.includes(w)) score += 1;
    }
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((x) => x.score > 0).slice(0, limit);
  const picked = (top.length ? top : scored.slice(0, Math.min(2, scored.length))).map(({ s }) => ({
    id: s.id,
    title_es: s.title_es || null,
    title_en: s.title_en || null,
    theme: s.theme || null,
    place_ids: s.place_ids || [],
    href: `/foresights/${placeId ? `?place=${encodeURIComponent(placeId)}&` : '?'}signal=${encodeURIComponent(s.id)}#signal-${encodeURIComponent(s.id)}`,
  }));
  return picked;
}

function pickForesightSignal(corpus, placeId, message) {
  const arr = pickForesightSignals(placeId, message, 1);
  return arr[0] || null;
}

function pickStrategicQuestions(placeId, message, limit = 2) {
  const qs = (strategicQuestionsData && Array.isArray(strategicQuestionsData.questions))
    ? strategicQuestionsData.questions : [];
  const q = fold(String(message || ''));
  const scored = qs.map((sq) => {
    let score = 0;
    if (placeId && (sq.places || []).includes(placeId)) score += 5;
    const hay = fold(`${sq.id} ${sq.question_es} ${sq.question_en} ${sq.planning_position_es} ${sq.planning_position_en}`);
    for (const w of q.split(/\s+/).filter((x) => x.length > 3).slice(0, 10)) {
      if (hay.includes(w)) score += 1;
    }
    return { sq, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, limit).map(({ sq }) => ({
    id: sq.id,
    question_es: sq.question_es,
    question_en: sq.question_en,
    href: `/preguntas/${sq.id}/`,
  }));
}




function loadCorpus() {
  return CORPUS;
}

async function ensureCorpus(event) {
  if (CORPUS && CORPUS.length) return CORPUS;
  try {
    const host = event.headers?.host || event.headers?.Host;
    const proto = (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || (host ? `${proto}://${host}` : '');
    if (!base) return CORPUS;
    const r = await fetch(`${base.replace(/\/$/, '')}/chat_corpus.json`);
    if (r.ok) {
      CORPUS = scrubCorpus(await r.json());
      return CORPUS;
    }
  } catch { /* ignore */ }
  return CORPUS;
}

const STOP = new Set(
  `a al algo algunas algunos ante antes aquel aquella aquellas aquellos aqui aqui as asi aunque bajo bien cada casi como con contra cual cuales cuando cuanto cuanta de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estaba estan este esto estos fue fui ha han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otras otro otros para pero poco por porque que quien se ser si sin sobre su sus te ti todo todos tu un una unas unos y ya yo the a an and are as at be by for from has have if in into is it its of on or that the their this to was were will with about what which who how when where why can could should would may might must also than then so such only just more most other some any no not vive vivien`.split(
    /\s+/
  )
);

/** Spanish/English query expansion for thematic retrieval */

/** Factor-pack intents (viability / land use / risks / opportunities). Folded, no accents. */
const VIABILITY_RE = /\b(viabilidad|viable|factibilidad|factible|feasib\w*|viability)\b/;
const PROJECT_KIND_RE =
  /\b(hotel\w*|desal\w*|desalin\w*|parque\s+industrial|industrial\s+park|vivienda|housing|carretera|highway|transpeninsular|energi\w*|energy|sibcs)\b/;
const LANDUSE_RE =
  /\b(cambio\s+de\s+uso|uso\s+de\s+suelo|usos\s+de\s+suelo|zonific\w*|land[\s-]?use|zoning|reclasific\w*|\bugas?\b|politica\s+ambiental)\b/;
const RISK_RE =
  /\b(riesgos?\s+principales|principales\s+riesgos|que\s+riesgos|cuales\s+son\s+los\s+riesgos|main\s+risks|principal\s+risks|key\s+risks|riesgos?\s+(del|de|en|para)|hazard|hazards|amenazas?)\b/;
const OPPORTUNITY_RE = /\b(oportunidad(?:es)?|opportunit(?:y|ies)|capacidad\s+ociosa|underused)\b/;
const FACTOR_COMPARE_RE = /\b(comparar|compara|compare|comparacion|comparaciones|comparativa|comparativo|comparing|comparando)\b/;

/** Walk predicates for the factor bundle. located_in / informs_decision are hubs and stay out. */
const FACTOR_WALK = new Set([
  'influences',
  'constrains',
  'enables',
  'risks',
  'opportunity_for',
  'requires_capacity',
  'governed_by',
  'demands',
]);

/** Spanish facet words → ontology node types (portal language ≠ graph enums). */
const FACET_TYPE_MAP = [
  { re: /\bvocacion(?:es)?\b|\bdemand\s*driver/, types: ['DemandDriver'] },
  { re: /\bcapacidades?\b|\bresource\s*capacity/, types: ['ResourceCapacity'] },
  { re: /\brestriccion(?:es)?\b|\bcandado|\bconstraint/, types: ['Constraint'] },
  { re: /\bactores?\b|\bstakeholders?\b/, types: ['Actor'] },
  { re: /\binstrumentos?\b|\bpdu\b|\bpoer\b|\bped\b|\bpoel\b|\bpoet\b/, types: ['Instrument'] },
];

const SYN_GROUPS = [
  {
    triggers: ['poblacion', 'poblacional', 'habitantes', 'habitante', 'gente', 'demografia', 'demografico', 'demografica', 'censo', 'cpv', 'inegi', 'viviendas', 'vivienda', 'ageb', 'agebs', 'habitan', 'residen', 'population', 'inhabitants', 'people', 'census', 'demographics'],
    expand: ['poblacion', 'habitantes', 'gente', 'censo', 'inegi', 'demografia', 'cpv', 'viviendas', 'pobtot', 'municipio', 'localidad', 'cabecera'],
  },
  {
    triggers: [
      'agua', 'water', 'acuifero', 'aquifer', 'dma', 'conagua', 'desalacion', 'desaladora', 'desalination',
      'hidrico', 'hidrica', 'consumo', 'consume', 'consumption', 'consumen', 'anual', 'year', 'yearly',
      'hm3', 'extraccion', 'extraction', 'disponibilidad', 'demand', 'demanda', 'cea', 'oomsapas',
    ],
    expand: [
      'agua', 'water', 'acuifero', 'dma', 'conagua', 'disponibilidad', 'hm3', 'consumo', 'extraccion',
      'deficit', 'recarga', 'cea', 'oomsapas', 'resourcecapacity',
    ],
  },
  {
    triggers: ['poer', 'poerbcs', 'ordenamiento', 'uga', 'ugas', 'pdu', 'psdu', 'planeacion', 'urbano', 'planning'],
    expand: ['poer', 'poerbcs', 'ordenamiento', 'ecologico', 'uga', 'pdu', 'planeacion', 'urbano', 'desarrollo'],
  },
  {
    triggers: ['energia', 'energy', 'electrica', 'sibcs', 'cfe', 'cenace', 'prodesen', 'pamrnt', 'megawatt', 'mw', 'red'],
    expand: ['energia', 'energy', 'sibcs', 'cfe', 'cenace', 'prodesen', 'pamrnt', 'aislada', 'transmision'],
  },
  {
    triggers: ['turismo', 'tourism', 'anp', 'protegida', 'protegidas', 'conanp', 'pulmo', 'vizcaino', 'costa', 'coast', 'hotel', 'presión', 'presion'],
    expand: ['turismo', 'tourism', 'anp', 'protegida', 'conanp', 'costa', 'coast', 'presion', 'pressure'],
  },
  {
    triggers: ['crecimiento', 'growth', 'restriccion', 'constraint', 'limita', 'limitacion', 'constrain', 'capacidad', 'capacity', 'carga'],
    expand: ['crecimiento', 'growth', 'constraint', 'capacidad', 'restriccion', 'pdu', 'dma', 'sibcs', 'escasez'],
  },
  {
    triggers: [
      'pib', 'pibe', 'ied', 'vab', 'economia', 'economico', 'economica', 'economy', 'economic',
      'empleo', 'enoe', 'itaee', 'setue', 'mdd', 'mdp', 'constante', 'nominal', 'cnie',
    ],
    expand: [
      'economia', 'pibe', 'pib', 'inegi', '07_economy', 'vab', 'ied', 'empleo', 'enoe',
      'constante', 'nominal', 'mdp', 'millones', 'producto', 'interno',
    ],
  },
  {
    triggers: [
      'mapa', 'mapas', 'map', 'maps', 'cartografia', 'cartography', 'gis', 'still', 'stills',
      'imagen', 'image', 'vista', 'view', 'satelite', 'satellite', 'earth', 'studio',
      'ubicacion', 'location', 'lat', 'lon', 'longitud', 'latitud', 'fotograma', 'georref',
    ],
    expand: [
      'mapa', 'mapas', 'cartografia', 'gis', 'still', 'stills', 'imagen', 'vista', 'satelite',
      'earth', 'studio', 'ubicacion', 'territorio', 'costa', 'municipio', 'stills', 'mapas',
    ],
  },
];

const WATER_PATH_RE = /02_water|guides\/agua|acuifero|aquifer|conagua|dma|desal|cea|oomsapas|resourcecapacity|constraint|ontologia|12_ontology|graph\.json/i;
const WATER_TITLE_RE = /conagua|dma|cea|oomsapas|acu[ií]fero|aquifer|disponibilidad|hm\s*³|hm3|desal/i;
const QUANT_WATER_RE = /\b(consum[oe]|consumption|consumo|consumen|anual|year|yearly|hm3|hm\s*³|extracci[oó]n|extraction|disponibilidad|demand|demanda|cu[aá]nt[oa]s?|how\s+much|volume|volumen|deficit|d[eé]ficit)\b/i;

const PLACE_ONLY = new Set([
  'san', 'jose', 'cabo', 'lucas', 'paz', 'loreto', 'comondu', 'mulege', 'constitucion',
  'todos', 'santos', 'guerrero', 'negro', 'rosalia', 'insurgentes', 'barriles',
  'baja', 'california', 'sur', 'bcs', 'los', 'cabos', 'la', 'east', 'cape', 'pulmo',
]);

const DEMO_PATH_RE = /05_demographics|demograf|inegi|censo|cpv|poblacion|habitante|municipio|territorio|coneval|iter/i;
const WEAK_PLACE_PATH_RE = /acuifero|conagua|aeropuerto|airport|ficha-030|proyectosmexico|carretera|desal/i;

const OPEN_Q_RE =
  /\b(why|how|what\s+if|compare|estimate|versus|vs\.?|relate|relationship|constrain|constraint|pressure|cu[aá]nto|c[oó]mo|por\s+qu[eé]|estim|compar|relacion|presi[oó]n|limita|restricc|qu[eé]\s+restringe|what\s+constrains)\b/i;

/** Collapse digit separators so 187,152 / 187 152 ≡ 187152 for matching. */
/** 14_gobierno: "¿quién dirige / quién es el titular…?" about a Los Cabos municipal unit. */
const GOV_WHO_RE = /\b(quien(es)?|titular(es)?|director(a|es)?|encargad[oa]s?|responsable|dirige|tesorer[oa]|contralor(a)?|regidor(a|es)?|regiduria|sindic[oa]|sindicatura|alcalde(sa)?|president[ea]\s+municipal|delegad[oa]s?|organigrama|oficial\s+mayor|secretari[oa]\s+general|who|head|mayor|runs|treasurer)\b/;
const GOV_PLACE_RE = /\b(cabos|lucas|oomsapas|implan|santiago|miraflores|ribera)\b/;
const MESA_QUERY_RE = /\b(mesa(s)?|integrante(s)?|quien(es)?\s+esta(n)?|quien(es)?\s+participa(n)?|working\s+table)\b/;
const MESA_DIRECT_RE = /\b(sepuimm|cea|conagua|comision\s+estatal\s+del\s+agua|energia|telecomunicaciones)\b/;
function isGovWhoQuery(q) {
  const qg = String(q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return GOV_WHO_RE.test(qg) && GOV_PLACE_RE.test(qg);
}
function isMesasQuery(q) {
  const qm = String(q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return MESA_QUERY_RE.test(qm) || (MESA_DIRECT_RE.test(qm) && /\b(cea|conagua|sepuimm|energia|telecomunicaciones)\b/.test(qm));
}

function normalizeNumberForms(s) {
  return String(s || '').replace(/(\d)[\s,]+(?=\d)/g, '$1');
}

function tokenize(text) {
  const normed = normalizeNumberForms(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9áéíóúñü\s/-]/gi, ' ')
  );
  return normed
    .split(/[\s/_.\-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** BCS2050 Library (13_library): Spanish → English bridge for international reference PDFs. */
const LIB_BRIDGE = {
  desalacion: ['desalination'], desalinizacion: ['desalination'], desaladora: ['desalination'], desaladoras: ['desalination'],
  reuso: ['reuse'], reutilizacion: ['reuse'], residuales: ['wastewater'], tratada: ['reclaimed'], lluvia: ['rainwater'],
  sequia: ['drought'], sequias: ['drought'], escasez: ['scarcity'], tarifas: ['pricing', 'tariff'], precio: ['pricing'],
  dot: ['tod', 'transit'], transporte: ['transit', 'transport'], movilidad: ['mobility', 'transit'], caminabilidad: ['walkability'],
  estacionamiento: ['parking'], calles: ['street', 'streets'], autobus: ['bus', 'brt'],
  app: ['ppp', 'partnership'], asociaciones: ['ppp', 'partnership'], concesion: ['concession'], concesiones: ['concession'],
  financiamiento: ['finance', 'financing'], riesgos: ['risk'], mezclado: ['blended'],
  costero: ['coastal'], costera: ['coastal'], costeras: ['coastal'], costeros: ['coastal'], litoral: ['coastal'],
  manglar: ['mangrove'], manglares: ['mangrove', 'mangroves'], huracan: ['hurricane'], huracanes: ['hurricane', 'hurricanes'],
  mar: ['sea'], marino: ['marine'], marina: ['marine'], oceano: ['ocean'], carga: ['carrying'],
  resiliencia: ['resilience'], adaptacion: ['adaptation'], clima: ['climate'], climatico: ['climate'], naturaleza: ['nature'],
  gobernanza: ['governance'], prospectiva: ['foresight'], participacion: ['participation'], indicadores: ['indicators'],
  vivienda: ['housing'], suelo: ['land'], plusvalias: ['value', 'capture'], plusvalia: ['value', 'capture'], predial: ['property', 'tax'],
  compacta: ['compact'], densidad: ['density'], expansion: ['expansion', 'sprawl'], espacio: ['space'], publico: ['public'],
  ordenamiento: ['territorial', 'planning'], regional: ['regional'], turistico: ['tourism'], destino: ['destination'], destinos: ['destination'],
  banco: ['bank'], mundial: ['world'], ocde: ['oecd'], cepal: ['eclac', 'cepal'], pnuma: ['unep'], onu: ['un-habitat', 'united', 'nations'],
  biblioteca: ['biblioteca', 'library'], lecturas: ['biblioteca', 'lectura'], bibliografia: ['biblioteca', 'library'],
};
const LIB_INTENT_RE =
  /\b(biblioteca|library|bibliograf\w*|lecturas?|leer|referencias?|buenas\s+practicas|mejores\s+practicas|best\s+practices?|experiencia\s+internacional|casos?\s+internacionales?|international|banco\s+mundial|world\s+bank|un-?habitat|onu-?habitat|ocde|oecd|itdp|ipcc|cepal|eclac|unep|pnuma|unesco|irena|iucn|uicn|nacto|wri|brookings|lincoln|manual|estandar|standard|framework|recomienda\w*|recomendaci\w*|lecciones|metodolog\w*|dot|tod|brt|app|ppp|desalaci\w*|desaliniz\w*|reuso|capacidad\s+de\s+carga|carrying\s+capacity|manejo\s+(integrado|costero)|iczm|iwrm|glosario)\b/;

function expandQuery(query) {
  const base = tokenize(query);
  const set = new Set(base);
  for (const t of base) {
    const add = LIB_BRIDGE[t];
    if (add) for (const e of add) set.add(e);
  }
  const norm = base.join(' ');
  let isDemoIntent = false;
  let isPlanningIntent = false;
  let isEnergyIntent = false;
  let isTourismAnpIntent = false;
  let isGrowthConstraintIntent = false;
  for (const g of SYN_GROUPS) {
    const hit = g.triggers.some((t) => set.has(t) || norm.includes(t));
    if (hit) {
      for (const e of g.expand) set.add(e);
      if (g.expand.includes('poblacion')) isDemoIntent = true;
      if (g.expand.includes('poer') || g.expand.includes('pdu')) isPlanningIntent = true;
      if (g.expand.includes('sibcs')) isEnergyIntent = true;
      if (g.expand.includes('anp') || g.expand.includes('turismo')) isTourismAnpIntent = true;
      if (g.expand.includes('crecimiento') || g.expand.includes('constraint')) isGrowthConstraintIntent = true;
    }
  }
  const qn = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (
    /\b(gente|habitantes|poblacion|vive|viven|habitan|population|people|inhabitants)\b/.test(qn) ||
    /\bcuant[ao]s?\s+(gente|habitantes|personas|people)/.test(qn)
  ) {
    isDemoIntent = true;
    for (const e of SYN_GROUPS[0].expand) set.add(e);
  }
  const KNOWN_PLACES = [
    'loreto', 'comondu', 'mulege', 'paz', 'cabos', 'jose', 'lucas',
    'constitucion', 'rosalia', 'guerrero', 'negro', 'insurgentes',
    'todos', 'santos', 'barriles', 'pescadero', 'pulmo', 'vizcaino',
    'nopolo', 'magdalena', 'santiago', 'miraflores', 'ribera',
    'east', 'cape', 'nopolis', 'ligui', 'muertos', 'ventana',
  ];
  const placeTokens = new Set(base.filter((t) => KNOWN_PLACES.includes(t) || PLACE_ONLY.has(t)));
  for (const g of ['san', 'los', 'la', 'del', 'baja', 'california', 'sur', 'bcs']) {
    placeTokens.delete(g);
  }
  let isWaterIntent = SYN_GROUPS[1].triggers.some((t) => set.has(t) || qn.includes(t));
  if (
    /\b(agua|water|acuifero|aquifer|dma|conagua|hidric)\b/.test(qn) ||
    /\b(consum[oe]|consumption|consumo|hm3|hm\s*³|extracci|disponibilidad)\b/.test(qn)
  ) {
    isWaterIntent = true;
    for (const e of SYN_GROUPS[1].expand) set.add(e);
  }
  let isWaterQuantityIntent =
    isWaterIntent &&
    (QUANT_WATER_RE.test(qn) ||
      /\b(hm3|consumo|consum|extraction|extraccion|disponibilidad|demand|demanda|anual|year)\b/.test(
        [...set].join(' ')
      ));
  const isPoerIntent = SYN_GROUPS[2].triggers.some((t) => set.has(t) || qn.includes(t));
  if (/\b(energi|sibcs|cfe|cenace|prodesen|pamrnt|electri)\b/.test(qn)) {
    isEnergyIntent = true;
    for (const e of SYN_GROUPS[3].expand) set.add(e);
  }
  if (/\b(turismo|tourism|anp|proteg|conanp|pulmo|vizcaino|costa|coast)\b/.test(qn)) {
    isTourismAnpIntent = true;
    for (const e of SYN_GROUPS[4].expand) set.add(e);
  }
  if (/\b(crecimiento|growth|constrains?|restricc|limita|capacidad\s+de\s+carga|what\s+constrains)\b/.test(qn)) {
    isGrowthConstraintIntent = true;
    for (const e of SYN_GROUPS[5].expand) set.add(e);
  }
  let isEconomyIntent =
    SYN_GROUPS[6] &&
    SYN_GROUPS[6].triggers.some((t) => set.has(t) || qn.includes(t));
  if (
    /\b(pib|pibe|vab|ied|economia|econom|empleo|enoe|itaee|setue|mdp|mdd|cnie)\b/.test(qn) ||
    /\bpib\s*constante\b|producto\s+interno|millones\s+de\s+pesos/.test(qn)
  ) {
    isEconomyIntent = true;
    for (const e of SYN_GROUPS[6].expand) set.add(e);
  }
  // Bare "inegi" must not force demography when the query is about PIB/economía
  if (isEconomyIntent && !/\b(poblacion|habitantes|gente|population|people|inhabitants|censo|demograf|viviendas)\b/.test(qn)) {
    isDemoIntent = false;
  }
  if (isWaterIntent && !/\b(poblacion|habitantes|gente|population|people|inhabitants|censo|demograf)\b/.test(qn)) {
    isDemoIntent = false;
  }
  // "cuánta población" is demographic, not a synthesis open-Q
  const pureDemo =
    isDemoIntent &&
    !isWaterIntent &&
    !isEnergyIntent &&
    !isTourismAnpIntent &&
    !isGrowthConstraintIntent &&
    !isPlanningIntent &&
    !isEconomyIntent;
  let isOpenIntent =
    !pureDemo &&
    (OPEN_Q_RE.test(qn) ||
      isGrowthConstraintIntent ||
      isTourismAnpIntent ||
      (isWaterQuantityIntent && !isDemoIntent) ||
      (/\b(relate|relacion|pressure|presion|compare|compar)\b/.test(qn) &&
        (isWaterIntent || isEnergyIntent || isPlanningIntent || isTourismAnpIntent)));


  // Ontology facet intent (vocaciones / capacidades / restricciones / actores / instrumentos)
  const facetTypes = [];
  for (const f of FACET_TYPE_MAP) {
    if (f.re.test(qn)) {
      for (const t of f.types) {
        if (!facetTypes.includes(t)) facetTypes.push(t);
      }
    }
  }
  const isFacetIntent = facetTypes.length > 0;
  // Metric / table-fact questions (prefer type=fact + guides)
  let isFactIntent =
    isEconomyIntent ||
    /\b(cifra|dato|tabla|cuant[oa]|cu[aá]nto|valor|tasa|porcentaje|mdp|hm3|hm\s*³|dma|deficit|d[eé]ficit|acuifero|desal|habitacion(?:es)?|hotel(?:es)?|cuartos?|ocupacion|pasajeros|mw|mwh|pib|pibe|ied)\b/.test(qn) ||
    /\d{3,}/.test(qn);

  // Spatial / maps / stills / Earth Studio intent
  const SPATIAL_RE =
    /\b(mapa|mapas|map|maps|cartograf|gis|still|stills|imagen|image|vista|view|satelit|satellite|earth\s*studio|earthstudio|ubicacion|location|latitud|longitud|\blat\b|\blon\b|fotograma|georref|capas?\s+gis)\b/i;
  let isSpatialIntent =
    SPATIAL_RE.test(qn) ||
    SYN_GROUPS[7]?.triggers?.some((t) => set.has(t) || qn.includes(t));
  if (isSpatialIntent) {
    for (const e of SYN_GROUPS[7].expand) set.add(e);
    // Spatial questions are not pure population/economy factoids
    if (!/\b(poblacion|habitantes|gente|pib|pibe|economia)\b/.test(qn)) {
      isDemoIntent = false;
    }
  }
  // "qué muestra el mapa…" / "stills loreto costa" → treat as open synthesis lightly
  if (isSpatialIntent && /\b(muestra|muestran|ve|ves|vemos|describe|describa|que\s+hay)\b/.test(qn)) {
    // keep open-ish for richer k without forcing growth ontology flood
  }

  // Scenario / projection intent (triplica, en N años, proyección, what-if population×resource)
  const SCENARIO_RE =
    /\b(si\s+(la\s+)?poblaci[oó]n|se\s+triplic|triplic[ae]|duplic[ae]|proyecci[oó]n|proyectad|escenario|what\s+if|en\s+los\s+pr[oó]ximos\s+\d+|pr[oó]ximos\s+\d+\s+a[nñ]os|next\s+\d+\s+years|cu[aá]nta\s+agua\s+neces|necesitaremos\s+consumir|si\s+crece|population\s+triples|triples?)\b/i;
  let isScenarioIntent = SCENARIO_RE.test(qn) || SCENARIO_RE.test(query || '');
  // Water×population counterfactuals are scenarios even without explicit "escenario"
  if (
    isWaterIntent &&
    isDemoIntent &&
    /\b(triplic|duplic|\d+\s*a[nñ]os|pr[oó]ximos|proyecci|necesitar|consumir\s+anual|anualmente)\b/i.test(qn)
  ) {
    isScenarioIntent = true;
  }
  if (isScenarioIntent) {
    // Force both water supply/demand AND population baselines into retrieval vocabulary
    isOpenIntent = true;
    isFactIntent = true;
    for (const e of SYN_GROUPS[0].expand) set.add(e);
    for (const e of SYN_GROUPS[1].expand) set.add(e);
    set.add('pobtot');
    set.add('798447');
    set.add('territorio');
    set.add('demanda');
    set.add('disponibilidad');
    set.add('dma');
    // Keep both intents so retrieve injects dual baselines
    isDemoIntent = true;
    isWaterIntent = true;
    if (/\b(agua|water|consum|hm3|dma|acuifero)\b/i.test(qn)) {
      isWaterQuantityIntent = true;
    }
  }

  const factorKinds = [];
  if (VIABILITY_RE.test(qn) || (/\b(proyecto|project)\b/.test(qn) && PROJECT_KIND_RE.test(qn))) {
    factorKinds.push('viability');
  }
  if (LANDUSE_RE.test(qn)) factorKinds.push('landuse');
  if (RISK_RE.test(qn)) factorKinds.push('risk');
  if (OPPORTUNITY_RE.test(qn)) factorKinds.push('opportunity');
  const whoFactor = /\b(quien (decide|opera|autoriza|gobierna)|who (decides|operates|runs)|titular)\b/.test(qn);
  if (whoFactor && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\bcompens\w*\b|\boffset\b/.test(qn) && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\brenta hotel|\bcap rate|\bocupacion(?: de)? hotel|\brenta por noche|\bprecio por noche/.test(qn) && !factorKinds.includes('viability')) factorKinds.push('viability');
  const mobileGen = /\bturbinas? moviles?\b|\bgeneracion movil\b|\bcabo bello\b|\bturbogas\b/.test(qn)
    || (/\b128\b/.test(qn) && /\b(mw|megawatts?)\b/.test(qn));
  if (mobileGen && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\b(0302|acuifero vizcaino)\b/.test(qn) && /\b(mulege|pertenece|asign)\b/.test(qn) && !factorKinds.includes('viability')) {
    factorKinds.push('viability');
  }
  if (/\bcabo pulmo\b/.test(qn) && /\bhotel/.test(qn) && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\bcabo pulmo\b/.test(qn) && /\b(constru\w*|cierra|obra)\b/.test(qn) && !factorKinds.includes('landuse')) factorKinds.push('landuse');
  if (/\basipona\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\bcompuerta\b/.test(qn) || (/\b237\b/.test(qn) && /\bmw\b/.test(qn))) && !factorKinds.includes('viability') && !factorKinds.includes('risk')) {
    factorKinds.push(/\briesgo/.test(qn) ? 'risk' : 'viability');
  }
  if ((/\bley de ingresos\b/.test(qn) || (/\b(ingresos|ingresa)\b/.test(qn) && /\b2026\b/.test(qn))) && !factorKinds.includes('viability')) {
    factorKinds.push('viability');
  }
  if (/\bdesal\w*/.test(qn) && /\b(250|litros|l\/s)\b/.test(qn) && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\bcomondu\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && /\b(deficit|cubrir|compens\w*|offset)\b/.test(qn) && !factorKinds.includes('viability')) {
    factorKinds.push('viability');
  }
  if (/\b(cinco municipios|cinco polos)\b/.test(qn) && FACTOR_COMPARE_RE.test(qn) && !factorKinds.includes('viability')) factorKinds.push('viability');
  if (/\bcrucer/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bjll\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(sniiv|rezago habitacional)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bsierra la laguna\b/.test(qn) && /\b(hotel|impide|cierra|construc)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bbahia de loreto\b/.test(qn) && /\b(limita|crecimiento|hotel|parque|anp)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(api bcs|pichilingue)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\baeropuerto/.test(qn) && /\b(gap|concesion|sjd|la paz|los cabos)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (FACTOR_COMPARE_RE.test(qn) && /\baeropuerto/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bescenario\b/.test(qn) && /\bagua primero\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\bdestinos sin escala\b/.test(qn) || (/\bsjd\b/.test(qn) && /\bdestinos\b/.test(qn))) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bfonatur\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(isla electr\w*|red aislada|sistema aislado)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bp23\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bbess\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bel novillo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdesal\w*/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bptar\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmesa del? agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bescenario\b/.test(qn) && /\b(corredor|intensif|ancla)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bescenario\b/.test(qn) && /\b(puertos?|aeropuertos?)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bied\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bapagon/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(peotdu|poetdu)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bbarriles\b/.test(qn) && /\b(plan|psdu|pdu)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(cabo del este|east cape)\b/.test(qn) && /\b(boletin|pdu)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(segunda residencia|segundas residencias|segunda casa|segundas casas|second homes?)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bturismo\b/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\boomsapas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsepuimm\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bconanp\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\bcomision estatal del agua\b/.test(qn) || /\bcea\b/.test(qn)) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpoel\b/.test(qn) && /\b(desarrollador|exige agua)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bvivienda social\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(huracan|rachel)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\btrayectoria actual\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btodos santos\b/.test(qn) && /\b(amenidad|0313|acuifer)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(east cape|cabo del este)\b/.test(qn) && /\b(desborde|spillover)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btranspeninsular\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bimplan\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpoer\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(oasis|hidrogen)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bturismo\b/.test(qn) && /\b(los cabos|cabo san lucas|san jose del cabo)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bforo\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(playitas|san juan de la costa|programa subregional)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bveda\b/.test(qn) && /\b1954\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bintrusion (marina|salina)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\btenencia\b/.test(qn) && /\b(barriles|cardonal|los barriles)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcabo pulmo\b/.test(qn) && /\bbahia de loreto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdossier\b/.test(qn) && /\b(mulege|loreto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdesierto de evidencia\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\borientacion aerea\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (
    /\b(los cabos|cabo san lucas)\b/.test(qn) &&
    /\b(dirige|titular)\b/.test(qn) &&
    /\b(ecologia|catastro|presidencia|desarrollo urbano|fomento economico|desarrollo social|servicios publicos|seguridad publica)\b/.test(qn) &&
    !factorKinds.length
  ) {
    factorKinds.push('viability');
  }
  if (/\bpresidencia municipal\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\borganigrama\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(delegad\w*|delegacion\w*)\b/.test(qn) && /\b(los cabos|cabo san lucas|la ribera|miraflores|santiago)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bmiraflores\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(asentamientos humanos|direccion general de obras)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(apff|flora y fauna|area de proteccion)\b/.test(qn) && /\bcabo san lucas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcorredor hotelero\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdensificacion costera\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bprograma de manejo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bexpediente\b/.test(qn) && /\bpoer\b/.test(qn) && !factorKinds.includes('landuse')) factorKinds.push('landuse');
  if (/\bplan estatal de desarrollo\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bprodesen\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bficha app\b/.test(qn) || (/\bdesal\w*/.test(qn) && /\bapp\b/.test(qn) && !factorKinds.length)) {
    if (!factorKinds.length) factorKinds.push('viability');
  }
  if (/\bsetue\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bcenace\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(todos santos|pescadero)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bla ribera\b/.test(qn) && /\b(pdu|poel|instrumento|plan)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bsantiago\b/.test(qn) && /\b(0320|acuifer)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bconstitucion\b/.test(qn) && /\bagro\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bguerrero negro\b/.test(qn) && /\b(sal|essa|exportadora)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsanta rosalia\b/.test(qn) && /\bpuerto/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bcabo pulmo\b/.test(qn) && /\bsierra la laguna\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(east cape|cabo del este)\b/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(los cabos|cabo san lucas)\b/.test(qn) && /\bloreto\b/.test(qn) && /\bagua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmulege\b/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btodos santos\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(glorieta|paso a desnivel)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\b70\b/.test(qn) && /\bmva\b/.test(qn)) || /\bbuenavista\b/.test(qn) || /\bcabo falso\b/.test(qn)) {
    if (!factorKinds.length) factorKinds.push('viability');
  }
  if (/\bcapacidad de carga\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bintegridad ecologica\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\blocalidades\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(acuerdo|dof)\b/.test(qn) && /\b(dma|acuifer)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\binterconex\w*/.test(qn) && /\b(pausad\w*|sin|sistema interconectado)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(don diego|golfo de ulloa)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmujeres libres\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(stills|imagenes del territorio)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(east cape|cabo del este)\b/.test(qn) && /\bloreto\b/.test(qn) && /\baeropuerto/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bcomondu\b/.test(qn) && /\bla paz\b/.test(qn) && /\b(agro|agua)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0314\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(escorrent|escurrimient)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bley de aguas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(costa protegida|buffer)\b/.test(qn) && /\b(anp|hotel|cabo|costa)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\banuncio\b/.test(qn) && /\bfederal\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btecho regulatorio\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bnopolo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bciudad insurgentes\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpuerto (de )?san carlos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpamrnt\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(pducp|centro de poblacion|pmdu)\b/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bpoel\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bescasez\b/.test(qn) && /\bagua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(se creo|se fundo|fundacion|decreto 181)\b/.test(qn) && /\b(estado|baja california|\bbcs\b|los cabos|municipio)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b1974\b/.test(qn) && /\b(baja california|\bbcs\b|los cabos|estado)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b1974\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btercera actualizacion\b/.test(qn) && /\bpdu\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(subestacion|subestaciones)\b/.test(qn) && !/\b70\b/.test(qn) && !/\b(buenavista|cabo falso)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bmva\b/.test(qn) && !/\b70\b/.test(qn) && !/\b(buenavista|cabo falso)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bllaves\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\breuso\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bnom[-\s]?011\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdesal\w*/.test(qn) && /\b(crece|crecimiento|alcanza|sustitu)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bvizcaino\b/.test(qn) && /\b(corredor|carretera|ensanche)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bapp\b/.test(qn) && /\b(lista|infraestructura|inversion)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(los cabos|cabo san lucas)\b/.test(qn) && /\bmulege\b/.test(qn) && /\b(energi\w*|agua|sibcs)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(ayuntamiento|cabildo)\b/.test(qn) && /\bcomondu\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(ayuntamiento|cabildo)\b/.test(qn) && /\bmulege\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmesa de energia\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmesa de urbanismo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bgap\b/.test(qn) && /\b(opera|concesion|aeropuerto)\b/.test(qn) && /\b(san jose|la paz|los cabos|sjd)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bagua primero\b|\bwater first\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(como vamos|seguimos como)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\briesgos?\b/.test(qn) && /\boportunidad/.test(qn)) {
    if (!factorKinds.includes('risk')) factorKinds.push('risk');
    if (!factorKinds.includes('opportunity')) factorKinds.push('opportunity');
  }
  if (/\bsierra la laguna\b/.test(qn) && /\b(recarga|integridad)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bordenamiento ecologico\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(amplia\w*|moderniz\w*)\b/.test(qn) && /\bred\b/.test(qn) && /\b(electric\w*|bcs|sibcs)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if ((/\bunion con la red nacional\b/.test(qn) || /\bsistema nacional\b/.test(qn)) && /\bpausad\w*/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(cobra|opera)\b/.test(qn) && /\bagua\b/.test(qn) && /\b(cabo san lucas|los cabos)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bcatastro\b/.test(qn) && /\b(lleva|quien|titular|dirige)\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(linea de transmision|transmision|potencia)\b/.test(qn) && /\bla paz\b/.test(qn) && /\blos cabos\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(antes que el agua|antes del agua)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bvizcaino\b/.test(qn) && /\bhotel/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bplan de desarrollo urbano\b/.test(qn) && /\b(los cabos|cabo san lucas|la paz)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('landuse');
  }
  if (/\bsistema electrico\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bplan sexenal\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(areas naturales protegidas|administra las areas)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsecretaria de planeacion\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\benergi\w*/.test(qn) && /\bla paz\b/.test(qn) && /\blos cabos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bagua\b/.test(qn) && /\bla paz\b/.test(qn) && /\blos cabos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bhuecos?\b/.test(qn) && /\bhotel/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bnucleo\b/.test(qn) && /\b(pulmo|anp|vizcaino|sierra)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bordenamiento local\b/.test(qn) && /\b(los cabos|cabo san lucas)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btecho ecologico\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(aprovechamiento sustentable|preservacion|restauracion)\b/.test(qn) && /\bordenamiento\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('landuse');
  }
  if (/\bapi\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\baeropuerto/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdensific\w*/.test(qn) && /\b(costa|los cabos|cabo)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcomision nacional del agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmarina\b/.test(qn) && /\b(cabo san lucas|los cabos)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(10 de abril de 1980|20 de agosto de 1992|6 de junio de 1995|30 de noviembre de 1988)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(east cape|cabo del este)\b/.test(qn) && /\baeropuerto/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\briesgos?\b/.test(qn) && /\bquien decide\b/.test(qn)) {
    if (!factorKinds.includes('risk')) factorKinds.push('risk');
    if (!factorKinds.includes('viability')) factorKinds.push('viability');
  }
  if (/\btarifas?\b/.test(qn) && /\b(puerto|marina)\b/.test(qn) && /\b(cabo san lucas|los cabos)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\b(cuadros|stills)\b/.test(qn) && /\bvizcaino\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcuatro acuiferos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(tabla de disponibilidad|disponibilidad de acuiferos)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bremanente\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bciudad constitucion\b/.test(qn) && !/\bconstitucion politica\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bocupacion\b/.test(qn) && /\b(octubre|no es renta)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(red del pais|red nacional)\b/.test(qn) && /\bpaus/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\banexo\b/.test(qn) && /\b(participaciones?|2025)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bprimero el agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b1973\b/.test(qn) && /\bcabo san lucas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bamortiguamiento\b/.test(qn) && /\bvizcaino\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(costa toca|toca un area protegida|area protegida)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bfalta agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bley estatal de aguas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdisponibilidad media\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(valle agricola|agricola)\b/.test(qn) && /\binsurgentes\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsan carlos\b/.test(qn) && /\bapi\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b50 anos\b/.test(qn) && /\bpuerto\b/.test(qn) && /\b(cabo|cabos)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btransferencia\b/.test(qn) && /\b(puerto|asipona|api)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\breporte de vivienda\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bviabil/.test(qn) && /\briesgos?\b/.test(qn) && /\bhuecos?\b/.test(qn) && !factorKinds.includes('risk')) factorKinds.push('risk');
  if (/\bdesal\w*/.test(qn) && /\bno borra\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcuellos de la red\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bfebrero de 2024\b/.test(qn) && /\b(concesion|puerto|marina)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b1 de octubre\b/.test(qn) && /\b(tarifa|puerto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bapi\b/.test(qn) && /\b(administre|pidio)\b/.test(qn) && /\b(cabo|puerto)\b/.test(qn) && !factorKinds.length) {
    factorKinds.push('viability');
  }
  if (/\bnatali\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b50 anos\b/.test(qn) && /\bfebrero de 2024\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\barribos?\b/.test(qn) && /\bsanta rosalia\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(rubio apodaca|ramon rubio)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bagundez\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\broberto flores\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bjudith diaz\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(gonzalez gilbert|gonzalez gibert|beatriz gonzalez)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(castro cesena|carlos castro)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\burueta\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(ramirez reyes|alejandra ramirez)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmontano\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(lopez monge|christopher jordi|jordi lopez)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(karina|de la o)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(aracely|cota ruiz)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\baremy\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(linda silva|silva cosio|linda maribel)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(2|6) de julio de 1954\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if ((/\b(niveles bajo el mar|bajo el nivel del mar)\b/.test(qn) || (/\blos planes\b/.test(qn) && /\b(nivel del mar|bajo el mar)\b/.test(qn))) && !factorKinds.length) factorKinds.push('risk');
  if (/\b603 horas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b688(\.5)?\b/.test(qn) && /\b(mw|megawatts?|pico)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b3\.8 millones\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\barribos?\b/.test(qn) && /\b(285|pichilingue|cabo san lucas)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bdecreto 872\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsegunda actualizacion\b/.test(qn) && /\b(pdu|plan)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(23 de abril de 2013|6 de mayo de 2013)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\blos frayles\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bimagen radio\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bocupacion\b/.test(qn) && /\bsegunda mitad\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b2047\b/.test(qn) && /\b(api|concesion|puerto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\benjambre\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bmalec[oó]n\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bsanto domingo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(diez|10) horas\b/.test(qn) && /\blimite\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(230|115)\b/.test(qn) && /\b(kilovolts?|kv)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(sismo|sismos|sismica|5\.6)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\batlas estatal de riesgo\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b(insus|predios donados)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(icsid|fosfato)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b89 mil hogares\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(853 mil|1[,.]?570 millones|1[,.]?840 unidades)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(9 de noviembre de 2023|17 de agosto de 2023)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(13 de noviembre de 2009|1 de septiembre de 2000|11 de noviembre de 2002)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\b96 ejidos\b/.test(qn) || (/\bejidos\b/.test(qn) && /\bran\b/.test(qn))) && !factorKinds.length) factorKinds.push('risk');
  if (/\bcabecera\b/.test(qn) && /\bsan jose\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdecreto 181\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if ((/\b83\.2\b/.test(qn) || (/\b83 por ciento\b/.test(qn) && /\bllegadas\b/.test(qn))) && !factorKinds.length) factorKinds.push('opportunity');
  if ((/\b668\s*mil\b/.test(qn) || /\b668[,.]800\b/.test(qn)) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(diciembre de 2028|no alivia)\b/.test(qn) && /\b2028\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bextracciones limitadas\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\balternativa turistica\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmunicipio por confirmar\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0\.497\b/.test(qn) && /\b(vizcaino|acuifer|0302)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bboge\b/.test(qn) && /\b14\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b29 de febrero de 2024\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bxv ayuntamiento\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bconsulta 2023\b/.test(qn) && /\b(pdu|plan|decreto|actualizacion)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b356 paginas\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b20 de diciembre de 2024\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bpmd\b/.test(qn) && /\bmulege\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if ((/\bgazette\b/.test(qn) || /\bpsdu\b/.test(qn)) && /\b2007\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bsan jose del este\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bmitsubishi\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(40[,.]?000|40 mil) hectareas\b/.test(qn) && /\bsal\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcenapred\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\btransparencia\b/.test(qn) && /\b(puerto|congreso)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\breerig/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpunta nayu\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdesarrollador\b/.test(qn) && /\bdesal/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bdestinos\b/.test(qn) && /\b(5|cinco)\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bdestinos\b/.test(qn) && /\b7\b/.test(qn) && /\bla paz\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bdragado\b/.test(qn) && /\b(nucleo|prohib|cerrad|vetad)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bmineria\b/.test(qn) && /\bnucleo\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(hoy bcs|energy (&|and) commerce)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b18 de septiembre\b/.test(qn) && /\b(unidades|turbinas|movil)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b89 mil\b/.test(qn) && /\b(comparacion|censo|nota|prensa)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b27\.83\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(35000|35 mil) viviendas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bllegadas aereas\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b10\.9\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b668800\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(asociacion de hoteles|tribuna de mexico)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bocupacion\b/.test(qn) && /\b(76|60|90|14|5) por ciento\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b14 por ciento\b/.test(qn) && /\b(turistas|estados unidos)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(picos previstos|arriba de 90)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bintencion politica\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcapital ecologica\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bsobreextraccion\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b(sin boge|consulta de 2023)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bboge\b/.test(qn) && /\b19\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btercer(a)? (actualizacion|decreto)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(ciclovia|17 cruces peatonales)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b840\b/.test(qn) && /\bmetros\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(exportadora de sal|salina|essa)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bnacionalizacion\b/.test(qn) && /\bsal\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b37\.1\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\blaudo\b/.test(qn) && /\b2024\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(uabcs|atlas de riesgo|proteccion civil)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bm4\.[36]\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b(infonavit|brisas del valle)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b20 de octubre\b/.test(qn) && /\b(congreso|predios|insus|dono)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bveda indefinida\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btipo iii\b/.test(qn) && /\b(veda|1954)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(9\.5 litros|0\.298\b|0\.30 hectomet)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0320\b/.test(qn) && /\bveda\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno licencia un polo\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpdu\b/.test(qn) && /\bmulege\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bplan parcial\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bla ribera\b/.test(qn) && /\bpsdu\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bempleo local\b/.test(qn) && /\b(east cape|cabo del este)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b56 destinos\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b2048\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\blto\b/.test(qn) && /\bdestinos\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\blap\b/.test(qn) && /\b7\b/.test(qn) && /\bdestinos\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b89[,.]?600\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(1057758|1[,.]?057[,.]?758|133[,.]?269|33[,.]?412)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b594\b/.test(qn) && /\b(pasajer|santa rosalia|crucero)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(direccion municipal de obras|nombre del titular)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(99 unidades|92 titulares|reglamento de la administracion publica municipal)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmia\b/.test(qn) && /\bdesal/.test(qn) && /\bcomondu\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bacueducto\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bmargen electrico\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(bcs30as|bcs55pt|bcs01pt)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b56\b/.test(qn) && /\b(ugas|unidades de gestion)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\benero de 2026\b/.test(qn) && /\b(ordenamiento|poer)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b2021\b/.test(qn) && /\b2027\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(sin volumen|sin margen)\b/.test(qn) && /\bnuevas concesiones\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpico de referencia\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpuerta secundaria\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bcompite con la hotel/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno cierra la etapa\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bperiurban/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b72 puntos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(106|33|54) cuadros\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b956\b/.test(qn) && /\b(fotograf|stills|imagenes)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(2[,.]?900 tramos|4[,.]?428 salidas|no es un mapa de inundacion)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b(776\b.*\bviviend|\baño parcial\b)/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b42 millones\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b41 casas\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(meganoticias|accesos a playa|29 de octubre de 2026)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btarifas?\b/.test(qn) && /\b(publicadas|sin precio)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b50 anos\b/.test(qn) && /\bfebrero\b/.test(qn) && /\bconcesion\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0\.107\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0323\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b2 y 6 de julio\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bfuera del sistema nacional\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(code_?pa|no asignar rt)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(duis|permisos de construccion)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if ((/\bcatastro\b/.test(qn) && /\b(fuera|visor|login|secundario)\b/.test(qn) || (/\bvisor\b/.test(qn) && /\blogin\b/.test(qn))) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bparque industrial\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bexcursion\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bmonto contractual\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(12\.5|13\.5|2\.96|2\.29)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(69|81) por ciento\b/.test(qn) && /\b(reporte|volumen|jll)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b60 por ciento\b/.test(qn) && /\bunidades\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b1[,.]?492 millones\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b18 por ciento\b/.test(qn) && /\bpacifico\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b4 por ciento\b/.test(qn) && /\b(east cape|cabo del este|mercado)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b6 por ciento\b/.test(qn) && /\bvolumen\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bprecio medio\b/.test(qn) && /\b(mls|jll|casas)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bno es consejo de inversion\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(588|812|1079|990|345|142)\b/.test(qn) && /\bregistros?\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b31 de agosto de 2026\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bsedatu\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(segundo polo|mayor superficie|polo norte|eje hotelero)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(puerta de demanda|brownfield)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(frontera de urbanizacion|motor dominante|riego historico|veto de diseno|planear hoteles)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno son un anexo\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcierran\b/.test(qn) && /\b(dragado|mineria)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(24\.06961|12\.493828|13\.488404|2\.964513|2\.286941|0\.298386|0\.107682|0\.497182)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(no es aforo|balance legal)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b17 de agosto\b/.test(qn) && /\b(dof|acuerdo|promedia)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b688\.5\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b0\.6 por ciento\b/.test(qn) && /\b(sjd|san jose|llegadas)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(lto desconocido|no se suman)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(diez de abril de 1980|veinte de agosto de 1992|seis de junio de 1995|treinta de noviembre de 1988)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(169|283)\b/.test(qn) && /\b(costa|proteg|stills|fotograf|muestra)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b222\b/.test(qn) && /\b(stills|desierto|cuadros)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b165\b/.test(qn) && /\bvizcaino\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(16[,.]?588|146 sumideros|no caudales)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b(3996|3[,.]?996|1973|bcs55)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsegunda actualizacion\b/.test(qn) && /\boperativa\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(12 de marzo de 2014)\b/.test(qn) || (/\bpoel\b/.test(qn) && /\b2014\b/.test(qn) && !factorKinds.length)) factorKinds.push('landuse');
  if (/\b(techo de cuartos|evidencia cuantitativa incompleta|capa sur no trae)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(corredor remoto|solo transito|probarse contra el agua local)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bbalance municipal\b/.test(qn) && /\bmulege\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bintensificar\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bflanco\b/.test(qn) && /\b(east cape|cabo del este)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\banclar\b/.test(qn) && /\b(puerto|crecimiento)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bantes de abrir\b/.test(qn) && /\bagua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bgestionar la demanda\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\babasto urbano depende\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\btension de vocacion\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bconfiabilidad\b/.test(qn) && /\bcfe\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bfuera del sur turistico\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(egresos estatales|no es capacidad de obra)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b30 de septiembre de 2026\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(regeneracion y biodiversidad|hospitalidad)\b/.test(qn) && /\bmesas?\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(iter|pobtot)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bgaleria de ciclones\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(tabla letra|moe56|69 poligonos|rt no esta)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bregimen fonatur\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\brenombre\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(libramiento|repaviment)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b350 millones\b/.test(qn) && /\bcarretera/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b2047\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(inicios de 2027|60 por ciento de avance|sin ficha tecnica|potabilizadora)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpueblos magicos\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(37500|37[,.]?500 acciones|55 mil viviendas)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b2039\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(cuellos de transmision|fuente del candado|dos por 230|cuello que separa)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(opera debajo|techo sobre los planes)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bmarco estatal del agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno sustituye\b/.test(qn) && /\bordenamiento\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bpermisos\b/.test(qn) && /\binventario\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\brecuadro sin nombre\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsin megaproyecto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bacuerdos de disponibilidad\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(proyectado en 76|turistas de estados unidos bajaron|octubre proyectado)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(10|31) registros\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b(picos estacionales|conectividad norte sur)\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bconvocatoria publica\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bcartografia\b/.test(qn) && /\bbarriles\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bventana politica del sexenio\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b213\b/.test(qn) && /\b(anp|proteg)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b166\b/.test(qn) && /\bdesierto\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\ben la muestra\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(13 asentamientos|39 resorts|20 cruces)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b15\b/.test(qn) && /\bloreto\b/.test(qn) && /\bcosta\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b10 resorts\b/.test(qn) && /\b(east cape|cabo del este)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdof\b/.test(qn) && /\b2 de julio\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btipo tres\b/.test(qn) && /\bveda\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcapa juridica\b/.test(qn) && /\b1954\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bnom once\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno se promedia\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(sin confirmar|marca por confirmar)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bobra instruida\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\balerta del pico\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bjunio de? 2026\b/.test(qn) && /\b(paso|glorieta|meta)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(brecha del monto|monto sict)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b100 por ciento\b/.test(qn) && /\bsal\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b40[,.]?000 hectareas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\blaudo\b/.test(qn) && /\bseptiembre\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b1995\b/.test(qn) && /\b(parque|pulmo|decreto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b1988\b/.test(qn) && /\breserva\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(pm|programa de manejo)\b/.test(qn) && /\b(en blanco|falta|todavia no|sin texto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\breglamento interior\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bgilbert\b/.test(qn) && /\bgibert\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bbeatriz\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b23 de abril\b/.test(qn) && /\b(cabildo|pdu|boge|actualizacion)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b20 de diciembre\b/.test(qn) && /\b(acta|texto|cabildo|pmdu)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bgazette\b/.test(qn) && /\bloreto\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bactualizacion 2024\b/.test(qn) && /\bconsulta\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bempleo local\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno desglosa\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno se reclama\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\blectura desconocida\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bscorecard\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\brestringid/.test(qn) && /\b0317\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpducp 2018\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcomo anclas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bdossier\b/.test(qn) && /\bvocacion\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bacceso\b/.test(qn) && /\bcorredor\b/.test(qn) && /\b(east cape|cabo del este)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcrecimiento cabe\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bregeneracion y biodiversidad\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\burbanizacion\b/.test(qn) && /\bmesa\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bhitos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno es ageb\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpredios comparables\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(diez sufijos|10 sufijos)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\brestauracion\b/.test(qn) && /\b(ocr|tabla)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\baprovechamiento sustentable\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bsigla as\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bpermisos\b/.test(qn) && /\b(faltan|montos)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcapas vectoriales\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bmalla\b/.test(qn) && /\b(sismica|ciclon|inundacion)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bsecuencia\b/.test(qn) && /\b(loreto|sismo|sismica)\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\b4\.6\b/.test(qn) && /\b4\.3\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bnoventa y seis ejidos\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bkml\b/.test(qn) && !factorKinds.length) factorKinds.push('risk');
  if (/\bcuatro mil hectareas\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcincuenta y seis\b/.test(qn) && /\b(uga|unidades)\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\balinea\b/.test(qn) && /\bplaneacion\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\btensionado\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bcoherenciar\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\bconvenio\b/.test(qn) && /\bordenamiento local\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\boperadores municipales\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsistema interconectado\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno unificado\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpresa\b/.test(qn) && /\b(ficha|hectometros)\b/.test(qn) && /\bfalta\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bconclusion anunciada\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b70 por ciento\b/.test(qn) && /\b(carga|puerto)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bnombre oficial\b/.test(qn) && /\bsict\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpor kilometro\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(senalamiento|señalamiento)\b/.test(qn) && /\bpuentes\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bsin desglose\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcapex\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno unificadas\b/.test(qn) && /\bvivienda\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\b134 millones\b/.test(qn) && /\b2026\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b44 proyectos\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bno es ejecucion\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(desbloquea|solo sostiene|oferta neta|sustitucion)\b/.test(qn) && /\b(desal|oferta)/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bque cabe\b/.test(qn) && /\bventana\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bcoherencia entre\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (/\b(regenera o solo mitiga|listo para app|readiness)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\b(condiciona el desierto|no de la densidad|densificacion observada)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bfamilias de agua\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\bpaquete de\b/.test(qn) && /\b(east cape|cabo del este|loreto|mulege)\b/.test(qn) && !factorKinds.length) factorKinds.push('viability');
  if (/\boportunidades ya codificadas\b/.test(qn) && !factorKinds.length) factorKinds.push('opportunity');
  if (/\bpoliticas nombradas\b/.test(qn) && !factorKinds.length) factorKinds.push('landuse');
  if (whoFactor && LANDUSE_RE.test(qn) && !factorKinds.includes('landuse')) factorKinds.push('landuse');
  const isFactorIntent = factorKinds.length > 0;
  if (isFactorIntent) {
    isOpenIntent = true;
    if (!/\b(cuant[oa]|cifra|hm3|hm\s|pib|pibe|mdp|porcentaje)\b/.test(qn)) {
      isFactIntent = false;
    }
    for (const e of [
      'viabilidad', 'factibilidad', 'uso', 'suelo', 'zonificacion', 'riesgo', 'riesgos',
      'oportunidad', 'oportunidades', 'poer', 'pdu', 'dma', 'sibcs', 'anp', 'factor',
    ]) {
      set.add(e);
    }
  }

  const isLibraryIntent = LIB_INTENT_RE.test(qn);
  return {
    tokens: [...set],
    isLibraryIntent,
    isFactorIntent,
    factorKinds,
    isDemoIntent,
    isWaterIntent,
    isWaterQuantityIntent,
    isPoerIntent,
    isPlanningIntent: isPlanningIntent || isPoerIntent,
    isEnergyIntent,
    isTourismAnpIntent,
    isGrowthConstraintIntent,
    isEconomyIntent,
    isFacetIntent,
    facetTypes,
    isFactIntent: isFactIntent && !isSpatialIntent,
    isOpenIntent,
    isScenarioIntent,
    isSpatialIntent,
    rawTokens: base,
    placeTokens,
  };
}

function normHay(chunk, lang) {
  const raw = [
    chunk.title || '',
    chunk.path || '',
    chunk.theme || '',
    lang === 'en' ? chunk.sum_en || chunk.sum_es : chunk.sum_es || chunk.sum_en,
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalizeNumberForms(raw);
}

function scoreChunk(tokens, chunk, lang, intents, placeTokens) {
  const hay = normHay(chunk, lang);
  const title = (chunk.title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const path = (chunk.path || '').toLowerCase();
  const theme = (chunk.theme || '').toLowerCase();
  const sum = (
    lang === 'en' ? chunk.sum_en || chunk.sum_es : chunk.sum_es || chunk.sum_en || ''
  )
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let score = 0;
  let matched = 0;
  let nonPlaceHits = 0;
  let placeHits = 0;
  let titleHits = 0;
  let sumHits = 0;
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (!hay.includes(t)) continue;
    matched += 1;
    const isPlace = PLACE_ONLY.has(t) || (placeTokens && placeTokens.has(t));
    if (isPlace) placeHits += 1;
    else nonPlaceHits += 1;
    score += 1;
    if (title.includes(t)) {
      score += 2.5;
      titleHits += 1;
    }
    if (path.includes(t)) score += 1.2;
    if (theme.includes(t)) score += 1.5;
    if (sum.includes(t)) {
      score += 1.8;
      sumHits += 1;
    }
  }

  if (chunk.type === 'guide') score += 0.8;
  const isLibIntent = !!(intents && intents.isLibraryIntent);
  if (chunk.type === 'library') {
    // International / methodological references: strong when asked, mild otherwise
    if (isLibIntent) score += 4 + Math.min(titleHits, 3) * 1.5;
    else score *= 0.75;
  }
  if (chunk.type === 'fact') {
    score += 3.5;
    if (intents && intents.isFactIntent) score += 6;
    // Metric-token hits on fact cards
    const metricHay = `${chunk.metric || ''} ${chunk.title || ''} ${chunk.value || ''}`.toLowerCase();
    for (const t of tokens) {
      if (t.length > 3 && metricHay.includes(t)) score += 2.5;
    }
  }
  const isSpatialIntent = !!(intents && intents.isSpatialIntent);
  if (chunk.type === 'still') {
    if (
      isSpatialIntent ||
      tokens.some((t) =>
        ['mapa', 'mapas', 'cartografia', 'cartography', 'map', 'still', 'stills', 'gis', 'satelite', 'imagen', 'vista', 'earth', 'studio', 'ubicacion'].includes(t)
      )
    ) {
      score += isSpatialIntent ? 10 : 4;
    }
  }
  // Map/GIS portal guides & gallery JPGs
  if (
    isSpatialIntent &&
    (/portal\/(mapas|stills|earth-studio|studio)|stills\/|mapas#|earth-studio|cartograf|\bgis\b/i.test(
      path + ' ' + (chunk.id || '') + ' ' + title
    ) ||
      (chunk.href && /\/(mapas|stills|earth-studio|studio)/.test(chunk.href)))
  ) {
    score += 8;
  }
  if (chunk.type === 'municipio') score += 1.5;
  if (chunk.type === 'ontology') score += 1.2;

  // Demote weak filename-only matches (path/title token hits without summary substance)
  if (matched > 0 && sumHits === 0 && titleHits <= 1 && chunk.type === 'file') {
    score *= 0.45;
  }

  const demoPath = DEMO_PATH_RE.test(path + ' ' + theme + ' ' + title);
  const weakPlace = WEAK_PLACE_PATH_RE.test(path + ' ' + title);

  const isDemoIntent = !!(intents && intents.isDemoIntent);
  const isWaterIntent = !!(intents && intents.isWaterIntent);
  const isPoerIntent = !!(intents && intents.isPoerIntent);
  const isPlanningIntent = !!(intents && intents.isPlanningIntent);
  const isEnergyIntent = !!(intents && intents.isEnergyIntent);
  const isTourismAnpIntent = !!(intents && intents.isTourismAnpIntent);
  const isGrowthConstraintIntent = !!(intents && intents.isGrowthConstraintIntent);
  const isEconomyIntent = !!(intents && intents.isEconomyIntent);
  const isOpenIntent = !!(intents && intents.isOpenIntent);
  const isWaterQuantityIntent = !!(intents && intents.isWaterQuantityIntent);

  if (isDemoIntent) {
    if (demoPath || chunk.type === 'municipio' || theme.includes('demograf') || theme.includes('territorio')) {
      score += 8;
    }
    if (weakPlace && nonPlaceHits < 2) {
      score *= 0.25;
    }
    // Pure population Q: demote water/energy ontology so census wins
    if (!isWaterIntent && chunk.type === 'ontology' && /acuifero|dma|agua|sibcs|energi/i.test((chunk.id || '') + title + sum)) {
      score *= 0.15;
    }
  }

  if (isWaterIntent) {
    const hayPathTheme = path + ' ' + theme + ' ' + title;
    if (WATER_PATH_RE.test(hayPathTheme) || WATER_TITLE_RE.test(title + ' ' + sum)) {
      score += isWaterQuantityIntent ? 12 : 8;
    }
    if (
      chunk.type === 'ontology' ||
      /resourcecapacity|constraint|rc_acuifero|const_dma|const_escasez/i.test(
        (chunk.id || '') + ' ' + theme + ' ' + path
      )
    ) {
      score += isWaterQuantityIntent ? 14 : 8;
    }
    if (/guides\/agua/i.test(path)) score += 10;
    if (/02_water/i.test(path) && /conagua|dma|cea|oomsapas/i.test(title + path)) score += 6;
    if (
      !isDemoIntent &&
      (chunk.type === 'municipio' ||
        /demograf|censo|poblacion|inegi|coneval|05_demographics|panorama_sociodemografico/i.test(
          path + ' ' + theme + ' ' + title
        ))
    ) {
      score *= 0.08;
    }
    if (isWaterQuantityIntent && /hm\s*³|hm3|dma|d[eé]ficit|−\d|−\d/.test(sum + title)) {
      score += 5;
    }
  }

  if (isPoerIntent || isPlanningIntent) {
    if (/poer|ordenamiento|uga|01_planning|pdu|guides\/planeacion/i.test(path + ' ' + title + ' ' + sum)) {
      score += 6;
    }
    if (chunk.type === 'ontology' && /instrument|pdu|poer|constraint|territory/i.test((chunk.id || '') + (chunk.onto_type || '') + title)) {
      score += 5;
    }
  }

  if (isEnergyIntent) {
    if (/03_energy|sibcs|cfe|cenace|prodesen|pamrnt|guides\/energia|energia/i.test(path + ' ' + theme + ' ' + title + ' ' + sum)) {
      score += 7;
    }
    if (chunk.type === 'ontology' && /sibcs|energi|cfe|red_aislada|prodesen/i.test((chunk.id || '') + title + sum)) {
      score += 8;
    }
  }

  if (isEconomyIntent) {
    if (
      theme.includes('economia') ||
      /guides\/economia|07_economy|pibe|pib_|itaee|ied|enoe|setue/i.test(path + ' ' + title)
    ) {
      score += 10;
    }
    if (chunk.type === 'guide' && /economia|pib|pibe|vab|ied/i.test(path + ' ' + title + ' ' + sum)) {
      score += 8;
    }
    if (/187152|181155|millones de pesos|valores constantes/i.test(sum)) {
      score += 6;
    }
    // Demote pure demography census stubs when asking economy (keep PIBE paths)
    if (
      !/pibe|pib_|07_economy|economia/i.test(path + ' ' + title) &&
      (chunk.type === 'municipio' ||
        /05_demographics|censo|poblacion|coneval|panorama_sociodemografico|habitante/i.test(
          path + ' ' + theme + ' ' + title
        ))
    ) {
      score *= 0.12;
    }
  }

  if (isTourismAnpIntent) {
    if (/anp|proteg|turismo|stills|ambiente|06_environment|conanp|pulmo|vizcaino|costa|coast/i.test(path + ' ' + theme + ' ' + title + ' ' + sum)) {
      score += 7;
    }
    if (chunk.type === 'ontology' && /anp|turismo|coast|proteg|const_coast|const_anp/i.test((chunk.id || '') + title + sum)) {
      score += 10;
    }
    if (chunk.type === 'still') score += 4;
  }

  if (isSpatialIntent) {
    if (chunk.type === 'still') score += 8;
    if (
      chunk.type === 'ontology' &&
      /Territory|terr_|terr_obs_|ev_stills|const_coast/i.test(
        (chunk.id || '') + (chunk.onto_type || '') + title + sum
      )
    ) {
      score += 12;
    }
    if (/portal\/(mapas|stills|earth|studio)|guides\/territorio|stills\/municipio|stillmuni:|still:overview|map-gallery/i.test(
      (chunk.id || '') + path + title
    )) {
      score += 9;
    }
    // Soft-demote pure economy/demo stubs on spatial asks
    if (chunk.type === 'fact' || chunk.type === 'municipio') score *= 0.55;
    if (chunk.type === 'file' && !/mapa|gis|cartograf|anp|poer|pdu/i.test(title + path)) score *= 0.5;
  }

  if (isGrowthConstraintIntent || (isOpenIntent && placeTokens && placeTokens.has('cabos'))) {
    if (chunk.type === 'ontology' && /constraint|const_|pdu|dma|sibcs|escasez|tenencia|capacidad/i.test((chunk.id || '') + title + sum)) {
      score += 10;
    }
    if (/guides\/(agua|planeacion|energia|ambiente)|01_planning|02_water|03_energy/i.test(path)) {
      score += 5;
    }
  }

  // Open questions: mild boost for ontology cards and guides (synthesis material)
  if (isOpenIntent && (chunk.type === 'ontology' || chunk.type === 'guide')) {
    score += 3;
  }

  if (placeTokens && placeTokens.size) {
    let placeInChunk = 0;
    for (const pt of placeTokens) {
      if (hay.includes(pt)) placeInChunk += 1;
    }
    const statewide =
      /guides\/(agua|planeacion|territorio|ambiente|energia|economia)\.md/i.test(path) ||
      /poerbcs|estado|bcs\b|peninsular/i.test(title) ||
      chunk.type === 'ontology' ||
      (chunk.type === 'library' && isLibIntent);
    if (placeInChunk > 0) {
      score += 5 + placeInChunk * 2.5;
    } else if (statewide && (isWaterIntent || isPoerIntent || isDemoIntent || isOpenIntent || isEnergyIntent || isEconomyIntent)) {
      score += 2;
    } else if (nonPlaceHits > 0 && chunk.type !== 'ontology') {
      score *= 0.05;
    }
  }

  if (matched > 0 && nonPlaceHits === 0) {
    score *= 0.35;
  } else if (matched > 0 && nonPlaceHits === 1 && matched <= 3) {
    score *= 0.7;
  }

  if (isDemoIntent && /\d{4,}/.test(sum)) {
    score += 3;
  }

  return score;
}

function folderKey(chunk) {
  const p = chunk.path || '';
  const parts = p.split('/');
  if (parts[0] === 'guides') return 'guides/' + (parts[1] || '').split('#')[0];
  if (parts[0] === 'municipios') return 'municipios/' + (parts[1] || '');
  if (parts[0] === '05_demographics') return '05_demographics';
  if (parts[0] === '12_ontology') return '12_ontology';
  if (parts[0] === '13_library') return p.split('#')[0];
  return parts.slice(0, 2).join('/');
}

/** Score ontology graph nodes by term overlap; expand with 1-hop neighbors. */
function pickOntologyNodeIds(tokens, placeTokens, reserved = 4, facetTypes = null) {
  const wantTypes = Array.isArray(facetTypes) && facetTypes.length ? new Set(facetTypes) : null;
  const scored = [];
  for (const n of GRAPH_NODES) {
    const hay = `${n.id} ${n.type} ${n.label || ''} ${n.label_en || ''} ${n.summary || ''} ${n.summary_en || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    let s = 0;
    for (const t of tokens) {
      if (hay.includes(t)) {
        s += 2;
        if ((n.label || '').toLowerCase().includes(t)) s += 2;
        if ((n.type || '').toLowerCase().includes(t)) s += 1;
      }
    }
    if (placeTokens && placeTokens.size) {
      for (const pt of placeTokens) {
        if (hay.includes(pt)) s += 4;
      }
    }
    // Soft prior for constraint / capacity / instrument / demand types
    if (/Constraint|ResourceCapacity|Instrument|DemandDriver|Actor/i.test(n.type || '')) s += 0.5;
    // Facet intent: hard-boost matching ontology types
    if (wantTypes && wantTypes.has(n.type)) s += 8;
    else if (wantTypes && s > 0) s *= 0.35; // demote off-facet when facet is explicit
    // Never attach La Paz PDU when the question is about Los Cabos (and vice versa)
    if (placeTokens && placeTokens.size) {
      const cabosQ = placeTokens.has('cabos') || placeTokens.has('lucas') || placeTokens.has('jose');
      const pazQ = placeTokens.has('paz') && !cabosQ;
      if (cabosQ && /inst_pdu_lapaz|terr_la_paz|actor_ayunt_lapaz|actor_implan.*lapaz|dd_turismo_lapaz/i.test(n.id)) {
        s *= 0.08;
      }
      if (pazQ && /inst_pdu_cabos|terr_los_cabos|actor_ayunt_cabos|actor_implan_cabos|dd_turismo_cabos|dd_residencial_cabos/i.test(n.id)) {
        s *= 0.08;
      }
      if (cabosQ && n.id === 'inst_pdu_cabos') s += 8;
      if (pazQ && n.id === 'inst_pdu_lapaz') s += 8;
    }
    if (s > 0) scored.push({ s, id: n.id, type: n.type });
  }
  scored.sort((a, b) => b.s - a.s);
  // Prefer facet-typed seeds when facet intent is on
  let seedPool = scored;
  if (wantTypes) {
    const typed = scored.filter((x) => wantTypes.has(x.type));
    if (typed.length) seedPool = [...typed, ...scored.filter((x) => !wantTypes.has(x.type))];
  }
  const seed = seedPool.slice(0, Math.max(reserved, 3)).map((x) => x.id);

  // 2-hop BFS from seeds; cap total ontology slots (~8)
  const cap = Math.max(reserved + 4, 8);
  const out = [];
  const seen = new Set();
  const queue = [];
  for (const id of seed) {
    queue.push({ id, depth: 0 });
    seen.add(id);
  }
  while (queue.length && out.length < cap) {
    const { id, depth } = queue.shift();
    out.push(id);
    if (depth >= 2) continue;
    const neigh = ADJ.get(id) || [];
    for (const { id: nid } of neigh) {
      if (seen.has(nid)) continue;
      // On facet queries, prefer neighbors that are facet type or Constraint/ResourceCapacity
      if (wantTypes) {
        const nt = (NODE_BY_ID.get(nid) || {}).type || '';
        if (
          depth === 0 ||
          wantTypes.has(nt) ||
          /Constraint|ResourceCapacity|DemandDriver|Actor|Instrument/i.test(nt)
        ) {
          seen.add(nid);
          queue.push({ id: nid, depth: depth + 1 });
        } else {
          seen.add(nid);
          queue.push({ id: nid, depth: depth + 1 });
        }
      } else {
        seen.add(nid);
        queue.push({ id: nid, depth: depth + 1 });
      }
      if (out.length + queue.length >= cap * 2) break;
    }
  }
  return out.slice(0, cap);
}

function factorPredBase(pred) {
  return String(pred || '').replace(/_of$/, '');
}

function factorPlaceFlags(qn) {
  const east = /\b(east cape|cabo del este|cabo pulmo|la ribera|los barriles|barriles)\b/.test(qn);
  const cabos = /\b(los cabos|cabo san lucas|san jose(?: del cabo)?|sjd)\b/.test(qn);
  const paz = /\bla paz\b/.test(qn) || /\bsan juan de la costa\b/.test(qn);
  const loreto = /\b(loreto|nopolo)\b/.test(qn);
  const comondu = /\bcomondu\b/.test(qn)
    || /\bciudad insurgentes\b/.test(qn)
    || /\bpuerto (de )?san carlos\b/.test(qn)
    || (/\b(ciudad constitucion|constitucion)\b/.test(qn) && !/\bconstitucion (politica|del estado)\b/.test(qn));
  const mulege = /\b(mulege|santa rosalia|vizcaino|guerrero negro)\b/.test(qn);
  const todos = /\b(todos santos|pescadero|playitas)\b/.test(qn);
  const nPlaces = [cabos, paz, loreto, comondu, mulege, todos, east].filter(Boolean).length;
  const compare = (/\b(cinco municipios|cinco polos)\b/.test(qn) && FACTOR_COMPARE_RE.test(qn))
    || (nPlaces >= 2 && (FACTOR_COMPARE_RE.test(qn) || /\b(versus|\bvs\b|diferencia entre)\b/.test(qn)));
  const who = /\b(quien (decide|opera|autoriza|gobierna)|who (decides|operates|runs)|titular)\b/.test(qn);
  return {
    cabos, paz, loreto, comondu, mulege, todos, east, compare, who,
    any: nPlaces > 0,
  };
}

function factorExcluded(id, place) {
  if (!place.any || place.compare) return false;
  if (place.cabos && place.paz && /aeropuerto_(sjd|lap)/.test(id)) return false;
  const cabosId = /(?:^|_)cabos(?:_|$)|0317|0319|oomsapas_cabos|implan_cabos|aeropuerto_sjd/.test(id) && !/tx_lapaz/.test(id);
  const pazId = /lapaz|la_paz|0324|turismo_lapaz|aeropuerto_lap/.test(id) && !/tx_lapaz/.test(id);
  const otherThanPaz = place.east || place.cabos || place.loreto || place.mulege || place.comondu;
  const otherThanCabos = place.paz || place.todos || place.loreto || place.mulege || place.comondu;
  // Naming both sides keeps each side. A single-place question still drops the other coast.
  if (pazId && !place.paz && otherThanPaz) return true;
  if (cabosId && !place.cabos && !place.east && otherThanCabos) return true;
  return false;
}

function diversifyOntologyIds(ids, cap) {
  const buckets = new Map();
  for (const id of ids) {
    const t = (NODE_BY_ID.get(id) || {}).type || 'Other';
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(id);
  }
  const order = [
    'DecisionQuestion', 'Constraint', 'ResourceCapacity', 'Instrument',
    'DemandDriver', 'Project', 'Territory', 'Actor', 'Evidence',
  ];
  const out = [];
  let progressed = true;
  while (out.length < cap && progressed) {
    progressed = false;
    for (const t of order) {
      const b = buckets.get(t);
      if (b && b.length) {
        out.push(b.shift());
        progressed = true;
        if (out.length >= cap) break;
      }
    }
    if (!progressed) {
      for (const b of buckets.values()) {
        while (b.length && out.length < cap) out.push(b.shift());
      }
    }
  }
  return out;
}

/** Seeds + 2-hop along factor predicates. Depth-0 seeds are kept; neighbors fill remaining slots by type. */
function walkFactorBundle(seedIds, place, cap = 14) {
  const seeds = [];
  const seen = new Set();
  const queue = [];
  for (const id of seedIds) {
    if (!NODE_BY_ID.has(id) || seen.has(id) || factorExcluded(id, place)) continue;
    seen.add(id);
    queue.push({ id, depth: 0 });
  }
  const extra = [];
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (depth === 0) seeds.push(id);
    else extra.push(id);
    if (depth >= 2) continue;
    for (const { pred, id: nid } of ADJ.get(id) || []) {
      if (!FACTOR_WALK.has(factorPredBase(pred))) continue;
      if (seen.has(nid) || !NODE_BY_ID.has(nid) || factorExcluded(nid, place)) continue;
      seen.add(nid);
      queue.push({ id: nid, depth: depth + 1 });
    }
  }
  const kept = seeds.slice(0, cap);
  const rest = diversifyOntologyIds(extra.filter((id) => !kept.includes(id)), Math.max(0, cap - kept.length));
  return [...kept, ...rest];
}

function factorSeedIds(qn, kinds) {
  const p = factorPlaceFlags(qn);
  const seeds = [];
  const add = (...ids) => {
    for (const id of ids) if (id && !seeds.includes(id)) seeds.push(id);
  };
  const kindHit = PROJECT_KIND_RE.test(qn);
  if (/\b(poblacion|habitantes|censo|demograf)\b/.test(qn) && !/\b89 mil\b/.test(qn)) add('ev_pob_censo_2020');
  if (/\brenta hotel|\bcap rate|\bocupacion(?: de)? hotel|\brenta por noche|\bprecio por noche/.test(qn)) add('gap_rentas_hoteleras', 'ev_news_ocupacion');
  if (/\bturbinas? moviles?\b|\bgeneracion movil\b|\bcabo bello\b|\bturbogas\b/.test(qn) || (/\b128\b/.test(qn) && /\b(mw|megawatts?)\b/.test(qn))) {
    add('ev_news_cfe_128', 'rc_sibcs', 'const_red_aislada');
  }
  if (/\b(oasis|hidrogen)/.test(qn)) add('ev_sig_mulege_oasis', 'gap_mulege_agua_energia');
  if (p.loreto && /\b(pasajer|pax|viajer|total de pasajeros)\b/.test(qn)) {
    add('gap_loreto_pax', 'ev_aereo_setue', 'ev_dossiers_movilidad');
  }
  if (/\b0302\b/.test(qn) || (/\bacuifero vizcaino\b/.test(qn) && p.mulege)) {
    add('gap_acuifero_0302', 'ev_acuiferos_dma');
  }
  if ((/\btitular\b|\bobras publicas\b/.test(qn)) && (p.cabos || !p.any)) {
    add('gap_org_obras_cabos', 'ev_org_cabos_2024');
  }
  if (/\b(ley de ingresos|presupuesto de egresos|participaciones?|anexo)\b/.test(qn) || (/\b(ingresos|ingresa)\b/.test(qn) && /\b2026\b/.test(qn))) {
    add('ev_fiscal_ley_2026', 'ev_fiscal_anexo_2025', 'gap_fiscal_ingresos_2026');
  }
  if (/\basipona\b/.test(qn)) add('ev_sig_asipona', 'proj_fed_pue_001', 'ev_cruceros_datatur');
  if (/\bdesal\w*/.test(qn) && /\b(250|litros|l\/s)\b/.test(qn)) add('proj_fed_agu_001', 'proj_desal_cabos', 'ev_mesa_agua');
  if (p.comondu && p.cabos && /\b(deficit|cubrir|compens\w*|offset)\b/.test(qn)) {
    add('ev_preguntas_estrategicas', 'terr_comondu', 'const_dma_deficit', 'dd_agro_santo_domingo');
  }
  if (/\bdestinos sin escala\b/.test(qn) || (/\bsjd\b/.test(qn) && /\bdestinos\b/.test(qn))) {
    add('ev_sig_vuelos', 'rc_aeropuerto_sjd', 'ev_aereo_setue');
  }
  if (/\b(isla electr\w*|red aislada|sistema aislado)\b/.test(qn)) add('rc_sibcs', 'const_red_aislada', 'ev_sig_sibcs', 'inst_prodesen');
  if (/\bbess\b/.test(qn)) add('rc_bess_gap');
  if (/\bel novillo\b/.test(qn)) add('proj_fed_agu_003');
  if (/\bdesal\w*/.test(qn) && p.paz) add('proj_fed_agu_002', 'rc_acuifero_0324');
  if (/\bptar\b/.test(qn) && p.loreto) add('proj_fed_agu_005', 'terr_loreto', 'gap_loreto_dma');
  if (/\bmesa del? agua\b/.test(qn)) add('ev_mesa_agua', 'actor_cea', 'actor_conagua');
  if (/\bimplan\b/.test(qn)) add('actor_implan_cabos', 'ev_mesa_urbanismo', 'inst_pdu_cabos', 'ev_org_cabos_2024');
  if (/\b(segunda residencia|segundas residencias|segunda casa|segundas casas|second homes?)\b/.test(qn)) add('dd_residencial_cabos', 'ev_inmob_jll_2025');
  if (/\bturismo\b/.test(qn) && p.paz) add('dd_turismo_lapaz', 'rc_acuifero_0324');
  if (/\bturismo\b/.test(qn) && p.cabos) add('dd_turismo_cabos', 'const_dma_deficit');
  if (/\bforo\b/.test(qn)) add('dd_eventos_foro', 'dq_oportunidades');
  if (/\bforo\b/.test(qn) && /\b(noviembre|ayuntamiento)\b/.test(qn)) add('dq_agenda_politica');
  if (/\bjll\b/.test(qn) && (p.todos || /\bpacifico\b/.test(qn))) add('terr_todos_santos', 'ev_jll_zonas_2025');
  if (/\b(playitas|san juan de la costa|programa subregional)\b/.test(qn)) {
    add('ev_peotdu_instrumentos', 'inst_pdu_lapaz', 'terr_todos_santos');
  }
  if (/\bveda\b/.test(qn) && /\b1954\b/.test(qn)) add('inst_veda_1954');
  if (/\bintrusion (marina|salina)\b/.test(qn)) add('const_intrusion_marina', 'rc_acuifero_0324');
  if (/\btenencia\b/.test(qn) && /\b(barriles|cardonal)\b/.test(qn)) add('const_tenencia', 'ev_psdu_barriles');
  if (/\bcabo pulmo\b/.test(qn) && /\bbahia de loreto\b/.test(qn)) {
    add('terr_anp_cabo_pulmo', 'terr_anp_loreto', 'const_anp_nucleos');
  }
  if (/\bdossier\b/.test(qn) && p.mulege) add('ev_dossiers_lugar', 'terr_mulege', 'gap_mulege_agua_energia');
  if (/\bdossier\b/.test(qn) && p.loreto) add('ev_dossiers_lugar', 'terr_loreto', 'gap_loreto_dma');
  if (/\bdesierto de evidencia\b/.test(qn)) add('ev_dossiers_movilidad', 'terr_mulege', 'gap_mulege_agua_energia');
  if (/\borientacion aerea\b/.test(qn)) add('ev_orientacion_aerea', 'dq_riesgos_principales', 'dq_cambio_uso_suelo');
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\becologia\b/.test(qn)) {
    add('actor_cabos_dg_ecologia', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'inst_poel_cabos', 'terr_los_cabos');
  }
  if (p.cabos && /\b(dirige|lleva|titular|quien)\b/.test(qn) && /\bcatastro\b/.test(qn)) {
    add('ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos', 'inst_pdu_cabos');
  }
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\bdesarrollo urbano\b/.test(qn)) {
    add('actor_cabos_dg_desarrollo_urbano', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'inst_pdu_cabos', 'actor_ayunt_cabos', 'terr_los_cabos');
  }
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\bfomento economico\b/.test(qn)) {
    add('actor_cabos_dg_fomento_economico', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos');
  }
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\bdesarrollo social\b/.test(qn)) {
    add('actor_cabos_dg_desarrollo_social', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos');
  }
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\bservicios publicos\b/.test(qn)) {
    add('actor_cabos_dg_servicios_publicos', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos');
  }
  if (p.cabos && /\b(dirige|titular)\b/.test(qn) && /\bseguridad publica\b/.test(qn)) {
    add('actor_cabos_dg_seguridad_publica', 'ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos');
  }
  if (p.cabos && /\bpresidencia\b/.test(qn)) {
    add('actor_cabos_presidencia', 'ev_org_cabos_2024', 'actor_ayunt_cabos', 'terr_los_cabos', 'actor_implan_cabos', 'actor_oomsapas_cabos');
  }
  if (/\borganigrama\b/.test(qn) && (p.cabos || !p.any)) add('ev_organigrama_cabos', 'ev_org_cabos_2024', 'gap_org_obras_cabos');
  if (/\b(delegad\w*|delegacion\w*|miraflores)\b/.test(qn) && (p.cabos || p.east || /\b(miraflores|santiago|la ribera|cabo san lucas)\b/.test(qn))) {
    add('actor_cabos_delegaciones', 'actor_cabos_presidencia', 'ev_org_cabos_2024', 'actor_ayunt_cabos', 'terr_los_cabos');
  }
  if (/\b(asentamientos humanos|direccion general de obras)\b/.test(qn)) {
    add('actor_cabos_dg_obras_publicas', 'gap_org_obras_cabos', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  }
  if (/\b(apff|flora y fauna|area de proteccion)\b/.test(qn) && /\bcabo san lucas\b/.test(qn)) add('terr_anp_apff_csl', 'terr_los_cabos', 'inst_poerbcs');
  if (/\bcorredor hotelero\b/.test(qn) || (/\bcorredor\b/.test(qn) && /\bcabo san lucas\b/.test(qn) && /\bsan jose del cabo\b/.test(qn))) {
    add('terr_corredor_cabos', 'dd_turismo_cabos', 'terr_los_cabos');
  }
  if (/\bdensificacion costera\b/.test(qn)) add('dq_stills_densification', 'terr_obs_cabos_coast', 'terr_los_cabos', 'dd_turismo_cabos');
  if (/\bprograma de manejo\b/.test(qn)) {
    add('ev_anp_pm', 'ev_anp_avisos', 'const_anp_nucleos');
    if (/\bcabo pulmo\b/.test(qn)) add('terr_anp_cabo_pulmo');
    if (/\bvizcaino\b/.test(qn)) add('terr_anp_vizcaino');
    if (/\bsierra la laguna\b/.test(qn)) add('terr_anp_sierra_laguna');
    if (/\bbahia de loreto\b/.test(qn) || (/\bloreto\b/.test(qn) && /\bparque\b/.test(qn))) add('terr_anp_loreto');
  }
  if (/\bexpediente\b/.test(qn) && /\bpoer\b/.test(qn)) add('ev_poerbcs', 'inst_poerbcs', 'inst_poer_politicas');
  if (/\bplan estatal de desarrollo\b/.test(qn)) add('inst_ped', 'inst_poerbcs', 'actor_sepuimm');
  if (/\bprodesen\b/.test(qn)) add('ev_prodesen', 'rc_sibcs', 'const_red_aislada');
  if (/\bficha app\b/.test(qn) || (/\bdesal\w*/.test(qn) && /\bapp\b/.test(qn))) add('ev_desal_app', 'proj_desal_cabos', 'proj_fed_agu_001');
  if (/\bsetue\b/.test(qn)) add('ev_setue_ie', 'actor_setues', 'dd_turismo_cabos');
  if (/\bcenace\b/.test(qn)) add('actor_cenace', 'rc_sibcs', 'const_red_aislada');
  if (/\b(todos santos|pescadero)\b/.test(qn)) add('terr_todos_santos', 'rc_acuifero_0313');
  if (/\bla ribera\b/.test(qn) && /\b(pdu|poel|instrumento|plan)\b/.test(qn)) {
    add('gap_east_cape_instrumento', 'gap_east_cape_carga', 'ev_psdu_barriles');
  }
  if (/\bsantiago\b/.test(qn) && /\b(0320|acuifer)/.test(qn)) add('rc_acuifero_0320', 'ev_acuiferos_dma', 'inst_veda_1954');
  if (/\bconstitucion\b/.test(qn) && /\bagro\b/.test(qn)) add('terr_comondu', 'dd_agro_santo_domingo');
  if (/\bguerrero negro\b/.test(qn) && /\b(sal|essa|exportadora)\b/.test(qn)) add('proj_fed_min_003', 'terr_mulege');
  if (/\bsanta rosalia\b/.test(qn) && /\bpuerto/.test(qn)) add('ev_cruceros_datatur', 'terr_mulege');
  if (/\bcabo pulmo\b/.test(qn) && /\bsierra la laguna\b/.test(qn)) add('terr_anp_cabo_pulmo', 'terr_anp_sierra_laguna', 'const_anp_nucleos');
  if (p.east && p.paz) add('terr_obs_east_cape', 'terr_la_paz', 'gap_east_cape_carga');
  if (p.cabos && p.loreto && /\bagua\b/.test(qn)) add('terr_los_cabos', 'terr_loreto', 'gap_loreto_dma', 'const_dma_deficit');
  if (p.mulege && p.paz) add('terr_mulege', 'terr_la_paz', 'rc_acuifero_0324');
  if (p.todos && p.cabos) add('terr_todos_santos', 'terr_los_cabos');
  if (/\b(glorieta|paso a desnivel)\b/.test(qn)) add('proj_fed_car_002');
  if ((/\b70\b/.test(qn) && /\bmva\b/.test(qn)) || /\b(buenavista|cabo falso)\b/.test(qn)) {
    add('proj_fed_ene_008', 'proj_fed_ene_007', 'rc_sibcs');
  }
  if (/\bcapacidad de carga\b/.test(qn)) add('dq_capacidad_carga', 'const_dma_deficit', 'rc_sibcs', 'const_anp_nucleos');
  if (/\bintegridad ecologica\b/.test(qn)) {
    add('dq_integridad_ecologica', 'const_anp_nucleos');
    if (/\bsierra la laguna\b/.test(qn)) add('terr_anp_sierra_laguna');
  }
  if (/\blocalidades\b/.test(qn)) add('ev_communities_master');
  if (/\b(acuerdo|dof)\b/.test(qn) && /\b(dma|acuifer)\b/.test(qn)) {
    add('ev_dma', 'proj_fed_agu_008', 'ev_acuiferos_dma');
    if (p.paz || /\b0324\b/.test(qn)) add('rc_acuifero_0324');
  }
  if (/\binterconex\w*/.test(qn) && /\b(pausad\w*|sin|sistema interconectado)\b/.test(qn)) {
    add('proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada');
  }
  if (/\b(don diego|golfo de ulloa)\b/.test(qn)) add('proj_fed_min_002');
  if (/\bmujeres libres\b/.test(qn)) add('proj_fed_tur_002', 'proj_fed_car_002');
  if (/\b(stills|imagenes del territorio)\b/.test(qn)) add('ev_stills_intel', 'terr_obs_cabos_coast');
  if (p.east && p.loreto && /\baeropuerto/.test(qn)) add('ev_dossiers_movilidad', 'terr_obs_east_cape', 'terr_loreto');
  if (p.comondu && p.paz && /\b(agro|agua)\b/.test(qn)) add('terr_comondu', 'terr_la_paz', 'dd_agro_santo_domingo', 'rc_acuifero_0324');
  if (/\b0314\b/.test(qn)) add('ev_acuiferos_dma', 'const_dma_deficit', 'rc_acuifero_0313');
  if (/\b(escorrent|escurrimient)/.test(qn)) add('ev_escorrentia');
  if (/\bley de aguas\b/.test(qn)) add('inst_ley_aguas', 'actor_cea', 'actor_conagua');
  if (/\b(costa protegida|buffer)\b/.test(qn)) {
    add('dq_coast_anp_buffers', 'const_coast_anp_pressure');
    if (p.east || /\bcabo pulmo\b/.test(qn)) add('terr_anp_cabo_pulmo');
  }
  if (/\banuncio\b/.test(qn) && /\bfederal\b/.test(qn)) add('ev_federal_projects_inventory', 'inst_federal_pipeline');
  if (/\btecho regulatorio\b/.test(qn)) add('terr_bcs', 'inst_poerbcs', 'rc_sibcs', 'const_red_aislada');
  if (/\bnopolo\b/.test(qn)) add('terr_loreto', 'terr_anp_loreto', 'gap_loreto_dma');
  if (/\bciudad insurgentes\b/.test(qn)) add('terr_comondu', 'dd_agro_santo_domingo');
  if (/\bpuerto (de )?san carlos\b/.test(qn)) add('ev_sig_asipona', 'terr_comondu');
  if (/\bpamrnt\b/.test(qn)) add('inst_pamrnt', 'rc_sibcs', 'proj_p23_bs1', 'const_red_aislada');
  if (/\b(pducp|centro de poblacion|pmdu)\b/.test(qn) && p.paz) add('inst_pdu_lapaz', 'gap_pmdu_lapaz_texto', 'rc_acuifero_0324');
  if (/\bpmdu\b/.test(qn) && p.loreto) add('gap_psdu_loreto_gazette', 'terr_loreto');
  if (/\bpoel\b/.test(qn) && p.loreto) add('inst_poel_loreto', 'gap_psdu_loreto_gazette', 'terr_loreto', 'terr_anp_loreto');
  if (/\bescasez\b/.test(qn) && /\bagua\b/.test(qn)) add('const_escasez_agua', 'const_dma_deficit', 'ev_acuiferos_dma');
  if (/\b(se creo|se fundo|fundacion|decreto 181|1974)\b/.test(qn)) add('ev_historia_bcs');
  if (/\btercera actualizacion\b/.test(qn) && /\bpdu\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if ((/\b(subestacion|subestaciones)\b/.test(qn) || /\bmva\b/.test(qn)) && !/\b70\b/.test(qn) && !/\b(buenavista|cabo falso)\b/.test(qn)) {
    add('rc_subestaciones_gap', 'rc_sibcs');
  }
  if (/\bllaves\b/.test(qn)) add('rc_vivienda_cabos', 'const_dma_deficit', 'inst_pdu_cabos', 'dq_capacidad_carga');
  if (/\breuso\b/.test(qn)) {
    add('const_escasez_agua', 'const_dma_deficit', 'proj_desal_cabos');
    if (/\b(crece|alcanza|sustitu)\b/.test(qn)) add('dq_desal_vs_crecimiento', 'rc_sibcs');
  }
  if (/\bnom[-\s]?011\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\bdesal\w*/.test(qn) && /\b(crece|crecimiento|alcanza|sustitu)\b/.test(qn)) {
    add('dq_desal_vs_crecimiento', 'proj_desal_cabos', 'const_dma_deficit', 'rc_sibcs');
  }
  if (/\bvizcaino\b/.test(qn) && /\b(corredor|carretera|ensanche)\b/.test(qn)) {
    add('dq_vizcaino_corridor', 'proj_transpeninsular', 'terr_anp_vizcaino');
  }
  if (/\bapp\b/.test(qn) && /\b(lista|infraestructura|inversion)\b/.test(qn)) {
    add('dq_readiness_inversion', 'proj_desal_cabos', 'rc_sibcs', 'rc_aeropuerto_sjd');
  }
  if (p.cabos && p.mulege && /\b(energi\w*|agua|sibcs)\b/.test(qn)) {
    add('terr_los_cabos', 'terr_mulege', 'rc_sibcs', 'gap_mulege_agua_energia');
  }
  if (/\b(ayuntamiento|cabildo)\b/.test(qn) && p.comondu) add('actor_ayunt_comondu', 'terr_comondu', 'ev_fiscal_ley_2026');
  if (/\b(ayuntamiento|cabildo)\b/.test(qn) && p.mulege) add('actor_ayunt_mulege', 'terr_mulege', 'gap_fiscal_ingresos_2026');
  if (/\bmesa de energia\b/.test(qn)) add('ev_mesa_energia', 'actor_cfe', 'actor_cenace', 'rc_sibcs');
  if (/\bmesa de urbanismo\b/.test(qn)) add('ev_mesa_urbanismo', 'actor_implan_cabos', 'inst_pdu_cabos');
  if (/\bgap\b/.test(qn) && /\b(opera|concesion|aeropuerto)\b/.test(qn)) {
    add('rc_aeropuerto_sjd', 'rc_aeropuerto_lap', 'proj_fed_aer_001');
  }
  if (/\bagua primero\b|\bwater first\b/.test(qn)) add('ev_esc_water_first', 'const_dma_deficit');
  if (/\b(como vamos|seguimos como|trayectoria actual)\b/.test(qn)) add('ev_esc_baseline', 'dq_viabilidad_proyecto');
  if (/\briesgos?\b/.test(qn) && /\boportunidad/.test(qn)) add('dq_riesgos_principales', 'dq_oportunidades');
  if (/\bsierra la laguna\b/.test(qn) && /\b(recarga|integridad)\b/.test(qn)) {
    add('terr_anp_sierra_laguna', 'dq_integridad_ecologica', 'const_anp_nucleos');
  }
  if (/\bordenamiento ecologico\b/.test(qn) && p.loreto) add('inst_poel_loreto', 'gap_psdu_loreto_gazette', 'terr_loreto');
  else if (/\bordenamiento ecologico\b/.test(qn) && p.cabos) add('inst_poel_cabos', 'ev_sig_poel_cabos', 'terr_los_cabos');
  else if (/\bordenamiento ecologico\b/.test(qn)) add('inst_poerbcs', 'inst_poer_politicas', 'actor_sepuimm');
  if (/\b(amplia\w*|moderniz\w*)\b/.test(qn) && /\bred\b/.test(qn) && /\b(electric\w*|bcs|sibcs)\b/.test(qn)) {
    add('inst_pamrnt', 'rc_sibcs', 'const_red_aislada');
  }
  if ((/\bunion con la red nacional\b/.test(qn) || /\bsistema nacional\b/.test(qn)) && /\bpausad\w*/.test(qn)) {
    add('proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada');
  }
  if (/\b(cobra|opera)\b/.test(qn) && /\bagua\b/.test(qn) && (p.cabos || /\bcabo san lucas\b/.test(qn))) {
    add('actor_oomsapas_cabos', 'ev_mesa_agua');
  }
  if (/\b(linea de transmision|transmision|potencia)\b/.test(qn) && p.paz && p.cabos) {
    add('rc_tx_lapaz_cabos', 'rc_sibcs', 'const_red_aislada');
  }
  if (/\b(antes que el agua|antes del agua)\b/.test(qn)) add('ev_esc_water_first', 'const_dma_deficit');
  if (/\bvizcaino\b/.test(qn) && /\bhotel/.test(qn)) add('terr_anp_vizcaino', 'const_anp_nucleos', 'ev_anp_avisos');
  if (/\bplan de desarrollo urbano\b/.test(qn) && p.cabos) add('inst_pdu_cabos', 'terr_los_cabos', 'gap_pdu_cabos_3a');
  if (/\bplan de desarrollo urbano\b/.test(qn) && p.paz) add('inst_pdu_lapaz', 'gap_pmdu_lapaz_texto', 'rc_acuifero_0324');
  if (/\bsistema electrico\b/.test(qn)) add('ev_prodesen', 'rc_sibcs', 'const_red_aislada');
  if (/\bplan sexenal\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\b(areas naturales protegidas|administra las areas)\b/.test(qn)) add('actor_conanp', 'const_anp_nucleos');
  if (/\bsecretaria de planeacion\b/.test(qn)) add('inst_poerbcs', 'inst_poer_politicas');
  if (/\benergi\w*/.test(qn) && p.paz && p.cabos) add('rc_tx_lapaz_cabos', 'rc_sibcs');
  if (/\bagua\b/.test(qn) && p.paz && p.cabos) add('rc_acuifero_0317', 'rc_acuifero_0324', 'const_dma_deficit');
  if (/\bdesal\w*/.test(qn) && p.paz && p.cabos) add('proj_desal_cabos', 'proj_fed_agu_002', 'const_dma_deficit');
  if (/\bhuecos?\b/.test(qn) && /\bhotel/.test(qn)) add('gap_rentas_hoteleras', 'const_dma_deficit', 'dq_viabilidad_proyecto');
  if (/\bviable\b/.test(qn) && /\briesgos?\b/.test(qn)) add('dq_riesgos_principales', 'dq_viabilidad_proyecto');
  if (/\bquien decide\b/.test(qn) && /\boportunidad/.test(qn)) add('dq_oportunidades', 'ev_mesa_agua');
  if (/\bnucleo\b/.test(qn)) {
    add('const_anp_nucleos');
    if (/\bcabo pulmo\b/.test(qn) || p.east) add('terr_anp_cabo_pulmo');
    if (/\bvizcaino\b/.test(qn)) add('terr_anp_vizcaino');
    if (/\bsierra la laguna\b/.test(qn)) add('terr_anp_sierra_laguna');
  }
  if (/\bordenamiento local\b/.test(qn) && p.cabos) add('inst_poel_cabos', 'ev_sig_poel_cabos', 'terr_los_cabos');
  if (/\btecho ecologico\b/.test(qn)) add('inst_poerbcs', 'inst_poer_politicas');
  if (/\baprovechamiento sustentable\b/.test(qn)) add('inst_pa_aprovechamiento', 'gap_politica_uga_leyenda');
  if (/\bpreservacion\b/.test(qn) && /\bordenamiento\b/.test(qn)) add('inst_pa_preservacion', 'gap_politica_uga_leyenda');
  if (/\brestauracion\b/.test(qn) && /\bordenamiento\b/.test(qn)) add('inst_pa_restauracion', 'gap_politica_uga_leyenda');
  if (/\bapi\b/.test(qn) && (p.loreto || /\bpichilingue\b/.test(qn))) add('proj_fed_pue_002', 'ev_cruceros_datatur');
  if (/\baeropuerto/.test(qn) && p.loreto) add('ev_dossiers_movilidad', 'gap_loreto_dma', 'ev_sig_vuelos');
  if (/\bdensific\w*/.test(qn) && (p.cabos || /\bcosta\b/.test(qn))) add('terr_obs_cabos_coast', 'inst_pdu_cabos', 'dq_stills_densification');
  if (/\bcomision nacional del agua\b/.test(qn)) add('actor_conagua', 'ev_mesa_agua', 'ev_acuiferos_dma');
  if (/\bmarina\b/.test(qn) && (p.cabos || /\bcabo san lucas\b/.test(qn))) add('ev_sig_asipona', 'proj_fed_pue_001');
  if (/\b(10 de abril de 1980|20 de agosto de 1992|6 de junio de 1995|30 de noviembre de 1988)\b/.test(qn)) add('ev_historia_bcs');
  if (/\b6 de junio de 1995\b/.test(qn)) add('terr_anp_cabo_pulmo', 'const_anp_nucleos');
  if (/\b30 de noviembre de 1988\b/.test(qn)) add('terr_anp_vizcaino', 'const_anp_nucleos');
  if (/\btarifas?\b/.test(qn) && /\b(puerto|marina)\b/.test(qn) && (p.cabos || /\bcabo san lucas\b/.test(qn))) add('ev_sig_asipona');
  if (/\bvizcaino\b/.test(qn) && /\b(cuadros|222)\b/.test(qn)) add('dq_vizcaino_corridor', 'terr_anp_vizcaino');
  if (/\bcuatro acuiferos\b/.test(qn)) add('const_escasez_agua', 'ev_acuiferos_dma');
  if (/\b(tabla de disponibilidad|disponibilidad de acuiferos)\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\bremanente\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\bciudad constitucion\b/.test(qn) && !/\bconstitucion politica\b/.test(qn)) add('terr_comondu');
  if (/\bocupacion\b/.test(qn) && /\b(octubre|no es renta|segunda mitad)\b/.test(qn)) add('ev_news_ocupacion', 'gap_rentas_hoteleras');
  if (/\b(red del pais|red nacional)\b/.test(qn) && /\bpaus/.test(qn)) add('proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada');
  if (/\banexo\b/.test(qn) && /\b(participaciones?|2025)\b/.test(qn)) add('ev_fiscal_anexo_2025');
  if (/\bdesal\w*/.test(qn) && /\bno borra\b/.test(qn)) add('proj_desal_cabos', 'const_dma_deficit');
  if (/\bcuellos de la red\b/.test(qn)) add('inst_pamrnt', 'rc_sibcs', 'const_red_aislada');
  if (/\bfebrero de 2024\b/.test(qn) && /\b(concesion|puerto|marina)\b/.test(qn)) add('ev_sig_asipona');
  if (/\b1 de octubre\b/.test(qn) && /\b(tarifa|puerto)\b/.test(qn)) add('ev_sig_asipona');
  if (/\bapi\b/.test(qn) && /\b(administre|pidio)\b/.test(qn)) add('ev_sig_asipona');
  if (/\bnatali\b/.test(qn)) add('actor_cabos_dg_ecologia', 'ev_org_cabos_2024');
  if (/\b50 anos\b/.test(qn) && /\bfebrero de 2024\b/.test(qn)) add('ev_sig_asipona');
  if (/\barribos?\b/.test(qn) && p.mulege) add('ev_cruceros_datatur', 'terr_mulege');
  if (/\b(rubio apodaca|ramon rubio)\b/.test(qn)) add('actor_oomsapas_cabos', 'ev_org_cabos_2024');
  if (/\bagundez\b/.test(qn)) add('actor_cabos_presidencia', 'ev_org_cabos_2024', 'actor_ayunt_cabos');
  if (/\broberto flores\b/.test(qn)) add('actor_cabos_dg_desarrollo_urbano', 'ev_org_cabos_2024', 'inst_pdu_cabos');
  if (/\bjudith diaz\b/.test(qn)) add('ev_org_cabos_2024', 'actor_cabos_presidencia', 'actor_ayunt_cabos');
  if (/\b(gonzalez gilbert|gonzalez gibert|beatriz gonzalez)\b/.test(qn)) add('actor_implan_cabos', 'ev_org_cabos_2024', 'inst_pdu_cabos');
  if (/\b(castro cesena|carlos castro)\b/.test(qn)) add('actor_cabos_dg_desarrollo_social', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  if (/\burueta\b/.test(qn)) add('actor_cabos_dg_fomento_economico', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  if (/\b(ramirez reyes|alejandra ramirez)\b/.test(qn)) add('actor_cabos_dg_obras_publicas', 'ev_org_cabos_2024');
  if (/\bmontano\b/.test(qn)) add('actor_cabos_dg_servicios_publicos', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  if (/\b(lopez monge|christopher jordi|jordi lopez)\b/.test(qn)) add('actor_cabos_dg_seguridad_publica', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  if (/\b(karina|de la o)\b/.test(qn)) add('actor_cabos_delegaciones', 'actor_cabos_presidencia', 'terr_los_cabos');
  if (/\b(aracely|cota ruiz)\b/.test(qn)) add('actor_cabos_delegaciones', 'actor_cabos_presidencia', 'terr_los_cabos');
  if (/\baremy\b/.test(qn)) add('actor_cabos_delegaciones', 'actor_cabos_presidencia', 'terr_los_cabos');
  if (/\b(linda silva|silva cosio|linda maribel)\b/.test(qn)) add('actor_cabos_delegaciones', 'actor_cabos_presidencia', 'terr_los_cabos');
  if (/\b(2|6) de julio de 1954\b/.test(qn)) add('inst_veda_1954', 'ev_acuiferos_dma');
  if (/\b(niveles bajo el mar|bajo el nivel del mar)\b/.test(qn) || (/\blos planes\b/.test(qn) && /\b(nivel del mar|bajo el mar)\b/.test(qn))) {
    add('const_intrusion_marina', 'rc_acuifero_0324');
  }
  if (/\b603 horas\b/.test(qn)) add('rc_tx_lapaz_cabos', 'proj_p23_bs1', 'rc_sibcs');
  if (/\b688(\.5)?\b/.test(qn) && /\b(mw|megawatts?|pico)\b/.test(qn)) add('rc_sibcs', 'const_red_aislada');
  if (/\b3\.8 millones\b/.test(qn)) add('ev_aereo_setue', 'rc_aeropuerto_sjd');
  if (/\barribos?\b/.test(qn) && /\b(285|pichilingue|cabo san lucas)\b/.test(qn)) add('ev_cruceros_datatur');
  if (/\bdecreto 872\b/.test(qn)) add('ev_historia_bcs', 'terr_loreto');
  if (/\bsegunda actualizacion\b/.test(qn) && /\b(pdu|plan)\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if (/\b(23 de abril de 2013|6 de mayo de 2013)\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if (/\blos frayles\b/.test(qn)) add('ev_sig_vivienda_social', 'terr_mulege');
  if (/\bimagen radio\b/.test(qn)) add('ev_news_ocupacion', 'gap_rentas_hoteleras');
  if (/\b2047\b/.test(qn) && /\b(api|concesion|puerto)\b/.test(qn)) add('ev_sig_asipona');
  if (/\benjambre\b/.test(qn)) add('ev_riesgos_documentados', 'gap_riesgo_capas_vector');
  if (/\bmalec[oó]n\b/.test(qn)) add('dd_turismo_lapaz', 'terr_la_paz', 'rc_acuifero_0324');
  if (/\bsanto domingo\b/.test(qn)) add('dd_agro_santo_domingo', 'terr_comondu');
  if (/\b(diez|10) horas\b/.test(qn) && /\blimite\b/.test(qn)) add('rc_tx_lapaz_cabos', 'proj_p23_bs1', 'rc_sibcs');
  if (/\b(230|115)\b/.test(qn) && /\b(kilovolts?|kv)\b/.test(qn)) add('rc_tx_lapaz_cabos', 'proj_p23_bs1', 'rc_sibcs');
  if (/\b(sismo|sismos|sismica|5\.6|atlas estatal de riesgo)\b/.test(qn)) add('ev_riesgos_documentados', 'gap_riesgo_capas_vector');
  if (/\b(insus|predios donados)\b/.test(qn)) add('ev_sig_vivienda_social', 'terr_comondu');
  if (/\b(icsid|fosfato)\b/.test(qn)) add('proj_fed_min_002');
  if (/\b89 mil hogares\b/.test(qn)) add('ev_news_cfe_128', 'rc_sibcs', 'const_red_aislada');
  if (/\b(853 mil|1[,.]?570 millones|1[,.]?840 unidades)\b/.test(qn)) add('ev_inmob_jll_2025', 'gap_rentas_hoteleras');
  if (/\b(9 de noviembre de 2023|17 de agosto de 2023)\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\b17 de agosto de 2023\b/.test(qn)) add('rc_acuifero_0324', 'terr_la_paz');
  if (/\b13 de noviembre de 2009\b/.test(qn)) add('ev_anp_avisos', 'terr_anp_cabo_pulmo', 'const_anp_nucleos');
  if (/\b1 de septiembre de 2000\b/.test(qn)) add('ev_anp_avisos', 'terr_anp_vizcaino', 'const_anp_nucleos');
  if (/\b11 de noviembre de 2002\b/.test(qn)) add('ev_anp_avisos', 'terr_anp_loreto', 'const_anp_nucleos');
  if (/\b96 ejidos\b/.test(qn) || (/\bejidos\b/.test(qn) && /\bran\b/.test(qn))) add('ev_riesgos_documentados');
  if (/\bcabecera\b/.test(qn) && /\bsan jose\b/.test(qn)) add('ev_historia_bcs', 'terr_los_cabos');
  if (/\bdecreto 181\b/.test(qn)) add('ev_historia_bcs', 'terr_los_cabos');
  if (/\b83\.2\b/.test(qn) || (/\b83 por ciento\b/.test(qn) && /\bllegadas\b/.test(qn))) add('ev_aereo_setue', 'rc_aeropuerto_sjd');
  if (/\b668\s*mil\b/.test(qn) || /\b668[,.]800\b/.test(qn)) add('ev_aereo_setue', 'rc_aeropuerto_lap');
  if (/\bdiciembre de 2028\b/.test(qn) || (/\bno alivia\b/.test(qn) && /\b2028\b/.test(qn))) add('proj_p23_bs1', 'rc_tx_lapaz_cabos');
  if (/\bextracciones limitadas\b/.test(qn)) add('inst_veda_1954', 'ev_acuiferos_dma');
  if (/\balternativa turistica\b/.test(qn)) add('rc_acuifero_0320', 'inst_veda_1954', 'ev_acuiferos_dma');
  if (/\bmunicipio por confirmar\b/.test(qn) || (/\b0\.497\b/.test(qn) && /\b(vizcaino|acuifer|0302)\b/.test(qn))) {
    add('gap_acuifero_0302', 'ev_acuiferos_dma');
  }
  if (/\bboge\b/.test(qn) && /\b14\b/.test(qn)) add('ev_org_cabos_2024', 'ev_organigrama_cabos');
  if (/\b29 de febrero de 2024\b/.test(qn)) add('ev_org_cabos_2024', 'ev_organigrama_cabos');
  if (/\bxv ayuntamiento\b/.test(qn)) add('ev_organigrama_cabos', 'ev_org_cabos_2024', 'actor_cabos_presidencia');
  if (/\bconsulta 2023\b/.test(qn) && /\b(pdu|plan|decreto|actualizacion)\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if (/\b356 paginas\b/.test(qn) || /\b20 de diciembre de 2024\b/.test(qn)) add('gap_pmdu_lapaz_texto', 'inst_pdu_lapaz');
  if (/\bpmd\b/.test(qn) && p.mulege) add('gap_pdu_mulege', 'terr_mulege');
  if ((/\bgazette\b/.test(qn) || /\bpsdu\b/.test(qn)) && /\b2007\b/.test(qn)) add('gap_psdu_loreto_gazette', 'inst_poel_loreto', 'terr_loreto');
  if (/\bsan jose del este\b/.test(qn)) add('gap_east_cape_instrumento', 'gap_east_cape_carga');
  if (/\bmitsubishi\b/.test(qn) || (/\b(40[,.]?000|40 mil) hectareas\b/.test(qn) && /\bsal\b/.test(qn))) {
    add('proj_fed_min_003', 'terr_mulege');
  }
  if (/\bcenapred\b/.test(qn)) add('gap_riesgo_capas_vector', 'ev_riesgos_documentados');
  if (/\btransparencia\b/.test(qn) && /\b(puerto|congreso)\b/.test(qn)) add('ev_sig_asipona');
  if (/\breerig/.test(qn)) add('ev_historia_bcs', 'terr_loreto');
  if (/\bdesarrollador\b/.test(qn) && /\bdesal/.test(qn)) add('ev_sig_poel_cabos', 'inst_poel_cabos', 'gap_permisos_uso_suelo');
  if (/\bdestinos\b/.test(qn) && /\b(5|cinco)\b/.test(qn) && p.loreto) add('ev_sig_vuelos', 'gap_loreto_pax', 'ev_dossiers_movilidad');
  if (/\bdestinos\b/.test(qn) && /\b7\b/.test(qn) && p.paz) add('ev_sig_vuelos', 'rc_aeropuerto_lap');
  if (/\bdragado\b/.test(qn) && /\b(nucleo|prohib|cerrad|vetad)\b/.test(qn)) add('const_anp_nucleos', 'ev_anp_avisos');
  if (/\bmineria\b/.test(qn) && /\bnucleo\b/.test(qn)) add('const_anp_nucleos', 'ev_anp_avisos');
  if (/\b(hoy bcs|energy (&|and) commerce)\b/.test(qn) || (/\b18 de septiembre\b/.test(qn) && /\b(unidades|turbinas|movil)\b/.test(qn)) || (/\b89 mil\b/.test(qn) && /\b(comparacion|censo|nota|prensa)\b/.test(qn))) {
    add('ev_news_cfe_128', 'rc_sibcs', 'const_red_aislada');
  }
  if (/\b27\.83\b/.test(qn)) add('ev_acuiferos_dma', 'rc_acuifero_0324');
  if (/\b(35000|35 mil) viviendas\b/.test(qn)) add('ev_sig_vivienda_social', 'terr_comondu');
  if (/\bllegadas aereas\b/.test(qn)) add('ev_aereo_setue', 'rc_aeropuerto_sjd');
  if (/\b10\.9\b/.test(qn) || /\b668800\b/.test(qn)) add('ev_aereo_setue', 'rc_aeropuerto_lap');
  if (/\b(asociacion de hoteles|tribuna de mexico|picos previstos|arriba de 90)\b/.test(qn) || (/\bocupacion\b/.test(qn) && /\b(76|60|90|14|5) por ciento\b/.test(qn)) || (/\b14 por ciento\b/.test(qn) && /\b(turistas|estados unidos)\b/.test(qn))) {
    add('ev_news_ocupacion', 'gap_rentas_hoteleras');
  }
  if (/\bintencion politica\b/.test(qn)) add('ev_sig_asipona');
  if (/\bcapital ecologica\b/.test(qn)) add('dd_turismo_lapaz', 'terr_la_paz', 'rc_acuifero_0324');
  if (/\bsobreextraccion\b/.test(qn) || /\b0323\b/.test(qn)) add('const_intrusion_marina', 'rc_acuifero_0324');
  if (/\b(sin boge|consulta de 2023)\b/.test(qn) || (/\bboge\b/.test(qn) && /\b19\b/.test(qn)) || /\btercer(a)? (actualizacion|decreto)\b/.test(qn) || (/\bsin validar\b/.test(qn) && /\bsepuimm\b/.test(qn))) {
    add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  }
  if (/\b(ciclovia|17 cruces peatonales|monto contractual)\b/.test(qn) || (/\b840\b/.test(qn) && /\bmetros\b/.test(qn))) add('proj_fed_car_002');
  if (/\b(exportadora de sal|salina|essa)\b/.test(qn) || (/\bnacionalizacion\b/.test(qn) && /\bsal\b/.test(qn))) add('proj_fed_min_003', 'terr_mulege');
  if (/\b37\.1\b/.test(qn) || (/\blaudo\b/.test(qn) && /\b2024\b/.test(qn))) add('proj_fed_min_002');
  if (/\b(uabcs|atlas de riesgo|proteccion civil|m4\.[36])\b/.test(qn)) add('ev_riesgos_documentados', 'gap_riesgo_capas_vector');
  if (/\b(infonavit|brisas del valle)\b/.test(qn) || (/\b20 de octubre\b/.test(qn) && /\b(congreso|predios|insus|dono)\b/.test(qn))) {
    add('ev_sig_vivienda_social', 'terr_comondu', 'terr_mulege');
  }
  if (/\bveda indefinida\b/.test(qn) || (/\btipo iii\b/.test(qn) && /\b(veda|1954)\b/.test(qn)) || /\b2 y 6 de julio\b/.test(qn)) add('inst_veda_1954');
  if (/\b(9\.5 litros|0\.298\b|0\.30 hectomet|no licencia un polo)\b/.test(qn) || (/\b0320\b/.test(qn) && /\bveda\b/.test(qn))) {
    add('rc_acuifero_0320', 'inst_veda_1954', 'ev_acuiferos_dma');
  }
  if (/\bpdu\b/.test(qn) && p.mulege) add('gap_pdu_mulege', 'terr_mulege');
  if (/\bplan parcial\b/.test(qn) || (/\bla ribera\b/.test(qn) && /\bpsdu\b/.test(qn))) add('gap_east_cape_instrumento', 'gap_east_cape_carga');
  if (/\bempleo local\b/.test(qn) && p.east) add('gap_east_cape_carga', 'gap_east_cape_instrumento');
  if (/\b56 destinos\b/.test(qn)) add('ev_sig_vuelos', 'rc_aeropuerto_sjd');
  if (/\b2048\b/.test(qn)) add('rc_aeropuerto_sjd', 'ev_aereo_setue');
  if (/\blto\b/.test(qn) && /\bdestinos\b/.test(qn)) add('ev_sig_vuelos', 'gap_loreto_pax', 'ev_dossiers_movilidad');
  if (/\blap\b/.test(qn) && /\b7\b/.test(qn) && /\bdestinos\b/.test(qn)) add('ev_sig_vuelos', 'rc_aeropuerto_lap');
  if (/\b89[,.]?600\b/.test(qn)) add('gap_loreto_pax', 'ev_aereo_setue');
  if (/\b(1057758|1[,.]?057[,.]?758|133[,.]?269|33[,.]?412)\b/.test(qn) || (/\b594\b/.test(qn) && /\b(pasajer|santa rosalia|crucero)\b/.test(qn)) || /\bexcursion\b/.test(qn)) {
    add('ev_cruceros_datatur');
  }
  if (/\b(direccion municipal de obras|nombre del titular)\b/.test(qn)) add('gap_org_obras_cabos', 'ev_org_cabos_2024');
  if (/\b(99 unidades|92 titulares|reglamento de la administracion publica municipal)\b/.test(qn)) add('ev_organigrama_cabos', 'ev_org_cabos_2024');
  if (/\bmia\b/.test(qn) && /\bdesal/.test(qn) && p.comondu) add('ev_sig_comondu_loreto', 'terr_comondu');
  if (/\bacueducto\b/.test(qn) && p.loreto) add('ev_sig_comondu_loreto', 'gap_loreto_dma', 'proj_fed_agu_005');
  if (/\bmargen electrico\b/.test(qn)) add('gap_loreto_energia_local', 'rc_sibcs', 'const_red_aislada');
  if (/\bbcs30as\b/.test(qn)) add('gap_psdu_loreto_gazette', 'inst_poel_loreto', 'terr_loreto');
  if (/\bbcs55pt\b/.test(qn)) add('terr_anp_apff_csl', 'inst_poerbcs');
  if (/\bbcs01pt\b/.test(qn)) add('terr_anp_vizcaino', 'ev_anp_avisos', 'const_anp_nucleos', 'inst_pa_proteccion', 'gap_politica_uga_leyenda');
  if (/\b56\b/.test(qn) && /\b(ugas|unidades de gestion)\b/.test(qn)) add('inst_poerbcs', 'inst_poer_politicas');
  if (/\benero de 2026\b/.test(qn) && /\b(ordenamiento|poer)\b/.test(qn)) add('inst_poerbcs');
  if (/\b2021\b/.test(qn) && /\b2027\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\bno sustituye\b/.test(qn) && /\btecho ecologico\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\bsin volumen\b/.test(qn) && /\bnuevas concesiones\b/.test(qn)) add('rc_acuifero_0317', 'const_dma_deficit', 'const_escasez_agua');
  if (/\bsin margen\b/.test(qn) && /\bnuevas concesiones\b/.test(qn)) add('const_dma_deficit', 'const_escasez_agua');
  if (/\bpico de referencia\b/.test(qn) || /\bfuera del sistema nacional\b/.test(qn)) add('rc_sibcs', 'const_red_aislada');
  if (/\bpuerta secundaria\b/.test(qn)) add('rc_aeropuerto_lap', 'terr_la_paz');
  if (/\bcompite con la hotel/.test(qn)) add('dd_residencial_cabos', 'gap_rentas_hoteleras');
  if (/\bno cierra la etapa\b/.test(qn)) add('dd_eventos_foro');
  if (/\bperiurban/.test(qn)) add('const_tenencia');
  if (/\b72 puntos\b/.test(qn)) add('const_coast_anp_pressure', 'dq_coast_anp_buffers');
  if (/\b106 cuadros\b/.test(qn)) add('terr_obs_cabos_coast', 'dq_stills_densification');
  if (/\b33 cuadros\b/.test(qn)) add('terr_obs_loreto_bay', 'terr_anp_loreto');
  if (/\b54 cuadros\b/.test(qn)) add('terr_obs_east_cape', 'terr_anp_cabo_pulmo');
  if (/\b956\b/.test(qn) && /\b(fotograf|stills|imagenes)\b/.test(qn)) add('ev_stills_intel');
  if (/\b(2[,.]?900 tramos|4[,.]?428 salidas|no es un mapa de inundacion)\b/.test(qn)) add('ev_escorrentia');
  if (/\baño parcial\b/.test(qn) || (/\b776\b/.test(qn) && /\bviviend/.test(qn))) add('ev_sniiv_vivienda');
  if ((/\b42 millones\b/.test(qn) && p.loreto) || /\b41 casas\b/.test(qn)) add('ev_jll_zonas_2025', 'gap_rentas_hoteleras');
  if (/\b(meganoticias|accesos a playa|29 de octubre de 2026)\b/.test(qn)) add('ev_news_pdu_este', 'gap_east_cape_instrumento', 'gap_pdu_cabos_3a');
  if (/\btarifas?\b/.test(qn) && /\b(publicadas|sin precio)\b/.test(qn)) add('ev_sig_asipona');
  if (/\b50 anos\b/.test(qn) && /\bfebrero\b/.test(qn) && /\bconcesion\b/.test(qn)) add('ev_sig_asipona');
  if (/\b0\.107\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\b(code_?pa|no asignar rt)\b/.test(qn)) add('gap_politica_uga_leyenda', 'inst_pa_restauracion');
  if (/\b(duis|permisos de construccion)\b/.test(qn)) add('gap_permisos_uso_suelo');
  if (/\bcatastro\b/.test(qn) && /\b(fuera|visor|login|secundario)\b/.test(qn) || (/\bvisor\b/.test(qn) && /\blogin\b/.test(qn))) {
    add('gap_catastro_secundario');
  }
  if (/\b12\.5\b/.test(qn)) add('rc_acuifero_0319', 'ev_acuiferos_dma');
  if (/\b13\.5\b/.test(qn)) add('rc_acuifero_0324', 'ev_acuiferos_dma');
  if (/\b2\.96\b/.test(qn)) add('rc_acuifero_0313', 'ev_acuiferos_dma');
  if (/\b2\.29\b/.test(qn)) add('rc_acuifero_0318', 'ev_acuiferos_dma', 'terr_anp_cabo_pulmo');
  if (/\b(69 por ciento|1[,.]?492 millones|81 por ciento|no es consejo de inversion)\b/.test(qn) || (/\bprecio medio\b/.test(qn) && /\b(mls|jll|casas)\b/.test(qn)) || (/\b60 por ciento\b/.test(qn) && /\bunidades\b/.test(qn)) || (/\b6 por ciento\b/.test(qn) && /\bvolumen\b/.test(qn)) || (/\b4 por ciento\b/.test(qn) && /\b(east cape|cabo del este|mercado)\b/.test(qn))) {
    add('ev_inmob_jll_2025', 'gap_rentas_hoteleras');
  }
  if (/\b18 por ciento\b/.test(qn) && /\bpacifico\b/.test(qn)) add('ev_jll_zonas_2025', 'gap_rentas_hoteleras');
  if (/\b(588|812|1079|990|345|142)\b/.test(qn) && /\bregistros?\b/.test(qn) || /\b31 de agosto de 2026\b/.test(qn) || /\bsedatu\b/.test(qn)) {
    add('ev_sniiv_vivienda');
  }
  if (/\bsegundo polo\b/.test(qn)) add('terr_la_paz', 'rc_acuifero_0324');
  if (/\bmayor superficie\b/.test(qn)) add('terr_mulege');
  if (/\bpolo norte\b/.test(qn)) add('terr_loreto', 'terr_anp_loreto');
  if (/\beje hotelero\b/.test(qn)) add('terr_corredor_cabos', 'dd_turismo_cabos', 'terr_los_cabos');
  if (/\b(puerta de demanda|brownfield)\b/.test(qn)) add('rc_aeropuerto_sjd');
  if (/\bfrontera de urbanizacion\b/.test(qn)) add('rc_vivienda_cabos', 'inst_pdu_cabos');
  if (/\bmotor dominante\b/.test(qn)) add('dd_turismo_cabos', 'terr_corredor_cabos');
  if (/\briego historico\b/.test(qn)) add('dd_agro_santo_domingo', 'inst_veda_1954', 'terr_comondu');
  if (/\bveto de diseno\b/.test(qn)) add('const_escasez_agua', 'const_dma_deficit');
  if (/\bplanear hoteles\b/.test(qn)) add('const_red_aislada', 'inst_pamrnt', 'rc_sibcs');
  if (/\bno son un anexo\b/.test(qn) || (/\bcierran\b/.test(qn) && /\b(dragado|mineria)\b/.test(qn))) add('const_anp_nucleos', 'ev_anp_avisos');
  if (/\b24\.06961\b/.test(qn)) add('rc_acuifero_0317', 'ev_acuiferos_dma');
  if (/\b12\.493828\b/.test(qn)) add('rc_acuifero_0319', 'ev_acuiferos_dma');
  if (/\b13\.488404\b/.test(qn)) add('rc_acuifero_0324', 'ev_acuiferos_dma');
  if (/\b2\.964513\b/.test(qn)) add('rc_acuifero_0313', 'ev_acuiferos_dma');
  if (/\b2\.286941\b/.test(qn)) add('rc_acuifero_0318', 'ev_acuiferos_dma');
  if (/\b0\.298386\b/.test(qn)) add('rc_acuifero_0320', 'inst_veda_1954', 'ev_acuiferos_dma');
  if (/\b0\.107682\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\b0\.497182\b/.test(qn)) add('gap_acuifero_0302', 'ev_acuiferos_dma');
  if (/\b(no es aforo|balance legal|acuerdos de disponibilidad)\b/.test(qn)) add('ev_acuiferos_dma', 'actor_conagua');
  if (/\b17 de agosto\b/.test(qn) && /\b(dof|acuerdo|promedia)\b/.test(qn)) add('ev_acuiferos_dma', 'rc_acuifero_0324');
  if (/\b688\.5\b/.test(qn)) add('rc_sibcs', 'const_red_aislada');
  if (/\b0\.6 por ciento\b/.test(qn) && /\b(sjd|san jose|llegadas)\b/.test(qn)) add('ev_aereo_setue', 'rc_aeropuerto_sjd');
  if (/\blto desconocido\b/.test(qn) || (/\bno se suman\b/.test(qn) && /\b(loreto|cifras|pasajer)\b/.test(qn))) add('gap_loreto_pax', 'ev_aereo_setue');
  if (/\bdiez de abril de 1980\b/.test(qn)) add('ev_historia_bcs', 'terr_los_cabos');
  if (/\bveinte de agosto de 1992\b/.test(qn)) add('ev_historia_bcs', 'terr_loreto');
  if (/\bseis de junio de 1995\b/.test(qn)) add('ev_historia_bcs', 'terr_anp_cabo_pulmo', 'const_anp_nucleos');
  if (/\btreinta de noviembre de 1988\b/.test(qn)) add('ev_historia_bcs', 'terr_anp_vizcaino', 'const_anp_nucleos');
  if (/\b(169|283)\b/.test(qn) && /\b(costa|proteg|stills|fotograf|muestra)/.test(qn)) add('ev_stills_intel');
  if (/\b222\b/.test(qn) && /\b(stills|desierto|cuadros)\b/.test(qn)) add('terr_obs_vizcaino_spine', 'terr_anp_vizcaino');
  if (/\b165\b/.test(qn) && /\bvizcaino\b/.test(qn)) add('terr_obs_vizcaino_spine', 'terr_anp_vizcaino');
  if (/\b(16[,.]?588|146 sumideros|no caudales)\b/.test(qn)) add('ev_escorrentia');
  if (/\b(3996|3[,.]?996|1973|bcs55)\b/.test(qn)) add('terr_anp_apff_csl', 'inst_poerbcs');
  if (/\bsegunda actualizacion\b/.test(qn) && /\boperativa\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if (/\b12 de marzo de 2014\b/.test(qn) || (/\bpoel\b/.test(qn) && /\b2014\b/.test(qn))) add('inst_poel_loreto', 'gap_psdu_loreto_gazette', 'terr_loreto');
  if (/\btecho de cuartos\b/.test(qn) || /\bevidencia cuantitativa incompleta\b/.test(qn)) add('gap_east_cape_carga', 'gap_east_cape_instrumento');
  if (/\bcapa sur no trae\b/.test(qn)) add('gap_loreto_dma');
  if (/\b(corredor remoto|solo transito|probarse contra el agua local)\b/.test(qn)) add('ev_sig_mulege_oasis', 'gap_mulege_agua_energia');
  if (/\bbalance municipal\b/.test(qn) && p.mulege) add('gap_mulege_agua_energia', 'terr_mulege');
  if (/\bintensificar\b/.test(qn) || (/\bflanco\b/.test(qn) && p.east)) add('ev_esc_corridor');
  if (/\banclar\b/.test(qn) && /\b(puerto|crecimiento)\b/.test(qn)) add('ev_esc_ports', 'rc_aeropuerto_sjd', 'rc_aeropuerto_lap');
  if ((/\bantes de abrir\b/.test(qn) && /\bagua\b/.test(qn)) || /\bgestionar la demanda\b/.test(qn)) add('ev_esc_water_first', 'const_dma_deficit');
  if (/\babasto urbano depende\b/.test(qn)) add('ev_sig_water_energy', 'rc_sibcs');
  if (/\btension de vocacion\b/.test(qn)) add('ev_sig_tourism_fdi', 'const_dma_deficit');
  if (/\bconfiabilidad\b/.test(qn) && /\bcfe\b/.test(qn)) add('ev_sig_sibcs', 'rc_sibcs', 'const_red_aislada');
  if (/\bfuera del sur turistico\b/.test(qn)) add('ev_sig_comondu_loreto', 'gap_loreto_dma');
  if (/\begresos estatales\b/.test(qn)) add('ev_fiscal_ley_2026', 'gap_fiscal_ingresos_2026');
  if (/\bno es capacidad de obra\b/.test(qn)) add('ev_fiscal_anexo_2025');
  if (/\b30 de septiembre de 2026\b/.test(qn) || (/\b(regeneracion y biodiversidad|hospitalidad)\b/.test(qn) && /\bmesas?\b/.test(qn))) {
    add('ev_mesas_trabajo');
  }
  if (/\b(iter|pobtot)\b/.test(qn)) add('ev_communities_master');
  if (/\bgaleria de ciclones\b/.test(qn)) add('ev_orientacion_aerea');
  if (/\b(tabla letra|moe56|69 poligonos|rt no esta)\b/.test(qn)) add('gap_politica_uga_leyenda', 'inst_pa_restauracion');
  if (/\bregimen fonatur\b/.test(qn)) add('proj_fed_pue_001', 'ev_sig_asipona', 'ev_historia_bcs');
  if (/\brenombre\b/.test(qn)) add('proj_fed_tur_002', 'proj_fed_car_002');
  if (/\blibramiento\b/.test(qn)) add('proj_fed_car_001');
  if (/\brepaviment/.test(qn)) add('proj_fed_car_003', 'proj_transpeninsular');
  if (/\b350 millones\b/.test(qn) && /\bcarretera/.test(qn)) add('proj_fed_car_004');
  if (/\b2047\b/.test(qn)) add('ev_sig_asipona', 'proj_fed_pue_002');
  if (/\b(inicios de 2027|60 por ciento de avance)\b/.test(qn)) add('proj_desal_cabos', 'proj_fed_agu_001');
  if (/\bsin ficha tecnica\b/.test(qn)) add('proj_fed_agu_002');
  if (/\bpotabilizadora\b/.test(qn)) add('proj_fed_agu_004', 'proj_fed_agu_003');
  if (/\bpueblos magicos\b/.test(qn)) add('proj_fed_tur_001');
  if (/\b(37500|37[,.]?500 acciones|55 mil viviendas)\b/.test(qn)) add('proj_fed_viv_001', 'ev_sig_vivienda_social');
  if (/\b2039\b/.test(qn) || /\bcuellos de transmision\b/.test(qn)) add('inst_pamrnt', 'rc_sibcs', 'const_red_aislada');
  if (/\bfuente del candado\b/.test(qn)) add('actor_conagua', 'ev_acuiferos_dma', 'const_dma_deficit');
  if (/\b(dos por 230|cuello que separa)\b/.test(qn)) add('rc_tx_lapaz_cabos', 'proj_p23_bs1', 'rc_sibcs');
  if (/\bopera debajo\b/.test(qn)) add('inst_pdu_cabos', 'inst_poerbcs');
  if (/\btecho sobre los planes\b/.test(qn)) add('inst_poerbcs');
  if (/\bmarco estatal del agua\b/.test(qn)) add('inst_ley_aguas', 'actor_cea', 'actor_conagua');
  if (/\bno sustituye\b/.test(qn) && /\bordenamiento\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\bpermisos\b/.test(qn) && /\binventario\b/.test(qn)) add('gap_permisos_uso_suelo');
  if (/\brecuadro sin nombre\b/.test(qn)) add('gap_org_obras_cabos', 'ev_org_cabos_2024');
  if (/\bsin megaproyecto\b/.test(qn)) add('proj_fed_aer_001', 'rc_aeropuerto_sjd', 'rc_aeropuerto_lap');
  if (/\b(proyectado en 76|turistas de estados unidos bajaron|octubre proyectado)\b/.test(qn)) add('ev_news_ocupacion', 'gap_rentas_hoteleras');
  if (/\b10 registros\b/.test(qn) && p.mulege) add('ev_sniiv_vivienda', 'terr_mulege');
  if (/\b31 registros\b/.test(qn)) add('ev_sniiv_vivienda', 'terr_comondu');
  if (/\bpicos estacionales\b/.test(qn)) add('rc_aeropuerto_sjd');
  if (/\bconectividad norte sur\b/.test(qn)) add('rc_aeropuerto_lap', 'terr_la_paz');
  if (/\bconvocatoria publica\b/.test(qn)) add('dd_eventos_foro', 'dq_agenda_politica');
  if (/\bcartografia\b/.test(qn) && /\bbarriles\b/.test(qn)) add('const_tenencia', 'ev_psdu_barriles');
  if (/\bventana politica del sexenio\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\b213\b/.test(qn) && /\b(anp|proteg)/.test(qn)) add('ev_stills_intel');
  if (/\b166\b/.test(qn) && /\bdesierto\b/.test(qn)) add('terr_obs_vizcaino_spine', 'terr_anp_vizcaino');
  if (/\ben la muestra\b/.test(qn) && /\b(cabos|resorts?)\b/.test(qn)) add('terr_obs_cabos_coast', 'dq_stills_densification');
  if (/\b13 asentamientos\b/.test(qn)) add('terr_obs_cabos_coast');
  if (/\b39 resorts\b/.test(qn) || /\b20 cruces\b/.test(qn)) add('const_coast_anp_pressure', 'dq_coast_anp_buffers');
  if (/\b15\b/.test(qn) && p.loreto && /\bcosta\b/.test(qn)) add('terr_obs_loreto_bay');
  if (/\b10 resorts\b/.test(qn) && p.east) add('terr_obs_east_cape', 'terr_anp_cabo_pulmo');
  if (/\bdof\b/.test(qn) && /\b2 de julio\b/.test(qn)) add('inst_veda_1954');
  if (/\btipo tres\b/.test(qn) && /\bveda\b/.test(qn)) add('inst_veda_1954');
  if (/\bcapa juridica\b/.test(qn) && /\b1954\b/.test(qn)) add('inst_veda_1954');
  if (/\bnom once\b/.test(qn)) add('inst_veda_1954', 'ev_acuiferos_dma');
  if (/\bno se promedia\b/.test(qn)) add('ev_acuiferos_dma', 'rc_acuifero_0324');
  if (/\b(sin confirmar|marca por confirmar)\b/.test(qn)) add('gap_acuifero_0302', 'ev_acuiferos_dma');
  if (/\bobra instruida\b/.test(qn)) add('proj_p23_bs1', 'rc_tx_lapaz_cabos');
  if (/\balerta del pico\b/.test(qn)) add('rc_sibcs', 'const_red_aislada');
  if (/\bjunio de? 2026\b/.test(qn) && /\b(paso|glorieta|meta)\b/.test(qn)) add('proj_fed_car_002');
  if (/\b(brecha del monto|monto sict)\b/.test(qn)) add('proj_fed_car_002');
  if (/\b100 por ciento\b/.test(qn) && /\bsal\b/.test(qn)) add('proj_fed_min_003', 'terr_mulege');
  if (/\b40[,.]?000 hectareas\b/.test(qn)) add('proj_fed_min_003', 'terr_mulege');
  if (/\blaudo\b/.test(qn) && /\bseptiembre\b/.test(qn)) add('proj_fed_min_002');
  if (/\b1995\b/.test(qn) && /\b(parque|pulmo|decreto)\b/.test(qn)) add('terr_anp_cabo_pulmo', 'ev_historia_bcs', 'const_anp_nucleos');
  if (/\b1988\b/.test(qn) && /\breserva\b/.test(qn)) add('terr_anp_vizcaino', 'ev_historia_bcs', 'const_anp_nucleos');
  if (/\b(pm|programa de manejo)\b/.test(qn) && /\b(en blanco|falta|todavia no|sin texto)\b/.test(qn)) add('terr_anp_apff_csl', 'inst_poerbcs');
  if (/\breglamento interior\b/.test(qn)) add('ev_organigrama_cabos', 'ev_org_cabos_2024');
  if (/\bgilbert\b/.test(qn) && /\bgibert\b/.test(qn) || /\bbeatriz\b/.test(qn)) add('actor_implan_cabos', 'ev_org_cabos_2024', 'inst_pdu_cabos');
  if (/\b23 de abril\b/.test(qn) && /\b(cabildo|pdu|boge|actualizacion)\b/.test(qn)) add('gap_pdu_cabos_3a', 'inst_pdu_cabos');
  if (/\b20 de diciembre\b/.test(qn) && /\b(acta|texto|cabildo|pmdu)\b/.test(qn)) add('gap_pmdu_lapaz_texto', 'inst_pdu_lapaz');
  if (/\bgazette\b/.test(qn) && p.loreto) add('gap_psdu_loreto_gazette', 'inst_poel_loreto', 'terr_loreto');
  if (/\bactualizacion 2024\b/.test(qn) && /\bconsulta\b/.test(qn)) add('gap_psdu_loreto_gazette', 'inst_poel_loreto');
  if (/\bempleo local\b/.test(qn)) add('gap_east_cape_carga', 'gap_east_cape_instrumento');
  if (/\bno desglosa\b/.test(qn)) add('gap_loreto_energia_local', 'rc_sibcs');
  if (/\bno se reclama\b/.test(qn) || /\blectura desconocida\b/.test(qn)) add('gap_mulege_agua_energia', 'terr_mulege');
  if (/\bscorecard\b/.test(qn)) add('ev_gds_cinco_polos');
  if (/\brestringid/.test(qn) && /\b0317\b/.test(qn)) add('ev_gds_cinco_polos', 'rc_acuifero_0317');
  if (/\bpducp 2018\b/.test(qn)) add('inst_pdu_lapaz', 'gap_pmdu_lapaz_texto', 'ev_gds_cinco_polos');
  if (/\bcomo anclas\b/.test(qn)) add('ev_esc_ports', 'rc_aeropuerto_sjd', 'rc_aeropuerto_lap');
  if (/\bdossier\b/.test(qn) && /\bvocacion\b/.test(qn)) add('ev_dossiers_lugar');
  if (/\bacceso\b/.test(qn) && /\bcorredor\b/.test(qn) && p.east) add('ev_dossiers_movilidad', 'gap_east_cape_carga');
  if (/\bcrecimiento cabe\b/.test(qn)) add('ev_preguntas_estrategicas', 'dq_capacidad_carga');
  if (/\bregeneracion y biodiversidad\b/.test(qn)) add('ev_mesas_trabajo');
  if (/\burbanizacion\b/.test(qn) && /\bmesa\b/.test(qn)) add('ev_mesa_urbanismo', 'inst_pdu_cabos');
  if (/\bhitos\b/.test(qn)) add('ev_historia_bcs');
  if (/\bno es ageb\b/.test(qn)) add('ev_pob_censo_2020');
  if (/\bpredios comparables\b/.test(qn)) add('gap_catastro_secundario');
  if (/\b(diez sufijos|10 sufijos)\b/.test(qn)) add('inst_pa_preservacion', 'gap_politica_uga_leyenda');
  if (/\brestauracion\b/.test(qn) && /\b(ocr|tabla)\b/.test(qn)) add('inst_pa_restauracion', 'gap_politica_uga_leyenda');
  if (/\baprovechamiento sustentable\b/.test(qn) || /\bsigla as\b/.test(qn)) add('inst_pa_aprovechamiento', 'gap_politica_uga_leyenda');
  if (/\bpermisos\b/.test(qn) && /\b(faltan|montos|inventario)\b/.test(qn)) add('gap_permisos_uso_suelo');
  if (/\bcapas vectoriales\b/.test(qn) || (/\bmalla\b/.test(qn) && /\b(sismica|ciclon|inundacion)\b/.test(qn))) add('gap_riesgo_capas_vector', 'ev_riesgos_documentados');
  if (/\bsecuencia\b/.test(qn) && /\b(loreto|sismo|sismica)\b/.test(qn)) add('ev_riesgos_documentados', 'gap_riesgo_capas_vector');
  if (/\b4\.6\b/.test(qn) && /\b4\.3\b/.test(qn)) add('ev_riesgos_documentados');
  if (/\bnoventa y seis ejidos\b/.test(qn) || /\bkml\b/.test(qn)) add('ev_riesgos_documentados');
  if (/\bcuatro mil hectareas\b/.test(qn)) add('terr_anp_apff_csl', 'inst_poerbcs');
  if (/\bcincuenta y seis\b/.test(qn) && /\b(uga|unidades)\b/.test(qn)) add('inst_poerbcs');
  if (/\balinea\b/.test(qn) && /\bplaneacion\b/.test(qn)) add('inst_ped', 'inst_poerbcs');
  if (/\btensionado\b/.test(qn)) add('inst_pdu_cabos', 'const_dma_deficit');
  if (/\bcoherenciar\b/.test(qn)) add('inst_pdu_lapaz', 'gap_pmdu_lapaz_texto');
  if (/\bconvenio\b/.test(qn) && /\bordenamiento local\b/.test(qn)) add('inst_poel_cabos', 'inst_poerbcs');
  if (/\boperadores municipales\b/.test(qn)) add('inst_ley_aguas', 'actor_cea');
  if (/\bsistema interconectado\b/.test(qn)) add('inst_prodesen', 'rc_sibcs', 'const_red_aislada');
  if (/\bno unificado\b/.test(qn)) add('proj_fed_agu_001', 'proj_desal_cabos');
  if (/\bpresa\b/.test(qn) && /\b(ficha|hectometros)\b/.test(qn)) add('proj_fed_agu_003');
  if (/\bconclusion anunciada\b/.test(qn)) add('proj_fed_agu_005', 'gap_loreto_dma');
  if (/\b70 por ciento\b/.test(qn) && /\b(carga|puerto)\b/.test(qn)) add('proj_fed_car_001');
  if (/\bnombre oficial\b/.test(qn) && /\bsict\b/.test(qn)) add('proj_fed_car_001');
  if (/\bpor kilometro\b/.test(qn)) add('proj_fed_car_003', 'proj_transpeninsular');
  if (/\bsenalamiento\b/.test(qn) && /\bpuentes\b/.test(qn)) add('proj_fed_car_004');
  if (/\bsin desglose\b/.test(qn)) add('proj_fed_car_004');
  if (/\bcapex\b/.test(qn)) add('proj_fed_aer_001');
  if (/\bno unificadas\b/.test(qn) && /\bvivienda\b/.test(qn)) add('proj_fed_viv_001', 'ev_sig_vivienda_social');
  if (/\b134 millones\b/.test(qn) && /\b2026\b/.test(qn)) add('proj_fed_ene_008');
  if (/\b44 proyectos\b/.test(qn) || /\bno es ejecucion\b/.test(qn)) add('ev_federal_projects_inventory');
  if (/\b(desbloquea|solo sostiene)\b/.test(qn) && /\bdesal/.test(qn) || (/\boferta neta\b/.test(qn) && /\bsustitucion\b/.test(qn))) add('dq_desal_vs_crecimiento', 'proj_desal_cabos');
  if (/\bque cabe\b/.test(qn) && /\bventana\b/.test(qn)) add('dq_agenda_politica', 'inst_ped');
  if (/\bcoherencia entre\b/.test(qn)) add('dq_coherencia_instrumentos', 'inst_poerbcs');
  if (/\bregenera o solo mitiga\b/.test(qn)) add('dq_integridad_ecologica', 'terr_anp_sierra_laguna');
  if (/\b(listo para app|readiness)\b/.test(qn)) add('dq_readiness_inversion', 'proj_desal_cabos', 'rc_aeropuerto_sjd');
  if (/\b(condiciona el desierto|no de la densidad)\b/.test(qn)) add('dq_vizcaino_corridor', 'terr_anp_vizcaino');
  if (/\bdensificacion observada\b/.test(qn)) add('dq_stills_densification', 'terr_obs_cabos_coast');
  if (/\bfamilias de agua\b/.test(qn)) add('dq_viabilidad_proyecto');
  if (/\bpaquete de\b/.test(qn) && p.east) add('dq_pack_east_cape');
  if (/\bpaquete de\b/.test(qn) && p.loreto) add('dq_pack_loreto');
  if (/\bpaquete de\b/.test(qn) && p.mulege) add('dq_pack_mulege');
  if (/\boportunidades ya codificadas\b/.test(qn)) add('dq_oportunidades');
  if (/\bpoliticas nombradas\b/.test(qn)) add('dq_cambio_uso_suelo', 'inst_poer_politicas', 'gap_politica_uga_leyenda');
  if (/\bprimero el agua\b/.test(qn)) add('ev_esc_water_first', 'const_dma_deficit');
  if (/\b1973\b/.test(qn) && /\bcabo san lucas\b/.test(qn)) add('terr_anp_apff_csl', 'inst_poerbcs');
  if (/\bamortiguamiento\b/.test(qn) && p.mulege) add('terr_anp_vizcaino', 'dq_vizcaino_corridor', 'const_anp_nucleos');
  if (/\b(costa toca|toca un area protegida|area protegida)\b/.test(qn)) add('dq_coast_anp_buffers', 'const_coast_anp_pressure');
  if (/\bfalta agua\b/.test(qn)) add('const_escasez_agua', 'const_dma_deficit');
  if (/\bley estatal de aguas\b/.test(qn)) add('inst_ley_aguas', 'actor_cea', 'actor_conagua');
  if (/\bdisponibilidad media\b/.test(qn)) add('ev_acuiferos_dma');
  if (/\bpaus/.test(qn) && /\b(enlace|sistema electrico)\b/.test(qn)) add('proj_fed_ene_010', 'rc_sibcs', 'const_red_aislada');
  if (/\binsurgentes\b/.test(qn) && /\b(valle|agricol|agro)\b/.test(qn)) add('terr_comondu', 'dd_agro_santo_domingo');
  if (/\bsan carlos\b/.test(qn) && /\bapi\b/.test(qn)) add('ev_sig_asipona', 'proj_fed_pue_002');
  if (/\b50 anos\b/.test(qn) && /\bpuerto\b/.test(qn)) add('ev_sig_asipona');
  if (/\btransferencia\b/.test(qn) && /\b(puerto|asipona|api)\b/.test(qn)) add('ev_sig_asipona');
  if (/\breporte de vivienda\b/.test(qn)) add('ev_jll_zonas_2025', 'gap_rentas_hoteleras');
  if (/\bviabil/.test(qn) && /\briesgos?\b/.test(qn) && /\bhuecos?\b/.test(qn)) {
    add('dq_riesgos_principales', 'dq_viabilidad_proyecto', 'gap_rentas_hoteleras');
  }
  if (p.east && /\baeropuerto/.test(qn)) add('ev_dossiers_movilidad', 'gap_east_cape_carga');
  if (/\briesgos?\b/.test(qn) && /\bquien decide\b/.test(qn)) {
    add('dq_riesgos_principales');
    if (/\bagua\b/.test(qn)) add('ev_mesa_agua', 'actor_cea', 'actor_conagua');
  }
  if (/\bcabo pulmo\b/.test(qn) && /\b(constru\w*|cierra|obra)\b/.test(qn)) {
    add('terr_anp_cabo_pulmo', 'const_anp_nucleos', 'ev_anp_avisos');
  }
  if (/\boomsapas\b/.test(qn)) add('actor_oomsapas_cabos', 'ev_mesa_agua');
  if (/\bsepuimm\b/.test(qn)) add('actor_sepuimm', 'inst_poerbcs');
  if (/\bconanp\b/.test(qn)) add('actor_conanp', 'terr_anp_cabo_pulmo', 'const_anp_nucleos');
  if (/\bcea\b/.test(qn) || /\bcomision estatal del agua\b/.test(qn)) add('actor_cea', 'ev_mesa_agua');
  if (p.comondu && p.loreto && /\b(desal|ptar)\b/.test(qn)) add('ev_sig_comondu_loreto', 'proj_fed_agu_005', 'gap_loreto_dma');
  if (/\btrayectoria actual\b/.test(qn)) add('ev_esc_baseline', 'dq_viabilidad_proyecto');
  if (/\bied\b/.test(qn)) add('ev_sig_tourism_fdi', 'const_dma_deficit');
  if (/\b(cinco municipios|cinco polos)\b/.test(qn) && FACTOR_COMPARE_RE.test(qn)) {
    add('dq_comparar_polos', 'terr_los_cabos', 'terr_la_paz', 'terr_loreto', 'terr_comondu', 'terr_mulege', 'ev_gds_cinco_polos');
  }
  if (/\bcrucer/.test(qn)) add('ev_cruceros_datatur', 'ev_sig_asipona');
  if (/\bsierra la laguna\b/.test(qn)) add('terr_anp_sierra_laguna', 'const_anp_nucleos');
  if (/\bbahia de loreto\b/.test(qn)) add('terr_anp_loreto', 'const_anp_nucleos');
  if (/\b(api bcs|pichilingue)\b/.test(qn)) add('proj_fed_pue_002', 'ev_cruceros_datatur');
  if (/\baeropuerto/.test(qn) && (p.who || p.cabos || /\b(gap|concesion|sjd)\b/.test(qn))) add('rc_aeropuerto_sjd', 'proj_fed_aer_001');
  if (/\baeropuerto/.test(qn) && (p.paz || /\blap\b/.test(qn) || /\bconcesion gap\b/.test(qn))) add('rc_aeropuerto_lap', 'proj_fed_aer_001');
  if (p.who && /\b(agua|desal\w*|mesa)\b/.test(qn)) {
    add('ev_mesa_agua', 'actor_cea', 'actor_conagua', 'proj_fed_agu_001', 'proj_desal_cabos');
  }
  if (p.who && /\b(energi|sibcs|cfe)\b/.test(qn)) {
    add('ev_mesa_energia', 'actor_cfe', 'rc_sibcs', 'proj_p23_bs1');
  }
  if (p.who && /\b(puerto|asipona|marina)\b/.test(qn)) {
    add('ev_sig_asipona', 'proj_fed_pue_001', 'proj_fed_pue_002', 'ev_cruceros_datatur');
  }
  if (p.who) {
    add('ev_mesas_trabajo', 'actor_sepuimm', 'actor_conagua', 'actor_cea', 'actor_cfe');
    if (kinds.includes('landuse')) add('dq_cambio_uso_suelo', 'inst_poerbcs', 'inst_poer_politicas');
    add('ev_mesa_agua', 'ev_mesa_energia');
    if (p.cabos || p.east || !p.any) add('ev_mesa_urbanismo');
    if (p.cabos || p.east) add('actor_oomsapas_cabos', 'actor_implan_cabos', 'actor_ayunt_cabos');
    if (p.paz) add('actor_ayunt_lapaz');
    if (p.comondu) add('actor_ayunt_comondu');
    if (p.mulege) add('actor_ayunt_mulege');
    if (!p.any) add('actor_oomsapas_cabos', 'actor_implan_cabos', 'actor_ayunt_cabos', 'actor_ayunt_lapaz');
  }
  if (p.compare) {
    add('dq_comparar_polos', 'rc_sibcs', 'const_dma_deficit', 'const_red_aislada', 'ev_esc_baseline', 'ev_mesas_trabajo');
    if (p.cabos) add('terr_los_cabos', 'rc_acuifero_0317', 'rc_acuifero_0319', 'dd_turismo_cabos', 'inst_pdu_cabos', 'proj_desal_cabos');
    if (p.paz) add('terr_la_paz', 'rc_acuifero_0324', 'dd_turismo_lapaz', 'inst_pdu_lapaz');
    if (p.comondu) add('terr_comondu', 'dd_agro_santo_domingo');
    if (p.loreto) {
      add('terr_loreto', 'proj_fed_agu_005', 'terr_anp_loreto', 'inst_poel_loreto', 'gap_loreto_dma', 'gap_loreto_energia_local', 'gap_psdu_loreto_gazette', 'dq_pack_loreto');
    }
    if (p.mulege) {
      add('terr_mulege', 'terr_anp_vizcaino', 'gap_pdu_mulege', 'gap_mulege_agua_energia', 'dq_pack_mulege', 'ev_sig_mulege_oasis');
    }
    add('ev_gds_cinco_polos');
  }
  if (/\b(vivienda|housing|hotel\w*|inmobiliari\w*|jll\b)\b/.test(qn)) add('ev_inmob_jll_2025', 'dd_residencial_cabos');
  if (/\bjll\b/.test(qn) || (/\bvivienda\b/.test(qn) && !/\bhotel/.test(qn))) add('ev_jll_zonas_2025');
  if (/\b(sniiv|rezago|registro de vivienda)\b/.test(qn) || (/\bvivienda\b/.test(qn) && !/\bhotel/.test(qn))) {
    add('ev_sniiv_vivienda', 'proj_fed_viv_001', 'rc_acuifero_0317');
  }
  if (/\bhotel/.test(qn) && (p.cabos || p.east || !p.any)) {
    add('terr_anp_cabo_pulmo', 'const_anp_nucleos', 'rc_acuifero_0317', 'ev_anp_avisos');
  }
  if ((kinds.includes('landuse') || /\bcambio de uso\b/.test(qn)) && (p.east || /\bpulmo\b/.test(qn))) {
    add('terr_anp_cabo_pulmo', 'const_anp_nucleos', 'ev_anp_avisos', 'dq_cambio_uso_suelo', 'inst_poerbcs');
  }
  if ((kinds.includes('landuse') || /\bcambio de uso\b/.test(qn)) && p.mulege) {
    add('terr_anp_vizcaino', 'const_anp_nucleos', 'ev_anp_avisos', 'proj_transpeninsular', 'dq_cambio_uso_suelo');
  }
  if (/\b(barriles|cardonal)\b/.test(qn)) {
    add('ev_psdu_barriles', 'gap_east_cape_instrumento', 'gap_east_cape_carga');
  }
  if (/\b(crucero\w*|cruise|aeropuerto\w*|airport|puerto\w*|port\b)\b/.test(qn) || kinds.includes('opportunity')) {
    add('ev_cruceros_datatur', 'ev_aereo_setue', 'rc_aeropuerto_sjd', 'rc_aeropuerto_lap');
  }
  if (/\bcrucero/.test(qn)) add('ev_sig_asipona', 'proj_fed_pue_001', 'ev_cruceros_datatur');
  if (/\b(compuerta|transmision|\b237\b|p23)\b/.test(qn)) {
    add('rc_tx_lapaz_cabos', 'proj_p23_bs1', 'rc_sibcs', 'const_red_aislada');
  }
  if (p.east && /\b(aeropuerto|hotel|vuelo)\b/.test(qn)) add('ev_dossiers_movilidad', 'gap_east_cape_carga');
  if (p.loreto && /\b(vuelo|destino|aeropuerto|\blto\b)\b/.test(qn)) {
    add('ev_dossiers_movilidad', 'ev_sig_vuelos', 'gap_loreto_dma');
  }
  if (p.mulege && /\b(offset|oasis|aeropuerto)\b/.test(qn)) {
    add('ev_dossiers_movilidad', 'ev_sig_mulege_oasis', 'gap_mulege_agua_energia');
  }
  if (/\bescenario\b|\bscenario\b/.test(qn)) {
    if (/\bagua primero\b|\bwater first\b|\bseguridad hidr/.test(qn)) add('ev_esc_water_first');
    else if (/\bcorredor\b|\bintensif/.test(qn)) add('ev_esc_corridor');
    else if (/\bpuerto|\baeropuerto|\bairport|\bport\b/.test(qn)) add('ev_esc_ports');
    else add('ev_esc_baseline', 'ev_esc_water_first');
  }
  if (/\bhuracan|\bhurricane|\brachel\b/.test(qn)) {
    add('ev_sig_hurricanes', 'terr_comondu', 'const_red_aislada', 'actor_cfe');
  }
  if (/\bacoplamiento\b|\bagua[\s-]*energia|\bagua y energia\b|\bwater[\s-]*energy\b|\bapagon|\bacoplan agua\b/.test(qn)) {
    add('ev_sig_water_energy', 'rc_sibcs');
  }
  if (/\bhidrogen|\boasis\b/.test(qn)) add('ev_sig_mulege_oasis', 'gap_mulege_agua_energia');
  if (/\b(conectividad|destinos sin escala|flightconnections)\b/.test(qn)) {
    add('ev_sig_vuelos', 'rc_aeropuerto_sjd', 'rc_aeropuerto_lap', 'ev_aereo_setue');
  }
  if (/\b(vivienda social|insus|infonavit|brisas del valle)\b/.test(qn)) {
    add('ev_sig_vivienda_social', 'proj_fed_viv_001', 'terr_comondu', 'terr_mulege', 'gap_permisos_uso_suelo');
  }
  if (/\b(poel\b|punta nayu)\b/.test(qn) && (p.cabos || !p.any)) add('ev_sig_poel_cabos', 'inst_poel_cabos', 'gap_permisos_uso_suelo');
  if (/\b(peotdu|poetdu|san juan de la costa|playitas|programa subregional)\b/.test(qn)) {
    add('ev_peotdu_instrumentos', 'inst_pdu_lapaz', 'terr_todos_santos');
  }
  if (p.east && /\b(pdu|densidad|boletin|sector privado)\b/.test(qn)) {
    add('ev_news_pdu_este', 'gap_east_cape_carga', 'gap_east_cape_instrumento', 'gap_pdu_cabos_3a');
  }
  if (/\bacuifer|\b0313\b|\b0314\b|\b0317\b|\b0318\b|\b0319\b|\b0320\b|\b0324\b|\b0302\b/.test(qn)) {
    add('ev_acuiferos_dma');
    if (/\b0317\b|cabo san lucas/.test(qn)) add('rc_acuifero_0317');
    if (/\b0318\b|pulmo/.test(qn)) add('rc_acuifero_0318', 'terr_anp_cabo_pulmo');
    if (/\b0319\b|san jose del cabo/.test(qn)) add('rc_acuifero_0319');
    if (/\b0324\b/.test(qn) && p.paz) add('rc_acuifero_0324');
    if (/\b0313\b|todos santos/.test(qn)) add('rc_acuifero_0313');
    if (/\b0320\b|santiago/.test(qn)) add('rc_acuifero_0320');
  }
  if (/\bescorrent|\bhidrosheds|\bcauces?\b/.test(qn)) add('ev_escorrentia');
  if (/\borganigrama|\bdesarrollo urbano\b/.test(qn) && (p.cabos || p.who || !p.any)) {
    add('ev_org_cabos_2024', 'gap_org_obras_cabos', 'actor_implan_cabos', 'actor_oomsapas_cabos');
  }
  if (/\bhistoria|\bfonatur\b|\b1974\b/.test(qn)) add('ev_historia_bcs');
  if (/\bpregunta estrategica\b/.test(qn) || ((/\bcompens\w*\b|\boffset\b/.test(qn)) && p.comondu)) {
    add('ev_preguntas_estrategicas', 'terr_comondu', 'const_dma_deficit', 'dd_agro_santo_domingo');
  }
  if (p.east) {
    add(
      'dq_pack_east_cape', 'rc_acuifero_0318', 'terr_anp_cabo_pulmo', 'terr_obs_east_cape',
      'gap_east_cape_instrumento', 'gap_east_cape_carga', 'const_coast_anp_pressure', 'rc_aeropuerto_sjd',
    );
  }
  if (p.loreto) {
    add(
      'dq_pack_loreto', 'terr_loreto', 'terr_anp_loreto', 'proj_fed_agu_005', 'inst_poel_loreto',
      'gap_psdu_loreto_gazette', 'gap_loreto_dma', 'gap_loreto_energia_local', 'terr_obs_loreto_bay',
    );
  }
  if (p.mulege) {
    add(
      'dq_pack_mulege', 'terr_mulege', 'terr_anp_vizcaino', 'gap_pdu_mulege', 'gap_mulege_agua_energia',
      'dq_vizcaino_corridor', 'terr_obs_vizcaino_spine', 'proj_transpeninsular',
    );
  }
  if (kinds.includes('viability')) {
    if (p.any) add('ev_dossiers_lugar', 'ev_fiscal_anexo_2025');
    if (p.cabos) add('terr_los_cabos');
    if (p.paz) add('terr_la_paz');
    add('dq_viabilidad_proyecto', 'ev_mesas_trabajo', 'inst_poerbcs', 'rc_sibcs', 'const_dma_deficit', 'const_red_aislada', 'const_anp_nucleos');
    if (/\b(hotel\w*|turism|tourism)\b/.test(qn)) {
      add('dd_turismo_cabos', 'dd_residencial_cabos', 'proj_desal_cabos', 'const_coast_anp_pressure', 'rc_acuifero_0317', 'rc_acuifero_0319', 'inst_pdu_cabos', 'actor_oomsapas_cabos', 'rc_aeropuerto_sjd');
      if (p.paz) add('dd_turismo_lapaz', 'inst_pdu_lapaz', 'rc_acuifero_0324');
    }
    if (/\b(desal\w*|desalin\w*)\b/.test(qn)) {
      add('dq_desal_vs_crecimiento', 'inst_ley_aguas', 'actor_cea', 'actor_conagua');
      if (p.paz) add('proj_fed_agu_002', 'rc_acuifero_0324', 'inst_pdu_lapaz', 'const_intrusion_marina');
      else add('proj_desal_cabos', 'proj_fed_agu_001', 'rc_acuifero_0317', 'rc_acuifero_0319', 'actor_oomsapas_cabos');
    }
    if (/\b(parque\s+industrial|industrial\s+park)\b/.test(qn)) {
      add('gap_parque_industrial', 'const_red_aislada', 'inst_poerbcs', 'rc_bess_gap');
    }
    if (/\b(vivienda|housing)\b/.test(qn)) {
      add('proj_fed_viv_001', 'const_tenencia', 'gap_permisos_uso_suelo', 'rc_vivienda_cabos');
      if (p.cabos || !p.any) add('rc_acuifero_0317');
      if (p.paz) add('rc_acuifero_0324');
    }
    if (/\b(carretera|highway|transpeninsular)\b/.test(qn)) {
      add('proj_transpeninsular', 'proj_fed_car_003', 'const_anp_nucleos', 'terr_anp_vizcaino', 'dq_vizcaino_corridor');
    }
    if (/\b(energi\w*|energy|sibcs|cfe)\b/.test(qn)) {
      add('proj_fed_ene_002', 'proj_fed_ene_005', 'proj_p23_bs1', 'inst_prodesen', 'inst_pamrnt', 'rc_bess_gap', 'rc_tx_lapaz_cabos', 'actor_cfe');
      if (!/\b70\b/.test(qn) && !/\b(buenavista|cabo falso)\b/.test(qn)) add('rc_subestaciones_gap');
    }
    if (!kindHit && p.cabos) {
      add('terr_los_cabos', 'inst_pdu_cabos', 'dd_turismo_cabos', 'rc_acuifero_0317', 'rc_acuifero_0319', 'proj_desal_cabos', 'gap_pdu_cabos_3a');
    }
    if (!kindHit && p.paz) {
      add('terr_la_paz', 'inst_pdu_lapaz', 'rc_acuifero_0324', 'gap_pmdu_lapaz_texto', 'proj_fed_agu_002', 'dd_turismo_lapaz');
    }
    if (!kindHit && p.loreto) add('terr_loreto', 'terr_anp_loreto', 'gap_psdu_loreto_gazette', 'proj_fed_agu_005');
    if (!kindHit && p.comondu) add('terr_comondu', 'dd_agro_santo_domingo');
    if (!kindHit && p.mulege) add('terr_mulege', 'terr_anp_vizcaino', 'gap_pdu_mulege');
    if (!kindHit && p.todos) add('terr_todos_santos', 'rc_acuifero_0313', 'gap_pmdu_lapaz_texto');
    if (!kindHit && !p.any) add('dd_turismo_cabos', 'proj_desal_cabos', 'inst_pdu_cabos', 'inst_pdu_lapaz');
  }
  if (kinds.includes('landuse')) {
    add(
      'const_tenencia', 'gap_catastro_secundario', 'const_anp_nucleos',
      'dq_cambio_uso_suelo', 'inst_poerbcs', 'inst_poer_politicas',
      'inst_pa_aprovechamiento', 'inst_pa_preservacion', 'inst_pa_proteccion', 'inst_pa_restauracion',
      'gap_politica_uga_leyenda',
      'const_anp_nucleos', 'const_tenencia', 'const_dma_deficit', 'gap_permisos_uso_suelo', 'dq_coherencia_instrumentos',
    );
    if (!p.any || p.cabos) add('inst_pdu_cabos', 'gap_pdu_cabos_3a', 'inst_poel_cabos', 'terr_los_cabos');
    if (!p.any || p.paz || p.todos) add('inst_pdu_lapaz', 'gap_pmdu_lapaz_texto', 'terr_la_paz');
    if (!p.any || p.loreto) add('gap_psdu_loreto_gazette', 'terr_loreto', 'terr_anp_loreto');
    if (!p.any || p.mulege) add('gap_pdu_mulege', 'terr_mulege', 'terr_anp_vizcaino');
    if (p.comondu) add('terr_comondu');
  }
  if (kinds.includes('risk')) {
    if (p.any) add('ev_dossiers_lugar', 'ev_fiscal_anexo_2025');
    add(
      'dq_riesgos_principales', 'ev_riesgos_documentados', 'gap_riesgo_capas_vector',
      'const_dma_deficit', 'const_escasez_agua', 'const_red_aislada', 'const_anp_nucleos',
      'const_tenencia', 'const_intrusion_marina', 'const_coast_anp_pressure', 'const_ciclo_politico', 'rc_sibcs',
    );
    if (!p.any || p.cabos) add('rc_acuifero_0317', 'rc_acuifero_0319', 'terr_los_cabos', 'const_coast_anp_pressure');
    if (!p.any || p.paz) add('rc_acuifero_0324', 'terr_la_paz');
    if (p.loreto) add('terr_loreto', 'terr_anp_loreto');
    if (p.mulege) add('terr_mulege', 'terr_anp_vizcaino');
    if (p.todos) add('rc_acuifero_0313', 'terr_todos_santos');
    if (p.comondu) add('terr_comondu', 'dd_agro_santo_domingo');
  }
  if (kinds.includes('opportunity')) {
    add('dq_oportunidades', 'inst_poerbcs', 'rc_sibcs', 'const_dma_deficit', 'ev_mesas_trabajo', 'gap_parque_industrial', 'rc_bess_gap');
    if (!p.any || p.cabos) add('dd_turismo_cabos', 'dd_residencial_cabos', 'proj_desal_cabos', 'rc_aeropuerto_sjd', 'proj_p23_bs1');
    if (!p.any || p.paz) add('dd_turismo_lapaz', 'proj_fed_agu_002', 'rc_aeropuerto_lap');
    if (!p.any || p.comondu) add('dd_agro_santo_domingo', 'terr_comondu');
    if (p.loreto) add('terr_loreto', 'proj_fed_agu_005', 'terr_anp_loreto');
    if (p.mulege) add('terr_mulege', 'gap_pdu_mulege');
    if (!p.any) add('proj_fed_ene_002', 'proj_fed_viv_001', 'proj_fed_tur_001', 'dd_eventos_foro');
  }
  return seeds;
}

const FACTOR_DOC_RULES = {
  viability: [
    (c) => (c.path || '').startsWith('guides/agua'),
    (c) => (c.path || '').startsWith('guides/energia'),
    (c) => (c.path || '').startsWith('guides/planeacion'),
    (c) => c.id === 'portal:crecimiento-demand-supply',
    (c) => c.id === 'mesas:agua' || c.id === 'mesas:overview',
    (c) => String(c.id || '').startsWith('factor:'),
  ],
  landuse: [
    (c) => (c.path || '').startsWith('guides/planeacion'),
    (c) => (c.path || '').startsWith('guides/ambiente'),
    (c) => String(c.id || '').startsWith('factor:uso') || String(c.id || '').startsWith('factor:marco'),
  ],
  risk: [
    (c) => (c.path || '').startsWith('guides/riesgos'),
    (c) => (c.path || '').startsWith('guides/agua'),
    (c) => (c.path || '').startsWith('guides/energia'),
    (c) => String(c.id || '').startsWith('factor:riesgos') || String(c.id || '').startsWith('factor:marco'),
  ],
  opportunity: [
    (c) => c.id === 'portal:crecimiento-demand-supply',
    (c) => c.id === 'portal:foresights',
    (c) => String(c.id || '').startsWith('factor:oportun') || String(c.id || '').startsWith('factor:marco'),
  ],
};

const LIB_FOLDERS = {
  viability: ['08_WATER_STRESSED_REGIONS', '05_INFRASTRUCTURE_DEVELOPMENT', '11_MEXICO_BCS'],
  landuse: ['01_REGIONAL_PLANNING', '02_URBAN_PLANNING_DESIGN', '11_MEXICO_BCS'],
  risk: ['09_CLIMATE_RESILIENCE_SUSTAINABILITY', '07_COASTAL_DEVELOPMENT', '08_WATER_STRESSED_REGIONS'],
  opportunity: ['04_URBAN_REGIONAL_ECONOMICS', '07_COASTAL_DEVELOPMENT', '11_MEXICO_BCS'],
};
const NEWS_TOPICS = {
  viability: ['water', 'energy', 'planning', 'tourism', 'land_use'],
  landuse: ['land_use', 'planning', 'environment'],
  risk: ['environment', 'water', 'energy', 'planning'],
  opportunity: ['tourism', 'energy', 'planning', 'land_use', 'water'],
};

function libraryHits(corpus, kinds, seen, query) {
  const folders = [...new Set(kinds.flatMap((k) => LIB_FOLDERS[k] || []))];
  const tokens = tokenize(query || '').filter((t) => t.length > 3);
  const pool = corpus.filter((c) => {
    if (!c || seen.has(c.id) || c.type !== 'library') return false;
    if (!String(c.id || '').includes(':p')) return false;
    const path = String(c.path || '');
    return folders.some((f) => path.includes(f));
  });
  const scored = pool.map((c) => {
    const hay = `${c.id} ${c.title || ''} ${c.path || ''} ${c.sum_es || ''} ${c.sum_en || ''}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 2;
    if (kinds.includes('viability') && /water|desal|infra|08_water|05_infra/.test(hay)) score += 3;
    if (kinds.includes('landuse') && /ordenamiento|planning|pdu|urban|01_regional|02_urban|11_mexico/.test(hay)) score += 3;
    if (kinds.includes('risk') && /climate|coast|hurricane|ocean|hazard|09_climate|07_coastal/.test(hay)) score += 3;
    if (kinds.includes('opportunity') && /econom|tourism|coast|airport|04_urban|07_coastal/.test(hay)) score += 3;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score || String(a.c.id).localeCompare(String(b.c.id)));
  const picked = (scored.some((x) => x.score > 0) ? scored.filter((x) => x.score > 0) : scored).slice(0, 2);
  for (const row of picked) seen.add(row.c.id);
  return picked.map((row) => row.c);
}

function gapCardHits(corpus, query, seen) {
  const tokens = tokenize(query || '').filter((t) => t.length > 3);
  const pool = corpus.filter((c) => c && !seen.has(c.id) && (String(c.id || '').startsWith('gapcard:') || c.id === 'factor:huecos'));
  const scored = pool.map((c) => {
    const hay = `${c.id} ${c.title || ''} ${c.sum_es || ''}`.toLowerCase();
    let score = c.id === 'factor:huecos' ? 1 : 0;
    for (const t of tokens) if (hay.includes(t)) score += 2;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  const spine = pool.find((c) => c.id === 'factor:huecos');
  if (spine) out.push(spine);
  for (const row of scored) {
    if (out.some((c) => c.id === row.c.id)) continue;
    if (row.score <= 0 && row.c.id !== 'factor:huecos') continue;
    out.push(row.c);
    if (out.length >= 2) break;
  }
  for (const c of out) seen.add(c.id);
  return out.slice(0, 2);
}

function newsPlaceIds(place) {
  const ids = [];
  if (place.cabos) ids.push('los_cabos');
  if (place.east) ids.push('east_cape');
  if (place.paz) ids.push('la_paz');
  if (place.loreto) ids.push('loreto');
  if (place.comondu) ids.push('comondu');
  if (place.mulege) ids.push('mulege_north');
  if (place.todos) ids.push('todos_santos', 'la_paz');
  return ids;
}

function newsHits(corpus, kinds, place, seen) {
  const places = newsPlaceIds(place);
  const wantNews = places.length > 0 || kinds.some((k) => k === 'risk' || k === 'opportunity');
  if (!wantNews) return [];
  const topics = new Set(kinds.flatMap((k) => NEWS_TOPICS[k] || []));
  const rows = corpus.filter((c) => {
    if (!c || c.type !== 'news' || seen.has(c.id)) return false;
    if (!c.outlet || !c.date) return false;
    const tops = c.topics || [];
    if (topics.size && tops.length && !tops.some((t) => topics.has(t))) return false;
    if (places.length) {
      const cp = c.place_ids || [];
      if (!cp.some((id) => places.includes(id))) return false;
    }
    return true;
  });
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows.slice(0, 2);
}

function factorDocChunks(kinds, place) {
  const corpus = loadCorpus();
  const out = [];
  const seen = new Set();
  const push = (c) => {
    if (!c || out.some((x) => x.id === c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  for (const kind of kinds) {
    for (const rule of FACTOR_DOC_RULES[kind] || []) {
      const hit = corpus.find((c) => c && !seen.has(c.id) && rule(c));
      if (hit) push(hit);
    }
  }
  const libs = libraryHits(corpus, kinds, seen, place && place.query);
  const gaps = gapCardHits(corpus, place && place.query, seen);
  const news = newsHits(corpus, kinds, place || {}, seen);
  const guides = out.slice(0, 3);
  return [...gaps.slice(0, 2), ...guides, ...libs.slice(0, 2), ...news.slice(0, 2)];
}

/** Ontology factor bundle + a few guide/spine chunks for viability, land use, risks, opportunities. */
function buildFactorEvidence(query, intents) {
  const qn = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const kinds = (intents && intents.factorKinds && intents.factorKinds.length)
    ? intents.factorKinds
    : (expandQuery(query).factorKinds || []);
  if (!kinds.length) return [];
  const place = factorPlaceFlags(qn);
  const ids = walkFactorBundle(factorSeedIds(qn, kinds), place, place.compare ? 20 : 18);
  const onto = ontologyChunksForIds(ids);
  const docs = factorDocChunks(kinds, { ...place, query });
  const seen = new Set();
  const out = [];
  for (const c of [...onto, ...docs]) {
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}


function ontologyChunksForIds(ids) {
  const corpus = loadCorpus();
  const byOnto = new Map();
  for (const c of corpus) {
    if (c.type !== 'ontology') continue;
    const oid = c.onto_id || String(c.id || '').replace(/^onto:/, '');
    byOnto.set(oid, c);
  }
  const out = [];
  for (const id of ids) {
    if (byOnto.has(id)) {
      out.push(byOnto.get(id));
      continue;
    }
    // Fallback: synthesize from graph if corpus miss
    const n = NODE_BY_ID.get(id);
    if (!n) continue;
    const neigh = (ADJ.get(id) || [])
      .slice(0, 6)
      .map(({ pred, id: oid }) => `${pred}→${(NODE_BY_ID.get(oid) || {}).label || oid}`);
    const rel = neigh.length ? ` Relations: ${neigh.join('; ')}.` : '';
    out.push({
      id: `onto:${id}`,
      title: `Ontology ${n.type}: ${n.label || id}`,
      path: `12_ontology/graph.json#${id}`,
      theme: 'ontologia',
      sum_es: `Ontología ${n.type} [${id}] ${n.label || id}. ${n.summary || ''}${rel}`,
      sum_en: `Ontology ${n.type} [${id}] ${n.label_en || n.label || id}. ${n.summary_en || n.summary || ''}${rel}`,
      drive_url: null,
      type: 'ontology',
      onto_id: id,
      onto_type: n.type,
    });
  }
  return out;
}

/** MMR-ish diversify + ontology reserved slots + open-question k */
function retrieve(query, lang, k = 8) {
  const intents = expandQuery(query);
  const mesaIntent = isMesasQuery(query);
  if (mesaIntent && k < 10) k = 10;
  const {
    tokens,
    isDemoIntent,
    isWaterIntent,
    isWaterQuantityIntent,
    isPoerIntent,
    isOpenIntent,
    isTourismAnpIntent,
    isGrowthConstraintIntent,
    isEnergyIntent,
    isEconomyIntent,
    isFacetIntent,
    facetTypes,
    isFactIntent,
    isScenarioIntent,
    isSpatialIntent,
    placeTokens,
  } = intents;
  if (!tokens.length) return [];

  if ((isScenarioIntent || isOpenIntent) && k < 12) k = 14;
  else if (isSpatialIntent && k < 12) k = 12;
  else if ((isFactIntent || isFacetIntent || isEconomyIntent) && k < 12) k = 12;
  else if (isWaterQuantityIntent && k < 12) k = 12;
  else if (isWaterIntent && k < 10) k = 10;
  else if ((isTourismAnpIntent || isGrowthConstraintIntent || isEnergyIntent) && k < 12) k = 12;

  const corpus = loadCorpus();
  const scored = [];
  for (const c of corpus) {
    const s = scoreChunk(tokens, c, lang, intents, placeTokens) + portalGuideBoost(query, c);
    if (s > 0.5) scored.push({ s, c });
  }
  scored.sort((a, b) => b.s - a.s);

  // Prefer type=fact and type=guide for metric / facet questions
  if (isFactIntent || isFacetIntent) {
    for (const row of scored) {
      if (row.c.type === 'fact') row.s += isFactIntent ? 22 : 10;
      else if (row.c.type === 'guide') row.s += isFactIntent ? 8 : 4;
      else if (row.c.type === 'ontology' && isFacetIntent) row.s += 10;
      else if (row.c.type === 'ontology' && isFactIntent && !isFacetIntent) row.s *= 0.7;
      else if (row.c.type === 'still' && (isFactIntent || isFacetIntent)) row.s *= 0.45;
      else if (row.c.type === 'file' && isFactIntent) row.s *= 0.75;
    }
    scored.sort((a, b) => b.s - a.s);
  }

  const reservedOnto =
    isDemoIntent && !isWaterIntent && !isOpenIntent && !isFacetIntent && !isSpatialIntent
      ? 0
      : isEconomyIntent && !isOpenIntent && !isWaterIntent && !isFacetIntent && !isSpatialIntent
        ? 0
      : isFacetIntent
        ? 8
      : isSpatialIntent
        ? 4
      : isOpenIntent || isWaterIntent || isGrowthConstraintIntent || isTourismAnpIntent
        ? 5
        : 3;
  const ontoIds = reservedOnto
    ? pickOntologyNodeIds(tokens, placeTokens, reservedOnto, isFacetIntent ? facetTypes : null)
    : [];
  const ontoInject = ontologyChunksForIds(ontoIds).slice(0, reservedOnto ? reservedOnto + 2 : 0);

  const picked = [];
  const usedBase = new Set();
  const usedTitle = new Set();
  const usedId = new Set();
  const folderCounts = new Map();

  // Reserve ontology slots first
  for (const c of ontoInject) {
    if (picked.length >= reservedOnto) break;
    if (usedId.has(c.id)) continue;
    picked.push(c);
    usedId.add(c.id);
    usedTitle.add((c.title || '').toLowerCase().replace(/\s+/g, ' ').trim());
    folderCounts.set('12_ontology', (folderCounts.get('12_ontology') || 0) + 1);
  }

  if (airAxisQuery(query)) {
    const air = corpus.find((c) => c.id === 'portal:eje-aereo-p116');
    if (air && !usedId.has(air.id)) {
      picked.unshift(air);
      usedId.add(air.id);
    }
  }
  if (namedViewsQuery(query)) {
    const views = corpus.find((c) => c.id === 'portal:vistas-nombres-p118');
    if (views && !usedId.has(views.id)) {
      picked.unshift(views);
      usedId.add(views.id);
    }
  }
  if (evidenceDepthQuery(query)) {
    const ev = corpus.find((c) => c.id === 'portal:evidencia-desal-p119');
    if (ev && !usedId.has(ev.id)) {
      picked.unshift(ev);
      usedId.add(ev.id);
    }
  }
  if (consultaPathQuery(query)) {
    const path = corpus.find((c) => c.id === 'portal:consulta-ruta-p120');
    if (path && !usedId.has(path.id)) {
      picked.unshift(path);
      usedId.add(path.id);
    }
  }
  if (twinReadQuery(query)) {
    const tip = corpus.find((c) => c.id === 'portal:gemelo-leer-p121');
    if (tip && !usedId.has(tip.id)) {
      picked.unshift(tip);
      usedId.add(tip.id);
    }
  }
  if (kitQuery(query)) {
    const kit = corpus.find((c) => c.id === 'portal:foro-kit-p122');
    if (kit && !usedId.has(kit.id)) {
      picked.unshift(kit);
      usedId.add(kit.id);
    }
  }
  if (limitsQuery(query)) {
    const limits = corpus.find((c) => c.id === 'portal:gemelo-limites-p123');
    if (limits && !usedId.has(limits.id)) {
      picked.unshift(limits);
      usedId.add(limits.id);
    }
  }
  if (cierreQuery(query)) {
    const cierre = corpus.find((c) => c.id === 'portal:foro-cierre-p124');
    if (cierre && !usedId.has(cierre.id)) {
      picked.unshift(cierre);
      usedId.add(cierre.id);
    }
  }
  if (rutaQuery(query)) {
    const ruta = corpus.find((c) => c.id === 'portal:foro-ruta-p125');
    if (ruta && !usedId.has(ruta.id)) {
      picked.unshift(ruta);
      usedId.add(ruta.id);
    }
  }
  if (gemelo3dQuery(query)) {
    const twin3 = corpus.find((c) => c.id === 'portal:gemelo-3d-p20');
    if (twin3 && !usedId.has(twin3.id)) {
      picked.unshift(twin3);
      usedId.add(twin3.id);
    }
  }
  if (extrusionQuery(query)) {
    const ext = corpus.find((c) => c.id === 'portal:gemelo-extrusion-p21');
    if (ext && !usedId.has(ext.id)) {
      picked.unshift(ext);
      usedId.add(ext.id);
    }
  }
  if (caminoQuery(query)) {
    const camino = corpus.find((c) => c.id === 'portal:gemelo-camino-p22');
    if (camino && !usedId.has(camino.id)) {
      picked.unshift(camino);
      usedId.add(camino.id);
    }
  }
  if (cruceQuery(query)) {
    const cruce = corpus.find((c) => c.id === 'portal:gemelo-cruce-p23');
    if (cruce && !usedId.has(cruce.id)) {
      picked.unshift(cruce);
      usedId.add(cruce.id);
    }
  }
  if (fichaQuery(query)) {
    const ficha = corpus.find((c) => c.id === 'portal:gemelo-ficha-p24');
    if (ficha && !usedId.has(ficha.id)) {
      picked.unshift(ficha);
      usedId.add(ficha.id);
    }
  }
  if (sideQuery(query)) {
    const side = corpus.find((c) => c.id === 'portal:gemelo-lado-p25');
    if (side && !usedId.has(side.id)) {
      picked.unshift(side);
      usedId.add(side.id);
    }
  }
  if (presetQuery(query)) {
    const preset = corpus.find((c) => c.id === 'portal:gemelo-presets-p26');
    if (preset && !usedId.has(preset.id)) {
      picked.unshift(preset);
      usedId.add(preset.id);
    }
  }
  if (stillFicheQuery(query)) {
    const stills = corpus.find((c) => c.id === 'portal:gemelo-stills-p27');
    if (stills && !usedId.has(stills.id)) {
      picked.unshift(stills);
      usedId.add(stills.id);
    }
  }
  if (atlasQuery(query)) {
    const atlas = corpus.find((c) => c.id === 'portal:gemelo-atlas-p28');
    if (atlas && !usedId.has(atlas.id)) {
      picked.unshift(atlas);
      usedId.add(atlas.id);
    }
  }
  if (novedadesQuery(query)) {
    const news = corpus.find((c) => c.id === 'portal:gemelo-novedades-p29');
    if (news && !usedId.has(news.id)) {
      picked.unshift(news);
      usedId.add(news.id);
    }
  }
  if (readinessQuery(query)) {
    const ready = corpus.find((c) => c.id === 'portal:gemelo-listo-p210');
    if (ready && !usedId.has(ready.id)) {
      picked.unshift(ready);
      usedId.add(ready.id);
    }
  }
  if (walkQuery(query)) {
    const walk = corpus.find((c) => c.id === 'portal:gemelo-recorrido-p211');
    if (walk && !usedId.has(walk.id)) {
      picked.unshift(walk);
      usedId.add(walk.id);
    }
  }
  if (shareQuery(query)) {
    const share = corpus.find((c) => c.id === 'portal:gemelo-copia-p212');
    if (share && !usedId.has(share.id)) {
      picked.unshift(share);
      usedId.add(share.id);
    }
  }
  if (consultaMesaQuery(query)) {
    const mesa = corpus.find((c) => c.id === 'portal:gemelo-consulta-p213');
    if (mesa && !usedId.has(mesa.id)) {
      picked.unshift(mesa);
      usedId.add(mesa.id);
    }
  }
  if (recipeQuery(query)) {
    const recipe = corpus.find((c) => c.id === 'portal:gemelo-recetas-p214');
    if (recipe && !usedId.has(recipe.id)) {
      picked.unshift(recipe);
      usedId.add(recipe.id);
    }
  }
  if (fuentesQuery(query)) {
    const fuentes = corpus.find((c) => c.id === 'portal:gemelo-fuentes-p215');
    if (fuentes && !usedId.has(fuentes.id)) {
      picked.unshift(fuentes);
      usedId.add(fuentes.id);
    }
  }
  if (checklistQuery(query)) {
    const check = corpus.find((c) => c.id === 'portal:gemelo-checklist-p216');
    if (check && !usedId.has(check.id)) {
      picked.unshift(check);
      usedId.add(check.id);
    }
  }

  const docSlots = Math.max(k - picked.length, 6);
  let docsAdded = 0;
  for (const { s, c } of scored) {
    if (docsAdded >= docSlots || picked.length >= k) break;
    if (usedId.has(c.id)) continue;
    const base = (c.path || '').split('/').pop().toLowerCase();
    const titleKey = (c.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (usedBase.has(base) && c.type === 'file') continue;
    if (usedTitle.has(titleKey)) continue;

    const fk = folderKey(c);
    const fc = folderCounts.get(fk) || 0;
    if (fc >= 2 && s < (scored[0]?.s || s) * 0.85 && c.type !== 'ontology') continue;

    picked.push(c);
    usedId.add(c.id);
    usedBase.add(base);
    usedTitle.add(titleKey);
    folderCounts.set(fk, fc + 1);
    if (c.type !== 'ontology') docsAdded += 1;
  }

  // Water: hard-prefer guide agua, ontology DMA, CONAGUA
  if (isWaterIntent) {
    const waterPrefer = scored.filter(({ c }) => {
      const hay = ((c.id || '') + ' ' + (c.path || '') + ' ' + (c.title || '') + ' ' + (c.theme || '')).toLowerCase();
      if (/rc_sibcs|aeropuerto|vivienda|transmisi/i.test(hay) && !/acuifero|dma|agua/i.test(hay)) return false;
      return (
        WATER_PATH_RE.test(hay) ||
        WATER_TITLE_RE.test(hay) ||
        c.type === 'ontology' ||
        (c.id || '').startsWith('water:') ||
        (c.id || '').startsWith('onto:')
      );
    });
    const snap = waterPrefer.filter(({ c }) => /^water:bcs-dma-snapshot$/i.test(c.id || ''));
    const guides = waterPrefer.filter(({ c }) => (c.path || '').startsWith('guides/agua'));
    const onto = waterPrefer.filter(
      ({ c }) =>
        (c.type === 'ontology' || (c.id || '').startsWith('onto:')) &&
        /acuifero|dma|escasez|0313|0317|0319|0324|0318|0320|agua|water/i.test(
          (c.id || '') + (c.title || '') + (c.sum_es || '')
        )
    );
    const files = waterPrefer.filter(({ c }) => /02_water|conagua|dma/i.test((c.path || '') + (c.title || '')));
    const prefer = [
      ...snap.slice(0, 1),
      ...onto.slice(0, 6),
      ...guides.slice(0, 4),
      ...files.slice(0, 5),
    ];
    {
      const seen = new Set(picked.map((p) => p.id));
      const head = [];
      for (const { c } of prefer) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        head.push(c);
      }
      const merged = [...head, ...picked.filter((p) => !head.some((h) => h.id === p.id))];
      picked.length = 0;
      picked.push(...merged.slice(0, k));
    }
    if (!isDemoIntent) {
      const filtered = picked.filter(
        (c) =>
          !(
            c.type === 'municipio' ||
            /05_demographics|demograf|censo|inegi|coneval|panorama_sociodemografico/i.test(
              (c.path || '') + (c.theme || '') + (c.title || '')
            )
          )
      );
      if (filtered.length >= 3) {
        picked.length = 0;
        picked.push(...filtered.slice(0, k));
      }
    }
  }

  if (isEconomyIntent) {
    const econPrefer = scored.filter(({ c }) => {
      const hay = ((c.path || '') + ' ' + (c.title || '') + ' ' + (c.theme || '') + ' ' + (c.sum_es || '')).toLowerCase();
      return (
        /guides\/economia|07_economy|theme.: .economia|pibe|pib_/i.test(hay) ||
        (c.theme || '').toLowerCase() === 'economia' ||
        /187152|181155|pib a valores constantes|pib constante/i.test(normalizeNumberForms(hay))
      );
    });
    const guides = econPrefer.filter(({ c }) => (c.path || '').startsWith('guides/economia'));
    const files = econPrefer.filter(({ c }) => /07_economy|pibe|pib_/i.test((c.path || '') + (c.title || '')));
    const prefer = [...guides.slice(0, 4), ...files.slice(0, 4)];
    if (prefer.length) {
      const head = [];
      const seenHead = new Set();
      for (const { c } of prefer) {
        if (seenHead.has(c.id)) continue;
        seenHead.add(c.id);
        head.push(c);
      }
      // Promote economy guides/PIBE ahead of ontology noise for factoid queries
      const merged = [...head, ...picked.filter((p) => !seenHead.has(p.id))];
      picked.length = 0;
      picked.push(...merged.slice(0, k));
    }
  }

  if (isWaterIntent && placeTokens && placeTokens.size) {

    const placeHit = scored.filter(({ c }) => {
      const h = ((c.title || '') + (c.path || '') + (c.sum_es || '') + (c.sum_en || ''))
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return [...placeTokens].some((pt) => h.includes(pt));
    });
    const guides = scored.filter(({ c }) => (c.path || '').startsWith('guides/agua'));
    const prefer = [...placeHit.slice(0, 4), ...guides.slice(0, 3)];
    for (const { c } of prefer) {
      if (picked.some((p) => p.id === c.id)) continue;
      picked.unshift(c);
      if (picked.length > k) picked.pop();
    }
  }


  if (isFactIntent || isEconomyIntent) {
    const factPrefer = scored.filter(({ c }) => c.type === 'fact' || c.type === 'guide');
    const facts = factPrefer.filter(({ c }) => c.type === 'fact').slice(0, 4).map((x) => x.c);
    const guides = factPrefer.filter(({ c }) => c.type === 'guide').slice(0, 4).map((x) => x.c);
    const head = [...facts, ...guides];
    if (head.length) {
      const seenHead = new Set(head.map((c) => c.id));
      const merged = [...head, ...picked.filter((p) => !seenHead.has(p.id))];
      picked.length = 0;
      picked.push(...merged.slice(0, k));
    }
  }

  // Tourism ↔ ANP: ensure coast-ANP constraint + stills
  if (isTourismAnpIntent && !isSpatialIntent) {
    const preferIds = ['const_coast_anp_pressure', 'const_anp_nucleos', 'dd_turismo_cabos', 'actor_conanp'];
    const extra = ontologyChunksForIds(preferIds);
    const stills = scored
      .filter(({ c }) => c.type === 'still')
      .slice(0, 4)
      .map((x) => x.c);
    const head = [...extra, ...stills];
    const seen = new Set();
    const merged = [];
    for (const c of [...head, ...picked]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    picked.length = 0;
    picked.push(...merged.slice(0, k));
  }

  // Spatial / maps / stills: force 1–2 still/map sources into top-k + Territory observations
  if (isSpatialIntent) {
    const stills = scored.filter(({ c }) => c.type === 'still').slice(0, 4).map((x) => x.c);
    const mapGuides = scored
      .filter(({ c }) =>
        /portal:\/(mapas|stills|earth)|portal:mapas|portal:stills|portal:earth|portal:map-gallery|stillmuni:|still:overview|guides\/territorio/i.test(
          (c.id || '') + (c.path || '')
        ) || (c.href && /\/(mapas|stills|earth-studio)/.test(c.href))
      )
      .slice(0, 3)
      .map((x) => x.c);
    const terrOnto = scored
      .filter(({ c }) =>
        c.type === 'ontology' &&
        /Territory|terr_obs_|terr_los_cabos|terr_loreto|terr_anp_|ev_stills/i.test(
          (c.id || '') + (c.onto_type || '') + (c.title || '')
        )
      )
      .slice(0, 3)
      .map((x) => x.c);
    const head = [...stills.slice(0, 2), ...mapGuides.slice(0, 2), ...terrOnto.slice(0, 2)];
    const seen = new Set();
    const merged = [];
    for (const c of [...head, ...picked]) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    picked.length = 0;
    picked.push(...merged.slice(0, k));
  }

  // Growth constraints Los Cabos: PDU / DMA / SIBCS
  if (isGrowthConstraintIntent) {
    const preferIds = [
      'const_escasez_agua',
      'const_dma_deficit',
      'const_red_aislada',
      'const_tenencia',
      'inst_pdu_cabos',
      'rc_sibcs',
      'terr_los_cabos',
      'dd_turismo_cabos',
    ];
    const extra = ontologyChunksForIds(preferIds);
    const docs = scored
      .filter(({ c }) =>
        /pdu|dma|sibcs|guides\/(agua|planeacion|energia)|01_planning|02_water|03_energy/i.test(
          (c.path || '') + (c.title || '') + (c.id || '')
        )
      )
      .slice(0, 6)
      .map((x) => x.c);
    const seen = new Set();
    const merged = [];
    for (const c of [...extra, ...docs, ...picked]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    picked.length = 0;
    picked.push(...merged.slice(0, k));
  }

  if (isDemoIntent) {
    const hasDemo = picked.some(
      (c) =>
        c.type === 'municipio' ||
        DEMO_PATH_RE.test((c.path || '') + (c.theme || '') + (c.title || ''))
    );
    if (!hasDemo) {
      const demoScored = scored.filter(
        ({ c }) =>
          c.type === 'municipio' ||
          DEMO_PATH_RE.test((c.path || '') + (c.theme || '') + (c.title || ''))
      );
      for (const { c } of demoScored.slice(0, 4)) {
        const titleKey = (c.title || '').toLowerCase();
        if (picked.some((p) => (p.title || '').toLowerCase() === titleKey)) continue;
        picked.unshift(c);
        if (picked.length > k) picked.pop();
      }
    }
  }

  // Scenario (e.g. water × triple population): force BOTH water AND population baselines.
  // ITER ontology cards can falsely satisfy isDemoIntent without carrying POBTOT.
  if (isScenarioIntent) {
    const isPopBaseline = (c) => {
      const hay = ((c.id || '') + ' ' + (c.path || '') + ' ' + (c.title || '') + ' ' + (c.sum_es || '')).toLowerCase();
      return (
        /poblaci[oó]n estatal|pobtot\s*=\s*798|798\s*,?\s*447|fact:territorio:poblac/i.test(hay) ||
        ((c.path || '').startsWith('guides/territorio') && /798\s*,?\s*447|pobtot/i.test(hay)) ||
        ((c.type === 'fact' || c.type === 'guide') &&
          /territorio|demograf|05_demographics/.test(hay) &&
          /798|pobtot|poblac/.test(hay))
      );
    };
    const isWaterBaseline = (c) => {
      const hay = ((c.id || '') + ' ' + (c.path || '') + ' ' + (c.title || '') + ' ' + (c.sum_es || '')).toLowerCase();
      return (
        /^water:bcs-dma-snapshot$/i.test(c.id || '') ||
        (c.path || '').startsWith('guides/agua') ||
        (c.type === 'fact' && /agua|dma|hm3|conagua/.test(hay)) ||
        (c.type === 'ontology' && /acuifero|dma|escasez|resourcecapacity|0317|0319|0324/.test(hay))
      );
    };
    const popPool = scored.map((x) => x.c).filter(isPopBaseline);
    const waterPool = scored.map((x) => x.c).filter(isWaterBaseline);
    // Prefer explicit statewide POBTOT fact first
    popPool.sort((a, b) => {
      const score = (c) =>
        /poblaci[oó]n estatal|798\s*,?\s*447/.test(
          ((c.id || '') + (c.sum_es || '') + (c.title || '')).toLowerCase()
        )
          ? 0
          : 1;
      return score(a) - score(b);
    });
    const head = [];
    const seen = new Set();
    for (const c of [...popPool.slice(0, 3), ...waterPool.slice(0, 6)]) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      head.push(c);
    }
    const merged = [...head, ...picked.filter((p) => !seen.has(p.id))];
    picked.length = 0;
    picked.push(...merged.slice(0, Math.max(k, 14)));
  }

  // Ensure ontology reserved count still present after merges
  const ontoCount = picked.filter((c) => c.type === 'ontology').length;
  if (ontoCount < Math.min(3, reservedOnto)) {
    for (const c of ontoInject) {
      if (picked.some((p) => p.id === c.id)) continue;
      picked.splice(Math.min(picked.length, 2), 0, c);
      if (picked.length > k) picked.pop();
      if (picked.filter((x) => x.type === 'ontology').length >= 3) break;
    }
  }

  // Internal working tables: keep the exact mesa chunk in context for membership and authority asks.
  if (mesaIntent) {
    const qmesa = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const preferred = /\b(cea|conagua|comision\s+estatal\s+del\s+agua)\b/.test(qmesa)
      ? 'mesas:agua'
      : /\b(sepuimm|energia|telecomunicaciones)\b/.test(qmesa)
        ? 'mesas:infraestructura-energia'
        : null;
    const mesaRows = scored
      .filter(({ c }) => String(c.id || '').startsWith('mesas:') && c.id !== 'mesas:overview')
      .sort((a, b) => (preferred && a.c.id === preferred ? -1 : 0) - (preferred && b.c.id === preferred ? -1 : 0) || b.s - a.s)
      .slice(0, 2)
      .map(({ c }) => c);
    if (mesaRows.length) {
      const seen = new Set();
      const merged = [];
      for (const c of [...mesaRows, ...picked]) {
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        merged.push(c);
      }
      picked.length = 0;
      picked.push(...merged.slice(0, k));
    }
  }

  // 14_gobierno: Organigrama H. XV Ayuntamiento de Los Cabos — "¿quién dirige / quién es el titular…?"
  // Guarantee the 2 best organigrama chunks when the ask is about who heads a Los Cabos unit.
  {
    if (isGovWhoQuery(query)) {
      const gov = scored.filter(({ c }) => String(c.id || '').startsWith('gobierno:')).slice(0, 2).map(({ c }) => c);
      if (gov.length) {
        const rest = picked.filter((p) => !gov.some((g) => g.id === p.id));
        picked.length = 0;
        picked.push(...gov, ...rest.slice(0, Math.max(0, k - gov.length)));
      }
    }
  }

  // BCS2050 Library: when the user asks for references / international guidance,
  // guarantee up to 4 library extracts (max 2 per document) in the final context.
  if (intents.isLibraryIntent) {
    const explicitLib = /\b(biblioteca|library|bibliograf|lecturas?|referencias?)\b/.test(
      String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    const want = explicitLib ? 4 : 2;
    const have = picked.filter((c) => c.type === 'library').length;
    if (have < want) {
      const perDoc = new Map();
      for (const c of picked) if (c.type === 'library') perDoc.set(c.lib_id || c.id, (perDoc.get(c.lib_id || c.id) || 0) + 1);
      const libs = [];
      for (const { c } of scored) {
        if (c.type !== 'library' || picked.some((p) => p.id === c.id)) continue;
        const key = c.lib_id || c.id;
        if ((perDoc.get(key) || 0) >= 2) continue;
        perDoc.set(key, (perDoc.get(key) || 0) + 1);
        libs.push(c);
        if (have + libs.length >= want) break;
      }
      if (libs.length) {
        const keepN = Math.max(0, Math.min(picked.length, k) - libs.length);
        const out = picked.slice(0, keepN);
        picked.length = 0;
        picked.push(...out, ...libs);
      }
    }
  }

  if (airAxisQuery(query)) {
    const air = corpus.find((c) => c.id === 'portal:eje-aereo-p116');
    if (air) {
      const rest = picked.filter((c) => c.id !== air.id);
      picked.length = 0;
      picked.push(air, ...rest);
    }
  }
  if (namedViewsQuery(query)) {
    const views = corpus.find((c) => c.id === 'portal:vistas-nombres-p118');
    if (views) {
      const rest = picked.filter((c) => c.id !== views.id);
      picked.length = 0;
      picked.push(views, ...rest);
    }
  }
  if (evidenceDepthQuery(query)) {
    const ev = corpus.find((c) => c.id === 'portal:evidencia-desal-p119');
    if (ev) {
      const rest = picked.filter((c) => c.id !== ev.id);
      picked.length = 0;
      picked.push(ev, ...rest);
    }
  }
  if (consultaPathQuery(query)) {
    const path = corpus.find((c) => c.id === 'portal:consulta-ruta-p120');
    if (path) {
      const rest = picked.filter((c) => c.id !== path.id);
      picked.length = 0;
      picked.push(path, ...rest);
    }
  }
  if (twinReadQuery(query)) {
    const tip = corpus.find((c) => c.id === 'portal:gemelo-leer-p121');
    if (tip) {
      const rest = picked.filter((c) => c.id !== tip.id);
      picked.length = 0;
      picked.push(tip, ...rest);
    }
  }
  if (kitQuery(query)) {
    const kit = corpus.find((c) => c.id === 'portal:foro-kit-p122');
    if (kit) {
      const rest = picked.filter((c) => c.id !== kit.id);
      picked.length = 0;
      picked.push(kit, ...rest);
    }
  }
  if (limitsQuery(query)) {
    const limits = corpus.find((c) => c.id === 'portal:gemelo-limites-p123');
    if (limits) {
      const rest = picked.filter((c) => c.id !== limits.id);
      picked.length = 0;
      picked.push(limits, ...rest);
    }
  }
  if (cierreQuery(query)) {
    const cierre = corpus.find((c) => c.id === 'portal:foro-cierre-p124');
    if (cierre) {
      const rest = picked.filter((c) => c.id !== cierre.id);
      picked.length = 0;
      picked.push(cierre, ...rest);
    }
  }
  if (rutaQuery(query)) {
    const ruta = corpus.find((c) => c.id === 'portal:foro-ruta-p125');
    if (ruta) {
      const rest = picked.filter((c) => c.id !== ruta.id);
      picked.length = 0;
      picked.push(ruta, ...rest);
    }
  }
  if (gemelo3dQuery(query)) {
    const twin3 = corpus.find((c) => c.id === 'portal:gemelo-3d-p20');
    if (twin3) {
      const rest = picked.filter((c) => c.id !== twin3.id);
      picked.length = 0;
      picked.push(twin3, ...rest);
    }
  }
  if (extrusionQuery(query)) {
    const ext = corpus.find((c) => c.id === 'portal:gemelo-extrusion-p21');
    if (ext) {
      const rest = picked.filter((c) => c.id !== ext.id);
      picked.length = 0;
      picked.push(ext, ...rest);
    }
  }
  if (caminoQuery(query)) {
    const camino = corpus.find((c) => c.id === 'portal:gemelo-camino-p22');
    if (camino) {
      const rest = picked.filter((c) => c.id !== camino.id);
      picked.length = 0;
      picked.push(camino, ...rest);
    }
  }
  if (cruceQuery(query)) {
    const cruce = corpus.find((c) => c.id === 'portal:gemelo-cruce-p23');
    if (cruce) {
      const rest = picked.filter((c) => c.id !== cruce.id);
      picked.length = 0;
      picked.push(cruce, ...rest);
    }
  }
  if (fichaQuery(query)) {
    const ficha = corpus.find((c) => c.id === 'portal:gemelo-ficha-p24');
    if (ficha) {
      const rest = picked.filter((c) => c.id !== ficha.id);
      picked.length = 0;
      picked.push(ficha, ...rest);
    }
  }
  if (sideQuery(query)) {
    const side = corpus.find((c) => c.id === 'portal:gemelo-lado-p25');
    if (side) {
      const rest = picked.filter((c) => c.id !== side.id);
      picked.length = 0;
      picked.push(side, ...rest);
    }
  }
  if (presetQuery(query)) {
    const preset = corpus.find((c) => c.id === 'portal:gemelo-presets-p26');
    if (preset) {
      const rest = picked.filter((c) => c.id !== preset.id);
      picked.length = 0;
      picked.push(preset, ...rest);
    }
  }
  if (stillFicheQuery(query)) {
    const stills = corpus.find((c) => c.id === 'portal:gemelo-stills-p27');
    if (stills) {
      const rest = picked.filter((c) => c.id !== stills.id);
      picked.length = 0;
      picked.push(stills, ...rest);
    }
  }
  if (atlasQuery(query)) {
    const atlas = corpus.find((c) => c.id === 'portal:gemelo-atlas-p28');
    if (atlas) {
      const rest = picked.filter((c) => c.id !== atlas.id);
      picked.length = 0;
      picked.push(atlas, ...rest);
    }
  }
  if (novedadesQuery(query)) {
    const news = corpus.find((c) => c.id === 'portal:gemelo-novedades-p29');
    if (news) {
      const rest = picked.filter((c) => c.id !== news.id);
      picked.length = 0;
      picked.push(news, ...rest);
    }
  }
  if (readinessQuery(query)) {
    const ready = corpus.find((c) => c.id === 'portal:gemelo-listo-p210');
    if (ready) {
      const rest = picked.filter((c) => c.id !== ready.id);
      picked.length = 0;
      picked.push(ready, ...rest);
    }
  }
  if (walkQuery(query)) {
    const walk = corpus.find((c) => c.id === 'portal:gemelo-recorrido-p211');
    if (walk) {
      const rest = picked.filter((c) => c.id !== walk.id);
      picked.length = 0;
      picked.push(walk, ...rest);
    }
  }
  if (shareQuery(query)) {
    const share = corpus.find((c) => c.id === 'portal:gemelo-copia-p212');
    if (share) {
      const rest = picked.filter((c) => c.id !== share.id);
      picked.length = 0;
      picked.push(share, ...rest);
    }
  }
  if (consultaMesaQuery(query)) {
    const mesa = corpus.find((c) => c.id === 'portal:gemelo-consulta-p213');
    if (mesa) {
      const rest = picked.filter((c) => c.id !== mesa.id);
      picked.length = 0;
      picked.push(mesa, ...rest);
    }
  }
  if (recipeQuery(query)) {
    const recipe = corpus.find((c) => c.id === 'portal:gemelo-recetas-p214');
    if (recipe) {
      const rest = picked.filter((c) => c.id !== recipe.id);
      picked.length = 0;
      picked.push(recipe, ...rest);
    }
  }
  if (fuentesQuery(query)) {
    const fuentes = corpus.find((c) => c.id === 'portal:gemelo-fuentes-p215');
    if (fuentes) {
      const rest = picked.filter((c) => c.id !== fuentes.id);
      picked.length = 0;
      picked.push(fuentes, ...rest);
    }
  }
  if (checklistQuery(query)) {
    const check = corpus.find((c) => c.id === 'portal:gemelo-checklist-p216');
    if (check) {
      const rest = picked.filter((c) => c.id !== check.id);
      picked.length = 0;
      picked.push(check, ...rest);
    }
  }

  if (intents.isFactorIntent) {
    const bundle = buildFactorEvidence(query, intents);
    if (bundle.length) {
      const seen = new Set();
      const merged = [];
      for (const c of [...bundle, ...picked]) {
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        merged.push(c);
      }
      picked.length = 0;
      picked.push(...merged);
      if (k < 16) k = 16;
    }
  }

  return picked.slice(0, k);
}

function driveFileId(url) {
  const m = String(url || '').match(/\/file\/d\/([^/]+)/);
  return m ? m[1] : null;
}

function driveDownloadUrl(viewUrl) {
  const id = driveFileId(viewUrl);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
}

function catalogHref(chunk) {
  const q = (chunk.title || chunk.path || '').split('/').pop() || chunk.title || '';
  return `/catalogo?q=${encodeURIComponent(q)}`;
}

/** Rank retrieved catalog chunks → one primary Drive-linked PDF/doc (never 08_fp_team_research). */
function pickPrimaryFile(chunks, query, intents) {
  const qn = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const place = intents?.placeTokens || new Set();
  const cabosQ = place.has('cabos') || place.has('lucas') || /\blos\s+cabos\b/.test(qn);
  const pazQ = (place.has('paz') || /\bla\s+paz\b/.test(qn)) && !cabosQ;

  const candidates = [];
  for (const c of chunks || []) {
    if (!c || c.type === 'ontology' || c.type === 'still' || c.type === 'municipio') continue;
    const path = String(c.path || '');
    if (FP_TEAM_HIDE.test(path)) continue;
    if (c.type === 'guide' && !c.drive_url) {
      // guides without Drive stay catalog-only; keep as weak fallback
    }
    const title = String(c.title || '');
    const hay = `${title} ${path} ${c.theme || ''} ${c.sum_es || ''} ${c.sum_en || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    let s = 0;
    if (c.drive_url) s += 16;
    else s -= 4; // prefer real Drive docs over catalog-only guides
    if (c.type === 'file') s += 6;
    if (c.type === 'guide') s += 1;
    if (/\.pdf($|\?)/i.test(path) || /\.pdf/i.test(title)) s += 4;
    if (/\.(docx?|xlsx?|pptx?)($|\?)/i.test(path)) s += 2;
    if (/pdu/.test(qn) && /pdu/i.test(hay)) s += 10;
    if (/poer/.test(qn) && /poer/i.test(hay)) s += 10;
    if (/conagua|dma/.test(qn) && /conagua|dma/i.test(hay)) s += 8;
    // Place-aware: Los Cabos PDU must not lose to La Paz PDUCP
    if (cabosQ) {
      if (/los\s*cabos|pdu\s*2040|implan.*cabos|oomsapas.*cabos|0317|0319/.test(hay)) s += 12;
      if (/la\s*paz|pdu[ck]?p|centro\s+de\s+poblacion/.test(hay) && !/cabos/.test(hay)) s -= 20;
    }
    if (pazQ) {
      if (/la\s*paz|pdu[ck]?p|centro\s+de\s+poblacion|0324/.test(hay)) s += 12;
      if (/los\s*cabos|pdu\s*2040/.test(hay) && !/paz/.test(hay)) s -= 20;
    }
    if (intents?.isWaterIntent && /02_water|conagua|dma|cea|oomsapas|agua/.test(hay)) s += 8;
    if (intents?.isPlanningIntent && /01_planning|pdu|poer|ordenamiento|planeacion/.test(hay)) s += 8;
    if (intents?.isEnergyIntent && /03_energy|sibcs|cfe|cenace|prodesen|pamrnt/.test(hay)) s += 8;
    if (intents?.isDemoIntent && /05_demographics|inegi|censo|poblacion/.test(hay)) s += 8;
    // Prefer substance
    const sumLen = ((c.sum_es || '') + (c.sum_en || '')).length;
    if (sumLen > 120) s += 2;
    if (s > 0) candidates.push({ s, c });
  }
  // If retrieved set lacks a Drive file, scan corpus for a topical Drive PDF/doc
  const hasDrive = candidates.some(({ c }) => c.drive_url && c.type === 'file');
  if (!hasDrive) {
    const corpus = loadCorpus();
    const tokens = tokenize(query);
    for (const c of corpus) {
      if (c.type !== 'file' || !c.drive_url) continue;
      const path = String(c.path || '');
      if (FP_TEAM_HIDE.test(path)) continue;
      const title = String(c.title || '');
      const hay = `${title} ${path} ${c.theme || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      let s = 8; // base for Drive file fallback
      let hits = 0;
      for (const t of tokens) {
        if (t.length > 2 && hay.includes(t)) {
          hits += 1;
          s += 2;
        }
      }
      if (cabosQ && /cabos|0317|0319/.test(hay)) s += 10;
      if (pazQ && /la paz|lapaz|0324|pdu[ck]?p/.test(hay)) s += 10;
      if (cabosQ && /la paz|pdu[ck]?p|centro de poblacion/.test(hay) && !/cabos/.test(hay)) continue;
      if (pazQ && /los cabos|pdu 2040/.test(hay) && !/paz/.test(hay)) continue;
      if (intents?.isWaterIntent && /02_water|conagua|dma/.test(hay)) s += 8;
      if (intents?.isPlanningIntent && /01_planning|pdu|poer/.test(hay)) s += 8;
      if (/pdu/.test(qn) && /pdu/.test(hay)) s += 12;
      if (hits < 1 && s < 18) continue;
      candidates.push({ s, c });
    }
  }

  candidates.sort((a, b) => b.s - a.s);
  // Prefer any Drive-linked file over a guide without Drive
  const driveBest = candidates.find(({ c }) => c.drive_url);
  const best = (driveBest || candidates[0])?.c;
  if (!best) return null;
  const view = best.drive_url || null;
  const whyParts = [];
  if (best.type === 'file') whyParts.push('top catalog match');
  if (best.type === 'guide') whyParts.push('portal guide');
  if (view) whyParts.push('Drive link available');
  if (cabosQ && /cabos/i.test(best.title + best.path)) whyParts.push('Los Cabos place match');
  if (pazQ && /paz/i.test(best.title + best.path)) whyParts.push('La Paz place match');
  return {
    title: cardTitle(best),
    theme_label: best.theme_label || null,
    path: best.path || null,
    view_url: view,
    download_url: view ? driveDownloadUrl(view) : null,
    catalog_url: catalogHref(best),
    why: whyParts.join(' · ') || 'best retrieved document',
  };
}

/** 2–5 ontology nodes with 1-hop why + /ontologia#id hrefs. Prefer instruments/evidence/DQs. */
function buildOntologyLinks(chunks, query, intents, max = 5, strict = false) {
  const place = intents?.placeTokens || new Set();
  const cabosQ = place.has('cabos') || place.has('lucas') || place.has('jose');
  const pazQ = place.has('paz') && !cabosQ;

  const ids = [];
  const seen = new Set();
  for (const c of chunks || []) {
    if (c.type !== 'ontology') continue;
    const id = c.onto_id || String(c.id || '').replace(/^onto:/, '');
    if (!id || seen.has(id)) continue;
    if (cabosQ && id === 'inst_pdu_lapaz') continue;
    if (pazQ && id === 'inst_pdu_cabos') continue;
    seen.add(id);
    ids.push(id);
  }
  // Fill from graph pick if thin (never in strict/grounded mode)
  if (!strict && ids.length < 2) {
    const { tokens, placeTokens } = expandQuery(query);
    for (const id of pickOntologyNodeIds(tokens, placeTokens, 4)) {
      if (seen.has(id)) continue;
      if (cabosQ && id === 'inst_pdu_lapaz') continue;
      if (pazQ && id === 'inst_pdu_cabos') continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= max) break;
    }
  }

  const typeBoost = (t) => {
    if (/Instrument|Evidence|DecisionQuestion|Constraint/i.test(t || '')) return 3;
    if (/ResourceCapacity|Actor|DemandDriver/i.test(t || '')) return 2;
    return 1;
  };
  const ranked = ids
    .map((id) => {
      const n = NODE_BY_ID.get(id);
      if (!n) return null;
      let s = typeBoost(n.type);
      const hay = `${n.id} ${n.label || ''} ${n.label_en || ''}`.toLowerCase();
      if (cabosQ && /cabos|0317|0319/.test(hay + id)) s += 5;
      if (pazQ && /la paz|lapaz|0324/.test(hay + id)) s += 5;
      return { s, n };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s)
    .slice(0, max);

  return ranked.map(({ n }) => {
    const neigh = (ADJ.get(n.id) || []).slice(0, 3);
    const whyBits = neigh.map(({ pred, id: nid }) => {
      const nn = NODE_BY_ID.get(nid);
      return `${pred}→${(nn && (nn.label_en || nn.label)) || nid}`;
    });
    const why =
      whyBits.length > 0
        ? whyBits.join('; ')
        : (n.summary_en || n.summary || n.type || '').slice(0, 120);
    return {
      id: n.id,
      label: n.label_en || n.label || n.id,
      label_es: n.label || n.label_en || n.id,
      kind: n.type || 'Node',
      href: `/ontologia#${encodeURIComponent(n.id)}`,
      why,
    };
  });
}

/** Match topic/file authority to stakeholders directory — institutional preferred; null if weak. */
function pickStakeholder(query, chunks, primaryFile, intents) {
  if (!STAKEHOLDERS.length) return null;
  const qn = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const blobParts = [qn];
  if (primaryFile) blobParts.push(String(primaryFile.title || ''), String(primaryFile.path || ''));
  for (const c of (chunks || []).slice(0, 8)) {
    blobParts.push(c.title || '', c.path || '', c.onto_id || '');
  }
  const blob = blobParts
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const place = intents?.placeTokens || new Set();
  const cabosQ = place.has('cabos') || place.has('lucas') || /\blos\s+cabos\b/.test(qn);
  const pazQ = (place.has('paz') || /\bla\s+paz\b/.test(qn)) && !cabosQ;

  const KEYWORDS = [
    { re: /\bsepuimm\b|poerbcs|ordenamiento\s+ecologico/, boost: 20, prefer: /sepuimm/i },
    { re: /\bconagua\b|dma|acuifero|disponibilidad/, boost: 18, prefer: /conagua/i },
    { re: /\bcea\b|desal|ley\s+de\s+aguas/, boost: 14, prefer: /\bcea\b/i },
    { re: /oomsapas/, boost: 16, prefer: /oomsapas/i },
    { re: /\bpdu\b|implan|planeacion\s+urbana|usos\s+de\s+suelo/, boost: 16, prefer: /implan/i },
    { re: /\bcfe\b|sibcs|transmision|electri/, boost: 14, prefer: /\bcfe\b/i },
    { re: /\bcenace\b|pamrnt|prodesen/, boost: 14, prefer: /cenace/i },
    { re: /\bconanp\b|anp|protegida|vizcaino|pulmo/, boost: 14, prefer: /conanp|sierra\s+la\s+laguna/i },
    { re: /ayuntamiento|alcalde|mayor/, boost: 10, prefer: /mayor|ayuntamiento/i },
  ];

  const scored = [];
  for (const st of STAKEHOLDERS) {
    const hay = `${st.name || ''} ${st.description || ''} ${st.org || ''} ${st.group || ''} ${st.subgroup || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    let s = 0;
    for (const kw of KEYWORDS) {
      if (kw.re.test(blob) && kw.prefer.test(hay)) s += kw.boost;
    }
    // token overlap with query/file
    for (const t of tokenize(query)) {
      if (t.length > 3 && hay.includes(t)) s += 1.5;
    }
    if (cabosQ && /los cabos|cabos/.test(hay)) s += 6;
    if (pazQ && /la paz/.test(hay)) s += 6;
    if (cabosQ && /la paz/.test(hay) && !/cabos/.test(hay)) s -= 8;
    if (pazQ && /los cabos|cabos/.test(hay) && !/paz/.test(hay)) s -= 8;
    // Prefer institutional / authority contacts over F+P leads unless clearly about F+P
    if (/f\+p lead|foster/i.test(st.org || '') || /f\+p lead/i.test(st.description || '')) {
      if (!/\bf\+p\b|foster|bruno|doretta|laura narvaez|peter sharratt/i.test(blob)) s -= 12;
    }
    if (st.type === 'institution') s += 3;
    if (st.contact) s += 1;
    if (s >= 8) scored.push({ s, st });
  }
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || best.s < 10) return null;
  const st = best.st;
  const qName = encodeURIComponent(st.name || st.org || '');
  const idPart = st.id ? `&id=${encodeURIComponent(st.id)}` : '';
  return {
    id: st.id || null,
    name: st.name || st.org || 'Contact',
    description: st.description || '',
    contact: st.contact || '',
    group: st.group || '',
    subgroup: st.subgroup || '',
    org: st.org || null,
    type: st.type || 'person',
    href: `/stakeholders?q=${qName}${idPart}`,
  };
}

function scrubOntologyIdsFromAnswer(answer) {
  return String(answer || '')
    .replace(/\bontology\s+node\s+id\s*:\s*[a-z0-9_]+/gi, '')
    .replace(/\bnodo\s+de\s+ontolog[ií]a\s*:\s*[a-z0-9_]+/gi, '')
    .replace(/\bid\s+de\s+nodo\s*(?:de\s+ontolog[ií]a)?\s*:\s*[a-z0-9_]+/gi, '')
    .replace(/\[onto:[a-z0-9_]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dedupeSources(chunks, max = 5, preferDrive = true, preferSpatial = false) {
  const out = [];
  const seen = new Set();
  // Prefer ontology cards + Drive docs with real relevance; demote filename stubs
  const rank = (c) => {
    if (preferSpatial && c.type === 'still') return -1;
    if (preferSpatial && /portal\/(mapas|stills|earth)|map-gallery|stillmuni:|still:overview/i.test((c.id || '') + (c.path || '')))
      return -0.5;
    if (c.type === 'ontology') return 0;
    if (c.type === 'guide') return 1;
    if (c.type === 'library') return 1.5;
    if (c.drive_url && ((c.sum_es || '').length > 80 || (c.sum_en || '').length > 80)) return 2;
    if (c.type === 'still') return 3;
    if (c.drive_url) return 4;
    return 5;
  };
  const ordered = [...chunks].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    if (preferDrive) return (b.drive_url ? 1 : 0) - (a.drive_url ? 1 : 0);
    return 0;
  });
  for (const c of ordered) {
    const base = (c.path || '').split('/').pop().toLowerCase();
    const title = (c.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const key = c.type === 'library' && c.lib_id ? 'lib:' + c.lib_id : base + '||' + title;
    if (seen.has(key) || seen.has(title)) continue;
    seen.add(key);
    seen.add(title);
    out.push({
      title: cardTitle(c),
      theme_label: c.theme_label || null,
      path: c.path,
      drive_url: c.drive_url || null,
      href: c.href || null,
      type: c.type || null,
    });
    if (out.length >= max) break;
  }
  // Keep up to 2 BCS2050 Library documents visible when they were in context
  const libOut = out.filter((x) => x.type === 'library').length;
  if (libOut < 2) {
    const seenLib = new Set(out.filter((x) => x.type === 'library').map((x) => x.title));
    // (titles above are card titles; compare with cardTitle below)
    const seenDoc = new Set();
    const extra = [];
    for (const c of chunks) {
      if (c.type !== 'library' || extra.length + libOut >= 2) continue;
      const dk = c.lib_id || c.id;
      if (seenDoc.has(dk) || seenLib.has(cardTitle(c))) continue;
      if (out.some((x) => x.type === 'library' && x.path && c.path && x.path.split('#')[0] === c.path.split('#')[0])) continue;
      seenDoc.add(dk);
      extra.push({ title: cardTitle(c), theme_label: c.theme_label || null, path: c.path, drive_url: null, href: c.href || null, type: 'library' });
    }
    for (const e of extra) {
      const idx = out.map((x) => x.type).lastIndexOf('ontology');
      if (out.length >= max && idx >= 0) out.splice(idx, 1);
      else if (out.length >= max) out.pop();
      out.push(e);
    }
  }
  return out;
}

function listDemoFilesInCorpus(limit = 6) {
  const corpus = loadCorpus();
  const out = [];
  const seen = new Set();
  for (const c of corpus) {
    const p = c.path || '';
    if (!/05_demographics|censo|inegi.*poblacion|panorama_sociodemografico/i.test(p + c.title)) {
      continue;
    }
    const base = p.split('/').pop();
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(c.title || base);
    if (out.length >= limit) break;
  }
  return out;
}

function providerConfig() {
  const key = process.env.BCS_CHAT_API_KEY || '';
  let provider = (process.env.BCS_CHAT_PROVIDER || '').toLowerCase();
  if (!provider) {
    if (key.startsWith('sk-')) provider = 'openai';
    else if (key.startsWith('xai-')) provider = 'xai';
  }
  if (provider === 'openai') {
    return {
      provider,
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      key,
    };
  }
  if (provider === 'xai') {
    return {
      provider,
      url: 'https://api.x.ai/v1/chat/completions',
      model: process.env.BCS_CHAT_MODEL || 'grok-4-1-fast-non-reasoning',
      key,
    };
  }
  return { provider: 'unknown', url: null, model: null, key };
}

function systemPrompt(lang, contextBlock, opts = {}) {
  const { demoHint = '', isDemoIntent = false, placeId = null, placeLabel = null } = opts;
  const placeNoteEn = placeLabel
    ? `\nPLACE FOCUS: Active place vocation "${placeLabel}" (${placeId}). Prefer evidence for that place. Keep the answer short. The UI shows the evidence chain (file · ontology · stakeholder · place · foresight signal) — do not invent missing chain links; omit what is absent. Cite foresight signal IDs from CONTEXT when relevant and point to /foresights and /crecimiento.\n`
    : `\nWhen a place vocation is clear from the question, name it. Prefer short synthesis. UI shows evidence chain chips — do not invent missing links.\n`;
  const placeNoteEs = placeLabel
    ? `\nENFOQUE DE LUGAR: Vocación activa "${placeLabel}" (${placeId}). Prioriza evidencia de ese lugar. Respuesta breve. La UI muestra la cadena (archivo · ontología · actor · lugar · señal de prospectiva) — no inventes eslabones faltantes; omite lo ausente. Cita IDs de señales del CONTEXTO y apunta a /foresights y /crecimiento.\n`
    : `\nSi la pregunta implica una vocación de lugar, nómbrala. Síntesis breve. La UI muestra chips de cadena — no inventes eslabones faltantes.\n`;
  if (lang === 'en') {
    return `You are the BCS Portal assistant for the regional strategy acervo (Baja California Sur territorial intelligence — BCSFP).
${placeNoteEn}
CONVERSATION STYLE (mandatory):
- Answer immediately. Do NOT restate or paraphrase the user's question.
- Do NOT announce process ("I'll look that up", "let me search the documents", "based on your question…"). CONTEXT is already retrieved — just answer.
- Continue the conversation naturally; avoid preamble labels like "Answer:" at the start.
- Skip filler openers. Lead with the substance (the number, conclusion, or estimate).

ALWAYS:
1) Use the retrieved CONTEXT below (guides, Drive docs, ontology nodes, stills summaries, place/foresight/growth/strategic-question spine).
2) Use ontology relations when present (capacity, constraints, actors, instruments, demand drivers) to connect facts.
3) For substantive answers, cover claims, sources, uncertainty, and spatial scope when useful — but do NOT open by repeating the question or using a rigid "Answer →" label. Keep it short.
4) Cite sources by readable title / path. Sources tagged [biblioteca] come from the BCS2050 Library (international and Mexican reference documents): cite title, organisation, year and page (p. N) when given, and say they are reference/method material, not BCS data unless the text says so. Summarise only what the [biblioteca] extract actually says; if the extract does not cover the question, say so and point to the document link instead of filling gaps. Do NOT dump raw ontology node ids. Do NOT invent sources or statistics. If evidence is insufficient, say so clearly.
5) Prefer linking to /studio, /crecimiento, /foresights, /preguntas when relevant. The UI shows evidence-chain chips — omit missing links rather than inventing them.

REASONING:
- If no single sentence has the full answer, reason across multiple chunks (guides + ontology + DMA/energy/stills summaries). Prefer synthesis over "not in documents" or dumping unrelated file lists.
- Do NOT answer with a bare list of unrelated files.

QUANTITATIVE:
- Exact figures when present in context.
- Otherwise estimate ONLY from numbers that appear in context; state the formula/assumptions; label clearly as an estimate; cite sources.
- Never invent numbers absent from context.
- Water yearly use: if no single statewide consumption line, transparent estimate from DMA deficits / demand / extraction (e.g. sum key aquifers 0313/0317/0319/0324). DMA deficit is availability pressure, not an official "state consumption" total — say so. Prefer agua guide / CONAGUA / ontology ResourceCapacity over demographics.

SCENARIO / PROJECTION (population × water, "if population triples", "in 30 years"):
- When CONTEXT has BOTH a population baseline (e.g. POBTOT 798,447) AND water figures (DMA / demand / extraction / desal capacity), you MUST give a reasoned estimate — do NOT hedge that you "lack consumption and projections".
- Method: state baseline population + baseline water metric from CONTEXT; apply the user factor (e.g. ×3) with an explicit assumption (default: demand scales linearly with population if no elasticity is in CONTEXT); show arithmetic; cite sources; note uncertainty (tourism, desal, efficiency, CONAGUA legal DMA ≠ municipal billed use).
- If a needed baseline is truly missing from CONTEXT, name exactly which metric is missing (e.g. "no statewide municipal consumption hm³/year in portal") and still scale any water metric that IS present.
- Never invent numbers not in CONTEXT — but always use numbers that ARE in CONTEXT.

ESTIMATE + DATA-GAP (mandatory product rule):
- If the exact figure the user wants is missing but RELATED baselines exist in CONTEXT → compute a transparent ESTIMATE. Label it clearly as "Estimate based on portal data" and list which inputs you used.
- Do NOT stop because per-capita consumption is missing. If CONTEXT has DMA deficit / demand / extraction / desal capacity AND a population factor (e.g. ×3), scale that water metric by the factor and present the result as the estimate (state assumption: linear with population). Example: deficit 63.88 hm³/yr × 3 ≈ 192 hm³/yr pressure under linear growth.
- ALWAYS add a short final section "Data-gap:" naming the exact metric / year / source that would make the answer precise — even when you already gave an estimate.
- NEVER refuse with only "I need updated data" / "necesito datos actualizados" when CONTEXT has usable proxies (DMA, POBTOT, demand, extraction, desal capacity, etc.).

POPULATION (ONLY if the question is about population/people/habitantes):
- If a figure is in context, state it with source (e.g. INEGI Census 2020).
- "Population of <municipality>" = the MUNICIPAL total (whole municipality). A cabecera/seat figure is one locality, never the municipal total: if you give it, name it separately ("its seat, the city of X: N"). When municipality and seat share a name (La Paz, Loreto) and the user does not say "city"/"locality", give the municipal figure first and the city figure second. Never cite file names.
- If not, say so briefly and list demographic files${isDemoIntent && demoHint ? `: ${demoHint}` : ''}. Never use water/airport files as population sources.

SPATIAL / MAPS / STILLS:
- When CONTEXT includes stills or map/GIS guides, describe what those sources show (place, municipality, coast/ANP/settlement/cover if stated) and link to /mapas, /stills, /earth-studio, or /studio.
- Never invent coordinates, distances, or layer contents not present in CONTEXT. If a still lists approx. lat/lon, you may quote those; otherwise speak qualitatively.
- Prefer citing 1–2 still/map sources when the question is spatial.

Be concise. Reply in English.

CONTEXT:
${contextBlock}`;
  }
  return `Eres el asistente del Portal BCS para el acervo de la estrategia regional (inteligencia territorial de Baja California Sur — BCSFP).
${placeNoteEs}
ESTILO CONVERSACIONAL (obligatorio):
- Responde de inmediato. NO repitas ni parafrasees la pregunta del usuario.
- NO anuncies el proceso ("voy a buscar", "déjame consultar", "según tu pregunta…"). El CONTEXTO ya está recuperado — contesta.
- Continúa la conversación con naturalidad; evita abrir con "Respuesta →" o etiquetas vacías.
- Sin relleno. Empieza por el dato, la conclusión o la estimación.

SIEMPRE:
1) Usa el CONTEXTO recuperado (guías, docs Drive, ontología, stills, spine lugar/prospectiva/crecimiento/pregunta estratégica).
2) Usa relaciones de ontología cuando existan (capacidad, restricciones, actores, instrumentos, motores de demanda) para conectar hechos.
3) En respuestas sustantivas incluye afirmaciones, fuentes, incertidumbre y alcance espacial cuando aporte — pero NO abras repitiendo la pregunta ni con la etiqueta "Respuesta →". Sé breve.
4) Cita fuentes por título / ruta. Las fuentes marcadas [biblioteca] vienen de la Biblioteca BCS2050 (documentos de referencia internacionales y mexicanos): cita título, organización, año y página (p. N) si aparece, y aclara que son referencias o métodos, no datos de BCS salvo que el texto lo diga. Resume solo lo que dice el extracto [biblioteca]; si el extracto no cubre la pregunta, dilo y remite al enlace del documento en vez de rellenar. NO inventes fuentes ni estadísticas. Si la evidencia no alcanza, dilo claro.
5) Prefiere enlazar /studio, /crecimiento, /foresights, /preguntas. La UI muestra chips de cadena — omite eslabones faltantes; no los inventes.

RAZONAMIENTO:
- Si ninguna frase sola tiene la respuesta completa, razona cruzando varios fragmentos (guías + ontología + resúmenes DMA/energía/stills). Prefiere síntesis a "no está en los documentos" o listar archivos no relacionados.
- NO respondas con una mera lista de archivos irrelevantes.

CUANTITATIVO:
- Cifras exactas cuando estén en el contexto.
- Si no, estima SOLO con números presentes en el contexto; indica fórmula/supuestos; etiquétalo como estimación; cita fuentes.
- Nunca inventes cifras ausentes del contexto.
- Uso anual de agua: si no hay consumo estatal único, estimación transparente desde déficits DMA / demanda / extracción (p. ej. suma acuíferos 0313/0317/0319/0324). El déficit DMA es presión de disponibilidad, no un total oficial de "consumo estatal" — dilo. Prefiere guía agua / CONAGUA / ResourceCapacity sobre demografía.

ESCENARIO / PROYECCIÓN (población × agua, "si se triplica", "en 30 años"):
- Si el CONTEXTO trae baseline de población (p. ej. POBTOT 798,447) Y cifras de agua (DMA / demanda / extracción / desalación), DEBES dar una estimación razonada — NO digas que "faltan consumo y proyecciones" como respuesta vacía.
- Método: cita población base + métrica hídrica base del CONTEXTO; aplica el factor del usuario (p. ej. ×3) con supuesto explícito (por defecto: demanda lineal con población si no hay elasticidad en CONTEXTO); muestra la aritmética; cita fuentes; señala incertidumbre (turismo, desalación, eficiencia, DMA legal ≠ consumo facturado).
- Si falta un baseline en CONTEXTO, nombra exactamente qué métrica falta (p. ej. "no hay consumo municipal estatal hm³/año en el portal") y aun así escala cualquier métrica hídrica que SÍ esté.
- Nunca inventes cifras ausentes — pero SÍ usa las que estén en el CONTEXTO.

ESTIMACIÓN + DATO QUE FALTA (regla de producto obligatoria):
- Si falta la cifra exacta que pide el usuario pero hay baselines relacionados en el CONTEXTO → calcula una ESTIMACIÓN transparente. Etiquétala claramente como "Estimación basada en datos del portal" y lista qué insumos usaste.
- NO te detengas porque falte el consumo per cápita. Si el CONTEXTO tiene déficit DMA / demanda / extracción / desalación Y un factor poblacional (p. ej. ×3), escala esa métrica hídrica por el factor y presenta el resultado como estimación (supuesto: lineal con población). Ejemplo: déficit 63.88 hm³/año × 3 ≈ 192 hm³/año de presión bajo crecimiento lineal.
- SIEMPRE añade una sección corta final "Dato que falta:" con la métrica / año / fuente exacta que haría la respuesta precisa — aunque ya hayas dado una estimación.
- NUNCA te niegues solo con "necesito datos actualizados" cuando el CONTEXTO tenga proxies usables (DMA, POBTOT, demanda, extracción, desalación, etc.).

POBLACIÓN (SOLO si la pregunta es sobre población/gente/habitantes):
- Si la cifra está en el contexto, respóndela con fuente (p. ej. INEGI Censo 2020).
- «Población / habitantes de <municipio>» = total MUNICIPAL (municipio completo). La cifra de la cabecera es de una sola localidad y nunca es el total municipal: si la das, nómbrala aparte («su cabecera, la ciudad de X: N»). Si municipio y cabecera comparten nombre (La Paz, Loreto) y no se pide «ciudad» o «localidad», da primero la cifra municipal y después la de la ciudad. Si piden la ciudad/localidad, da esa cifra y aclara el total municipal. No cites nombres de archivo.
- Si no, dilo en breve y menciona archivos demográficos${isDemoIntent && demoHint ? `: ${demoHint}` : ''}. No uses fichas de agua/aeropuerto como fuentes de población.

ESPACIAL / MAPAS / STILLS:
- Si el CONTEXTO incluye stills o guías de mapas/GIS, describe lo que esas fuentes muestran (lugar, municipio, costa/ANP/asentamiento/cobertura si aparece) y enlaza /mapas, /stills, /earth-studio o /studio.
- Nunca inventes coordenadas, distancias ni contenidos de capas que no estén en el CONTEXTO. Si un still trae lat/lon aprox., puedes citarlas; si no, habla en cualitativo.
- Prefiere citar 1–2 fuentes still/mapa cuando la pregunta sea espacial.

Sé conciso. Responde en español.

CONTEXTO:
${contextBlock}`;
}

function formatContext(chunks, lang) {
  return chunks
    .map((c, i) => {
      const sum = lang === 'en' ? c.sum_en || c.sum_es : c.sum_es || c.sum_en;
      const link = c.drive_url ? ` | Drive: ${c.drive_url}` : '';
      const kind = c.type === 'ontology' ? ' [ontology]' : c.type === 'still' ? ' [still]' : c.type === 'library' ? ' [biblioteca]' : '';
      const libUrl = c.type === 'library' && c.href && /^https?:/.test(c.href) ? ` | URL: ${c.href}` : '';
      return `[${i + 1}] ${c.title} (${c.path})${kind}${link}${libUrl}\n${sum}`;
    })
    .join('\n\n');
}


/* ---------------- Grounded RAG helpers (2026-10-05) ---------------- */
let RAG_INDEX = null;
let RAG_INDEX_SIZE = 0;
function ragIndex() {
  if (!RAG_INDEX || RAG_INDEX_SIZE !== CORPUS.length) {
    RAG_INDEX = buildRagIndex(CORPUS);
    RAG_INDEX_SIZE = CORPUS.length;
  }
  return RAG_INDEX;
}

function isFollowUpMessage(message) {
  const m = String(message || '').trim();
  const n = m.split(/\s+/).length;
  if (n > 7) return false;
  return /^[¿¡\s]*(y|e|o|and|what about|tambi[eé]n|ahora|entonces|y\s+en|y\s+para|y\s+el|y\s+la)\b/i.test(m) ||
    /\b(eso|ese|esa|esos|esas|ello|lo mismo|same|that|those)\b/i.test(m);
}

function cleanTitle(t) {
  return String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
}

// Source-card titles (2026-10-08): human document titles only — never a raw file name.
// The corpus carries `display_title` (catalog metadata / document heading / institution + year) and
// `theme_label`; anything still filename-like falls back to the generic archive label.
export const CARD_FILENAME_RE = /\.(pdf|md|csv|tsv|xlsx?|json|geojson|zip|kml|kmz|docx?|pptx?|txt|py|mjs|ya?ml|shp|dbf|prj|esp|html?|jpe?g|png|webp)\b|_|^\d{4}(-\d{2}){0,2}[ _-]?_/i;
export const CARD_FALLBACK = 'Documento del acervo BCS 2050';
export function cardTitle(c) {
  if (!c) return CARD_FALLBACK;
  const t = cleanTitle(c.display_title || c.title || '');
  if (c.type === 'news') return t.replace(/_/g, ' ');
  if (!t || CARD_FILENAME_RE.test(t)) return `${CARD_FALLBACK} — ${c.theme_label || 'acervo de datos'}`;
  return t;
}
function sanitizeCards(body) {
  // Last line of defence on every response: no filename-like title leaves the server.
  const fix = (x) => {
    if (!x || typeof x !== 'object') return x;
    if (typeof x.title === 'string' && x.type !== 'news' && (CARD_FILENAME_RE.test(x.title) || !x.title.trim())) {
      x.title = `${CARD_FALLBACK} — ${x.theme_label || 'acervo de datos'}`;
    }
    return x;
  };
  if (Array.isArray(body.sources)) body.sources = body.sources.map(fix);
  if (body.primary_file) body.primary_file = fix(body.primary_file);
  return body;
}

function formatEvidence(chunks, lang) {
  const newsDates = chunks.filter((c) => c.type === 'news' && c.date).map((c) => c.date).sort();
  const newestNews = newsDates.length >= 2 && newsDates[0] !== newsDates[newsDates.length - 1] ? newsDates[newsDates.length - 1] : null;
  const KIND = { ontology: 'ontología', library: 'biblioteca', still: 'still', fact: 'hecho', guide: 'guía', municipio: 'municipio', file: 'documento', actor: 'actor', aquifer: 'acuífero', news: 'noticia' };
  return chunks
    .map((c, i) => {
      let body = ragCleanSummary(lang === 'en' ? c.sum_en || c.sum_es : c.sum_es || c.sum_en);
      if (c.type === 'fact' && c.metric && !body.includes(String(c.value || ''))) body = `${c.metric} = ${c.value}. ${body}`;
      body = body.slice(0, c.type === 'library' ? 1100 : 900);
      const link = c.drive_url ? ` | Drive: ${c.drive_url}` : c.href && /^https?:/.test(c.href) ? ` | URL: ${c.href}` : '';
      if (c.type === 'news') {
        // Press report: label clearly, never presented as official data
        const en = lang === 'en';
        const when = (en ? c.date_label_en : c.date_label_es) || c.date || '';
        const latest = newestNews && c.date === newestNews ? (en ? '; MOST RECENT' : '; MÁS RECIENTE') : '';
        const head = en
          ? `(${c.no_summary ? 'news item without summary, headline only' : 'news report'} — press, NOT official; ${c.outlet || 'outlet n/a'}, ${c.date_kind === 'found' ? 'found ' : ''}${when}${latest})`
          : `(${c.no_summary ? 'noticia sin resumen, solo titular' : 'noticia'} — prensa, NO oficial; ${c.outlet || 'medio s/d'}, ${c.date_kind === 'found' ? 'detectada el ' : ''}${when}${latest})`;
        const meta = en
          ? ` | Municipality: ${c.municipios || 'n/a'} | Topics: ${c.topics_en || 'n/a'}${c.archived ? ' | news archive' : ''}`
          : ` | Municipio: ${c.municipios || 's/d'} | Temas: ${c.topics_es || 's/d'}${c.archived ? ' | archivo de noticias' : ''}`;
        return `[${i + 1}] ${head} ${cardTitle(c)}${meta}${link}\n${body}`;
      }
      return `[${i + 1}] (${KIND[c.type] || c.type}) ${cardTitle(c)}${link}\n${body}`;
    })
    .join('\n\n');
}

function factorCardLabel(c) {
  const title = String(c.title || '');
  const mark = title.indexOf(': ');
  return (mark >= 0 ? title.slice(mark + 2) : title).trim() || c.onto_id || 'factor';
}

function factorCardBody(c, lang) {
  const label = factorCardLabel(c);
  let text = String(lang === 'en' ? (c.sum_en || c.sum_es || '') : (c.sum_es || c.sum_en || ''))
    .replace(/^Ontolog[ií]a\s+\S+\s+\[[^\]]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (label && text.startsWith(label)) text = text.slice(label.length).replace(/^[.\s]+/, '');
  text = text.split(/\s+Relaciones:/)[0].split(/\s+Relations:/)[0].trim();
  return text.slice(0, 240);
}

function isFactorGapCard(c) {
  const id = String(c.onto_id || '');
  if (id.startsWith('gap_') || id === 'ev_sig_mulege_oasis') return true;
  return false;
}

/** Labeled brief of ontology cards already retrieved. No new figures. */
function composeFactorBrief(evidence, lang = 'es') {
  const cards = (evidence || []).filter((c) => c && (c.type === 'ontology' || c.onto_id));
  if (!cards.length) return '';
  const en = lang === 'en';
  const buckets = [
    ['huecos', en ? 'GAPS — sin dato (do not fill)' : 'HUECOS — sin dato (no rellenar)', isFactorGapCard],
    ['viabilidad', en ? 'Viability' : 'Viabilidad', (c) => /viabilidad/.test(c.onto_id || '')],
    ['riesgos', en ? 'Risks and constraints' : 'Riesgos y restricciones', (c) => c.onto_type === 'Constraint' || /riesgo/.test(c.onto_id || '')],
    ['oportunidades', en ? 'Opportunities' : 'Oportunidades', (c) => /oportunidad/.test(c.onto_id || '') || c.onto_type === 'DemandDriver'],
    ['quien', en ? 'Who decides' : 'Quién decide', (c) => c.onto_type === 'Actor'],
    ['capacidades', en ? 'Capacities' : 'Capacidades', (c) => c.onto_type === 'ResourceCapacity'],
    ['instrumentos', en ? 'Instruments' : 'Instrumentos', (c) => c.onto_type === 'Instrument'],
    ['proyectos', en ? 'Projects' : 'Proyectos', (c) => c.onto_type === 'Project'],
    ['lugares', en ? 'Places' : 'Lugares', (c) => c.onto_type === 'Territory'],
    ['evidencia', en ? 'Evidence' : 'Evidencia', (c) => c.onto_type === 'Evidence'],
  ];
  const used = new Set();
  const lines = [en ? 'FACTOR BRIEF (retrieved cards only; do not add figures):' : 'RESUMEN DE FACTORES (solo fichas recuperadas; no añadas cifras):'];
  for (const [, heading, match] of buckets) {
    const rows = [];
    for (const c of cards) {
      const id = c.onto_id || c.id;
      if (used.has(id) || !match(c)) continue;
      used.add(id);
      rows.push(c);
      if (heading.indexOf('sin dato') < 0 && rows.length >= 4) break;
    }
    if (!rows.length) continue;
    lines.push('');
    lines.push(heading);
    for (const c of rows) {
      const body = factorCardBody(c, lang);
      if (heading.indexOf('sin dato') >= 0) {
        lines.push(`- HUECO — sin dato: ${factorCardLabel(c)}. ${body}`);
      } else {
        lines.push(`- ${factorCardLabel(c)}. ${body}`);
      }
    }
  }
  return lines.join('\n');
}

function factorPromptNote(lang, kinds) {
  if (!kinds || !kinds.length) return '';
  if (lang === 'en') {
    return `
MULTI-FACTOR REASONING (this question is about project viability, land-use change, principal risks, or opportunities):
- CONTEXT opens with a labeled FACTOR BRIEF. Follow that order. Use only those cards and the fragments under them.
- If two or more sections are present (viability, risks, opportunities, who decides, capacities, instruments), the answer must name at least two of them.
- Every line that says "HUECO — sin dato" must be repeated as its own "Data gap:" line. Do not fill it with a number, a rent, a megawatt, a parcel, or a passenger total.
- Name trade-offs that the cards already state. Do not recommend a zoning code that is not written in CONTEXT.
- Cite each factor with the fragment title. Library page extracts are reference, not BCS statistics. News is press (outlet and date). Scenarios and foresight signals are readings, not new capacity.
- Close with ONE follow-up on its own last line, starting with "👉 ", about a factor or gap already named in the brief. Do not ask for a series the brief marks as sin dato. For this class you may use up to about 220 words.
`;
  }
  return `
RAZONAMIENTO MULTIFACTOR (esta pregunta es de viabilidad de proyecto, cambio de uso de suelo, riesgos principales u oportunidades):
- El CONTEXTO abre con un RESUMEN DE FACTORES etiquetado. Sigue ese orden. Usa solo esas fichas y los fragmentos que van debajo.
- Si hay dos o más secciones (viabilidad, riesgos, oportunidades, quién decide, capacidades, instrumentos), la respuesta debe nombrar al menos dos.
- Cada línea que dice "HUECO — sin dato" se repite como su propia línea "Dato faltante:". No la completes con una cifra, una renta, un megawatt, un predio ni un total de pasajeros.
- Nombra los trade-offs que las fichas ya dicen. No recomiendes un código de zonificación que no esté escrito en el CONTEXTO.
- Cita cada factor con el título del fragmento. Las páginas de biblioteca son referencia, no estadística de BCS. Las noticias son prensa (medio y fecha). Escenarios y señales son lecturas, no capacidad nueva.
- Cierra con UNA pregunta 👉 en su propia última línea, sobre un factor o hueco ya nombrado en el resumen. No pidas una serie que el resumen marca como sin dato. En esta clase puedes usar hasta unas 220 palabras.
`;
}

function groundedPrompt(lang, contextBlock, { placeLabel = null, noEvidence = false, factorKinds = null } = {}) {
  const factorNote = factorPromptNote(lang, factorKinds);
  if (lang === 'en') {
    return `You are the assistant of the BCS 2050 portal (territorial intelligence for Baja California Sur).

EVIDENCE RULES (mandatory):
1. Answer ONLY with information in CONTEXT. Every figure, date, person, position, company and institution you mention must appear in CONTEXT. Do not use your own knowledge for people, current office-holders or figures.
2. If CONTEXT does not answer the question, say so in one sentence ("The portal does not have that figure/data") and, if CONTEXT has something related, mention it briefly. You may suggest which official source would publish it, without giving any figure.
3. Do not create projections or new estimates. You may repeat estimates already in CONTEXT, labelled as such. Simple arithmetic (sum, unit conversion) only if asked, showing the operation with CONTEXT numbers.
4. Cite the source of each figure in parentheses (title of the fragment/document, year, page if given). [biblioteca] items are reference documents: say so; summarise only what the extract says.
5. If CONTEXT has two different figures for the same thing, give both with their sources.
6. Never mention internal tools, vendors, offices or platform names.
7. Items marked "news report — press, NOT official" come from the daily BCS news feed. Cite them as "News: <outlet>, <date>" and say they are press reports. For current events, lead with the most recent news item (marked MOST RECENT) as the current report and give its date; if older news items say something different, mention them afterwards as earlier reports with their dates — do not blend figures from different dates. Format: "According to the most recent report (<outlet>, <date>), …; earlier (<date>) … had been reported". News never replaces official data: if a news item conflicts with an official source (fact, aquifer, municipality, guide, official document), give both and say explicitly which one is official.
STYLE: direct, short (≤150 words unless detail is requested), do not repeat the question, no process narration. Reply in English. Use simple markdown: **bold** for key ideas, short bullet lists, and a compact pipe table (| a | b |) when comparing municipalities or metrics — only with figures from CONTEXT. The interface will show related maps, photos and documents next to your answer: if the question is about a place, the coast, risks or a map you may say "see the map below", but never write URLs or image links yourself. When the answer is incomplete, add a short line "Data gap: …" naming the missing metric/source. ALWAYS close with ONE short follow-up question on its own last line, starting with "👉 ", inviting the user to keep exploring a related topic or place the portal covers (e.g. water, protected areas, risks, urban plans, population, energy, another municipality). Never end with a bare fact.${placeLabel ? `\nActive place in the UI: ${placeLabel} (use only if the question is ambiguous).` : ''}${noEvidence ? '\nCONTEXT IS EMPTY: say the portal has no evidence on this, then still close with the 👉 follow-up question suggesting a topic the portal does cover (you may suggest the official source to consult, without figures). For greetings or questions about what the portal does, answer briefly.' : ''}

CONTEXT:
${contextBlock}${factorNote}`;
  }
  return `Eres el asistente del portal BCS 2050 (inteligencia territorial de Baja California Sur).

REGLAS DE EVIDENCIA (obligatorias):
1. Responde SOLO con información del CONTEXTO. Toda cifra, fecha, persona, cargo, empresa o institución que menciones debe aparecer en el CONTEXTO. No uses conocimiento propio sobre personas, cargos actuales ni cifras.
2. Si el CONTEXTO no responde la pregunta, dilo en una frase ("El portal no tiene ese dato") y, si hay algo relacionado en el CONTEXTO, menciónalo brevemente. Puedes sugerir qué fuente oficial lo publicaría, sin dar cifras.
3. No hagas proyecciones ni estimaciones nuevas. Solo puedes repetir estimaciones que ya estén en el CONTEXTO, etiquetadas como tales. Aritmética simple (suma, conversión de unidades) solo si te la piden, mostrando la operación con números del CONTEXTO.
4. Cita la fuente de cada cifra entre paréntesis (título del fragmento o documento, año, página si la hay). Los elementos [biblioteca] son documentos de referencia: acláralo y resume solo lo que dice el extracto.
5. Si el CONTEXTO trae dos cifras distintas para lo mismo, da ambas con su fuente.
6. Nunca menciones nombres de herramientas internas, proveedores, oficinas ni plataformas.
7. Los elementos marcados "noticia — prensa, NO oficial" vienen del monitoreo diario de noticias de BCS. Cítalos como "Noticia: <medio>, <fecha>" y aclara que son notas de prensa. Para hechos de actualidad, empieza por la noticia más reciente (marcada MÁS RECIENTE) como la versión actual e indica su fecha; si noticias anteriores dicen otra cosa, menciónalas después como reportes previos con su fecha — no mezcles cifras de fechas distintas. Formato: "Según la noticia más reciente (<medio>, <fecha>), …; antes (<fecha>) se había reportado …". Una noticia nunca sustituye un dato oficial: si contradice una fuente oficial (hecho, acuífero, municipio, guía, documento oficial), muestra ambas y di explícitamente cuál es la oficial.
ESTILO: directo, breve (≤150 palabras salvo que pidan detalle), sin repetir la pregunta ni narrar el proceso. Responde en español. Usa markdown sencillo: **negritas** para ideas clave, listas cortas y una tabla compacta con barras (| a | b |) cuando compares municipios o indicadores — solo con cifras del CONTEXTO. La interfaz mostrará junto a tu respuesta mapas, fotos y documentos relacionados: si la pregunta trata de un lugar, la costa, riesgos o un mapa puedes decir "mira el mapa abajo", pero nunca escribas URLs ni enlaces de imagen. Si la respuesta queda incompleta, agrega una línea breve "Dato faltante: …" que nombre el indicador o la fuente que falta. SIEMPRE cierra con UNA pregunta breve de seguimiento en su propia última línea, que empiece con "👉 ", invitando a seguir explorando un tema o lugar relacionado que cubre el portal (agua, áreas naturales protegidas, riesgos, planes urbanos, población, energía, otro municipio). Nunca termines con un dato suelto.${placeLabel ? `\nLugar activo en la interfaz: ${placeLabel} (úsalo solo si la pregunta es ambigua).` : ''}${noEvidence ? '\nEL CONTEXTO ESTÁ VACÍO: di que el portal no tiene evidencia sobre esto y aun así cierra con la pregunta 👉 sugiriendo un tema que el portal sí cubre (puedes sugerir la fuente oficial a consultar, sin cifras). Si es un saludo o una pregunta sobre qué hace el portal, responde brevemente.' : ''}

CONTEXTO:
${contextBlock}${factorNote}`;
}


// ---- Rich answer blocks (2026-10-26): tables / images / maps / links built ONLY from retrieved evidence + real portal assets ----
const MAP_TOPICS = [
  [/\b(anp|area(s)? natural(es)? protegida|reserva|ambiental|ecologic|poer|uga|costa|litoral)/, ['poer-ugas-56.jpg', 'poer-politica-ambiental-ugas.jpg']],
  [/\b(riesgo|ciclon|huracan|inundaci|tsunami|sism|falla)/, ['atlas-riesgo-puntos-criticos.jpg', 'atlas-ciclones.jpg', 'atlas-inundaciones.jpg']],
  [/\b(electric|energ|luz|cenace|transmisi|demanda electrica|sibcs|prodesen)/, ['cenace-red-troncal-transmision.jpg', 'prodesen-sibcs-demanda-maxima.jpg']],
  [/\b(acuifero|dma|disponibilidad media)/, ['dma-la-paz-localizacion.jpg', 'dma-sjc-localizacion.jpg']],
  [/\b(pdu|psdu|plan(es)? (urbano|de desarrollo urbano)|zonificaci|uso de suelo)/, ['pdu2040-carta-sintesis.jpg', 'pdu2040-et-401-zonificacion-primaria.jpg', 'psdu-todos-santos-zonificacion.jpg', 'psdu-barriles-uso-suelo.jpg']],
  [/\bbarriles\b/, ['psdu-barriles-mapa-regional.jpg', 'psdu-barriles-uso-suelo.jpg']],
  [/\btodos santos\b/, ['psdu-todos-santos-zonificacion.jpg']],
];
function normQ(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function mapCaption(file, lang) {
  const c = (CORPUS || []).find((x) => String(x.path || '').endsWith('/maps/' + file));
  const txt = c ? String((lang === 'en' ? c.sum_en : c.sum_es) || c.sum_es || '') : '';
  const m = txt.match(/«([^»]{3,90})»/);
  const src = txt.match(/fuente:\s*([^.;\]]{3,90})/i);
  return { title: m ? m[1] : file.replace(/\.jpg$/, '').replace(/-/g, ' '), source: src ? src[1].trim() : null };
}

// Municipality matching for media (2026-10-26 fix: never show another municipio's maps/photos)
const MUNI_RES = [
  ['Los Cabos', /\b(los cabos|cabo san lucas|san jose del cabo|cabo pulmo|la ribera|miraflores|santiago)\b/],
  ['La Paz', /\b(la paz|todos santos|el pescadero|pescadero|los barriles|barriles|el sargento|la ventana|el carrizal)\b/],
  ['Loreto', /\b(loreto|nopolo|san javier)\b/],
  ['Comondú', /\b(comondu|ciudad constitucion|puerto (de )?san carlos|puerto adolfo lopez mateos|ciudad insurgentes)\b/],
  ['Mulegé', /\b(mulege|santa rosalia|guerrero negro|vizcaino|san ignacio|bahia tortugas)\b/],
];
const PLACE_TO_MUNI = { los_cabos: ['Los Cabos'], todos_santos: ['La Paz'], la_paz: ['La Paz'], east_cape: ['La Paz', 'Los Cabos'], loreto: ['Loreto'], comondu: ['Comondú'], mulege_north: ['Mulegé'] };
function mapFileMuni(f) {
  if (/^(pdu2040-|dma-sjc)/.test(f)) return 'Los Cabos';
  if (/^(dma-la-paz|psdu-)/.test(f)) return 'La Paz';
  return null; // statewide (POER, atlas de riesgos, CENACE, PRODESEN)
}
function targetMunis(message, uiPlace) {
  const q = normQ(message);
  const hit = MUNI_RES.filter(([, re]) => re.test(q)).map(([m]) => m);
  if (hit.length) return hit;
  if (uiPlace && PLACE_TO_MUNI[uiPlace]) return PLACE_TO_MUNI[uiPlace];
  return null; // statewide question
}
const FU_TOPICS = [
  ['pop', /\b(poblaci|habitantes|gente|vive|viven|censo|personas)/, (p) => [`¿Cuánta gente vive en ${p}?`, `How many people live in ${p}?`]],
  ['water', /\b(agua|acuifero|dma|hidric|sequia)/, (p) => [`¿Cuánta agua hay disponible en ${p}?`, `How much water is available in ${p}?`]],
  ['anp', /\b(anp|protegid|reserva|ambiental|costa)/, (p) => [`¿Qué áreas naturales protegidas hay cerca de ${p}? Muéstrame el mapa`, `Which protected areas are near ${p}? Show me the map`]],
  ['risk', /\b(riesgo|huracan|ciclon|inundaci)/, (p) => [`¿Qué riesgos de huracán e inundación tiene ${p}?`, `What hurricane and flood risks does ${p} face?`]],
  ['plan', /\b(plan urbano|pdu|psdu|zonificaci|uso de suelo)/, (p) => [`¿Qué plan urbano aplica en ${p}? Muéstrame el mapa`, `Which urban plan applies in ${p}? Show me the map`]],
  ['energy', /\b(electric|energ|cenace)/, () => ['¿De dónde viene la electricidad del estado?', "Where does the state's electricity come from?"]],
  ['fed', /\b(proyecto|federal|inversion)/, (p) => [`¿Qué proyectos federales hay en ${p}?`, `Which federal projects are in ${p}?`]],
  ['photos', /\b(foto|aerea|vista)/, (p) => [`Muéstrame fotos aéreas de ${p}`, `Show me aerial photos of ${p}`]],
];
function buildFollowUps({ message, lang, placeId, munis }) {
  const en = lang === 'en';
  const q = normQ(message);
  const place = (munis && munis[0]) || (placeId && PLACE_SPINE?.[placeId] ? PLACE_SPINE[placeId][en ? 'en' : 'es'] : null);
  const p = place || (en ? 'my municipality' : 'mi municipio');
  const out = [];
  for (const [, re, f] of FU_TOPICS) if (!re.test(q)) out.push(f(p)[en ? 1 : 0]);
  // rotate deterministically by message so chips vary between turns
  const k = [...q].reduce((a, c) => a + c.charCodeAt(0), 0) % Math.max(1, out.length);
  const rot = out.slice(k).concat(out.slice(0, k)).slice(0, 2);
  const others = ['La Paz', 'Los Cabos', 'Loreto', 'Comondú', 'Mulegé'].filter((m) => !(munis || []).includes(m));
  if (place && others.length) rot.push(en ? `Compare ${place} with ${others[k % others.length]}` : `Compara ${place} con ${others[k % others.length]}`);
  else rot.push(en ? 'How many people live in each municipality?' : '¿Cuántas personas viven en cada municipio?');
  return rot;
}
function airAxisQuery(message) {
  return /pasajeros?\s+loreto|loreto.{0,30}pasajeros|compar(?:ar|o)\s+aeropuertos|compare airports|eje aereo|air axis/.test(normQ(message));
}

function evidenceDepthQuery(message) {
  const q = normQ(message);
  return /desalaci|desalinat|agua no contabilizada|non-revenue water|uncounted water|unbilled water|\bc40\b|urbanshift|urban shift/.test(q);
}

function cierreQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message)) return false;
  const q = normQ(message);
  return /que me llevo del foro|enlaces despues de la reunion|takeaway foro|what i take away|links after the meeting|forum takeaway/.test(q);
}

function rutaQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message)) return false;
  const q = normQ(message);
  return /ruta del foro|mapa del foro|como seguir el foro|forum route|forum map|how to follow the forum/.test(q);
}

function gemelo3dQuery(message) {
  if (sideQuery(message)) return false;
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message) || rutaQuery(message)) return false;
  const q = normQ(message);
  return /gemelo 3d|capas del gemelo|3d twin|twin layers|\bescenarios\b/.test(q);
}

function extrusionQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message) || rutaQuery(message) || gemelo3dQuery(message)) return false;
  const q = normQ(message);
  return /extrusion municipal|extrusion del municipio|palancas del escenario|scenario levers|municipal extrusion/.test(q);
}

function caminoQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message) || rutaQuery(message) || gemelo3dQuery(message) || extrusionQuery(message)) return false;
  const q = normQ(message);
  return /camino de decision|diagnostico gemelo|recomendacion gemelo|decision path|twin diagnosis|twin recommendation/.test(q);
}

function cruceQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message) || rutaQuery(message) || gemelo3dQuery(message) || extrusionQuery(message) || caminoQuery(message)) return false;
  const q = normQ(message);
  return /impacto entre temas|efectos cruzados|ontologia del escenario|cross-theme impact|cross effects|scenario ontology/.test(q);
}

function fichaQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message) || limitsQuery(message) || cierreQuery(message) || rutaQuery(message) || gemelo3dQuery(message) || extrusionQuery(message) || caminoQuery(message) || cruceQuery(message)) return false;
  const q = normQ(message);
  return /ficha municipal|demanda y oferta gemelo|municipal fiche|twin demand and supply/.test(q);
}

function sideQuery(message) {
  const q = normQ(message);
  return /comparar escenarios lado a lado|escenario a y b|compare scenarios side by side|scenario a and b/.test(q);
}

function presetQuery(message) {
  if (kitQuery(message) || sideQuery(message)) return false;
  const q = normQ(message);
  return /presets del gemelo|reunion gemelo|para la reunion|meeting presets|twin meeting|for the meeting/.test(q);
}

function stillFicheQuery(message) {
  if (kitQuery(message) || sideQuery(message) || presetQuery(message) || fichaQuery(message) || extrusionQuery(message) || namedViewsQuery(message)) return false;
  const q = normQ(message);
  return /fotos del municipio|still gemelo|leyenda extrusion|municipality photos|twin still|extrusion legend/.test(q);
}

function atlasQuery(message) {
  if (kitQuery(message) || sideQuery(message) || presetQuery(message) || stillFicheQuery(message) || fichaQuery(message) || extrusionQuery(message) || gemelo3dQuery(message) || namedViewsQuery(message)) return false;
  const q = normQ(message);
  return /abrir en el atlas|del gemelo al atlas|open in the atlas|from the twin to the atlas/.test(q);
}

function novedadesQuery(message) {
  if (kitQuery(message) || sideQuery(message) || presetQuery(message) || stillFicheQuery(message) || atlasQuery(message) || fichaQuery(message) || extrusionQuery(message) || gemelo3dQuery(message) || namedViewsQuery(message)) return false;
  const q = normQ(message);
  return /gemelo mas rapido|faster twin/.test(q);
}

function readinessQuery(message) {
  if (kitQuery(message) || sideQuery(message) || presetQuery(message) || stillFicheQuery(message) || atlasQuery(message) || novedadesQuery(message) || fichaQuery(message) || extrusionQuery(message) || gemelo3dQuery(message) || namedViewsQuery(message)) return false;
  const q = normQ(message);
  return /que falta en el gemelo|listo para fase 3|\bageb\b|data readiness|ready for phase 3|what the twin is missing|what is missing from the twin/.test(q);
}

function walkQuery(message) {
  if (namedViewsQuery(message) || consultaPathQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message)) return false;
  const q = normQ(message);
  return /recorrido del gemelo|demo gemelo|guion 10 minutos|twin walkthrough|twin demo|ten-minute twin/.test(q);
}

function shareQuery(message) {
  if (walkQuery(message) || namedViewsQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message)) return false;
  const q = normQ(message);
  return /compartir gemelo|copiar vista|share twin|copy view|share the twin/.test(q);
}

function consultaMesaQuery(message) {
  if (shareQuery(message) || walkQuery(message) || namedViewsQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message)) return false;
  const q = normQ(message);
  return /consulta ciudadana gemelo|preguntas para la mesa|citizen consultation twin|questions for the table|twin consultation/.test(q);
}

function recipeQuery(message) {
  if (consultaMesaQuery(message) || shareQuery(message) || walkQuery(message) || namedViewsQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message) || gemelo3dQuery(message)) return false;
  const q = normQ(message);
  return /recetas de escenario|generar escenario|scenario recipes|generate scenario|scenario recipe/.test(q);
}

function fuentesQuery(message) {
  if (recipeQuery(message) || consultaMesaQuery(message) || shareQuery(message) || walkQuery(message) || namedViewsQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message) || gemelo3dQuery(message)) return false;
  const q = normQ(message);
  return /fuentes del gemelo|de donde salen las capas|twin layer sources|where the layers come from|layer sources twin|sources for these layers/.test(q);
}

function checklistQuery(message) {
  if (fuentesQuery(message) || recipeQuery(message) || consultaMesaQuery(message) || shareQuery(message) || walkQuery(message) || namedViewsQuery(message) || kitQuery(message) || presetQuery(message) || readinessQuery(message) || novedadesQuery(message) || atlasQuery(message) || gemelo3dQuery(message)) return false;
  const q = normQ(message);
  return /novedades gemelo|checklist anfitrion|que hay de nuevo en el gemelo|host checklist|what's new on the twin|what's new in the twin|twin news/.test(q);
}

function limitsQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message) || kitQuery(message)) return false;
  const q = normQ(message);
  return /que no puede el gemelo|limites del gemelo|limites fase 1|what the twin cannot|twin limits|phase 1 limits/.test(q);
}

function kitQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message) || twinReadQuery(message)) return false;
  const q = normQ(message);
  return /kit reunion|imprimir foro|lista para la reunion/.test(q);
}

function twinReadQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message) || consultaPathQuery(message)) return false;
  const q = normQ(message);
  return /como usar el gemelo|como leer el tablero|how to use the twin|how to read the twin|how to read the board/.test(q);
}

function consultaPathQuery(message) {
  if (airAxisQuery(message) || evidenceDepthQuery(message) || namedViewsQuery(message)) return false;
  const q = normQ(message);
  return /\bevidencia\b|casos de otras ciudades|cases from other cities|recorrido foro|hoja invitados/.test(q);
}

function namedViewsQuery(message) {
  const q = normQ(message);
  return /agua primero|water first|cinco vistas|five named views|five saved views|contexto de vivienda|housing context|recorrido de 10|ten-minute walk|puertos y aeropuertos/.test(q)
    || (/east cape/.test(q) && /vista|view|capa|mapa|proteg/.test(q))
    || (/corredor/.test(q) && /cabos|vista|view|crecimiento/.test(q));
}

function portalSurfaceBlocks(message, lang) {
  const q = normQ(message);
  const en = lang === 'en';
  const surfaces = [
    { id: 'gemelo-air', re: /pasajeros?\s+loreto|loreto.{0,30}pasajeros|compar(?:ar|o)\s+aeropuertos|compare airports|eje aereo|air axis/, href: '/gemelo/?theme=movilidad&x=pob&y=aereo_2025', es: 'Eje aéreo 2025', en: '2025 air axis' }, // keep in sync with airAxisQuery
    { id: 'gemelo-listo', re: /que falta en el gemelo|listo para fase 3|\bageb\b|data readiness|ready for phase 3|what the twin is missing|what is missing from the twin/, href: '/gemelo/#listo', es: 'Qué falta', en: 'What is missing' },
    { id: 'gemelo-listo-metas', re: /que falta en el gemelo|listo para fase 3|\bageb\b|data readiness|ready for phase 3|what the twin is missing|what is missing from the twin/, href: '/metas/', es: 'Preguntas abiertas', en: 'Open questions' },
    { id: 'gemelo-listo-catastro', re: /que falta en el gemelo|listo para fase 3|catastro|cadastre|data readiness|ready for phase 3|what the twin is missing/, href: '/catastro/', es: 'Oficinas de catastro', en: 'Cadastre offices' },
    { id: 'gemelo-limites', re: /que no puede el gemelo|limites del gemelo|limites fase 1|what the twin cannot|twin limits|phase 1 limits/, href: '/gemelo/#limites', es: 'Qué puede y qué no puede', en: 'What it can and cannot do' },
    { id: 'gemelo-limites-metas', re: /que no puede el gemelo|limites del gemelo|limites fase 1|what the twin cannot|twin limits|phase 1 limits/, href: '/metas/', es: 'Preguntas abiertas', en: 'Open questions' },
    { id: 'gemelo-limites-ev', re: /que no puede el gemelo|limites del gemelo|limites fase 1|what the twin cannot|twin limits|phase 1 limits/, href: '/aprendizaje/#evidencia', es: 'Evidencia de otras ciudades', en: 'Evidence from other cities' },
    { id: 'gemelo-leer', re: /como usar el gemelo|como leer el tablero|how to use the twin|how to read the twin|how to read the board/, href: '/gemelo/', es: 'Cómo leer el tablero', en: 'How to read the board' },
    { id: 'gemelo-leer-vistas', re: /como usar el gemelo|como leer el tablero|how to use the twin|how to read the twin|how to read the board/, href: '/vistas/', es: 'Vistas guardadas', en: 'Saved views' },
    { id: 'ev-desal', re: /desalaci|desalinat|agua no contabilizada|non-revenue water|uncounted water|unbilled water|\bc40\b|urbanshift|urban shift/, href: '/aprendizaje/#evidencia', es: 'Evidencia: agua y costa', en: 'Evidence: water and coast' },
    { id: 'consulta-ev', re: /\bevidencia\b|casos de otras ciudades|cases from other cities/, href: '/aprendizaje/#evidencia', es: 'Evidencia de otras ciudades', en: 'Evidence from other cities' },
    { id: 'consulta-foro', re: /recorrido foro|hoja invitados/, href: '/foro/#recorrido', es: 'Recorrido del foro', en: 'Forum walk' },
    { id: 'foro-kit', re: /kit reunion|imprimir foro|lista para la reunion/, href: '/foro/#kit', es: 'Kit de la reunión', en: 'Meeting kit' },
    { id: 'foro-cierre', re: /que me llevo del foro|enlaces despues de la reunion|takeaway foro|what i take away|links after the meeting|forum takeaway/, href: '/foro/#cierre', es: 'Qué me llevo', en: 'What I take away' },
    { id: 'foro-ruta', re: /ruta del foro|mapa del foro|como seguir el foro|forum route|forum map|how to follow the forum/, href: '/rutas/#ruta-foro', es: 'Ruta del foro', en: 'Forum path' },
    { id: 'foro-ruta-cierre', re: /ruta del foro|mapa del foro|como seguir el foro|forum route|forum map|how to follow the forum/, href: '/foro/#cierre', es: 'Qué me llevo', en: 'What I take away' },
    { id: 'gemelo-fuentes', re: /fuentes del gemelo|de donde salen las capas|twin layer sources|where the layers come from|layer sources twin|sources for these layers/, href: '/gemelo/#fuentes-capas', es: 'Fuentes de estas capas', en: 'Sources for these layers' },
    { id: 'gemelo-fuentes-listo', re: /fuentes del gemelo|de donde salen las capas|twin layer sources|where the layers come from|layer sources twin|sources for these layers/, href: '/gemelo/#listo', es: 'Qué falta', en: 'What is missing' },
    { id: 'gemelo-fuentes-viv', re: /fuentes del gemelo|de donde salen las capas|twin layer sources|where the layers come from|layer sources twin|sources for these layers/, href: '/gemelo/?theme=vivienda#fuentes-capas', es: 'Fuentes del tema de vivienda', en: 'Housing theme sources' },
    { id: 'gemelo-recetas', re: /recetas de escenario|generar escenario|scenario recipes|generate scenario|scenario recipe/, href: '/gemelo/#recetas', es: 'Recetas de escenario', en: 'Scenario recipes' },
    { id: 'gemelo-recetas-agua', re: /recetas de escenario|generar escenario|scenario recipes|generate scenario|scenario recipe/, href: '/gemelo/?theme=vivienda&scenario=water_first&path=diagnostico&lever=deficit&z=sniiv_2025', es: 'Agua primero', en: 'Water first' },
    { id: 'gemelo-consulta', re: /consulta ciudadana gemelo|preguntas para la mesa|citizen consultation twin|questions for the table|twin consultation/, href: '/gemelo/#consulta', es: 'Consulta ciudadana', en: 'Citizen consultation' },
    { id: 'gemelo-consulta-diag', re: /consulta ciudadana gemelo|preguntas para la mesa|citizen consultation twin|questions for the table|twin consultation/, href: '/gemelo/?path=diagnostico#consulta', es: 'Preguntas del diagnóstico', en: 'Diagnosis questions' },
    { id: 'gemelo-copia', re: /compartir gemelo|copiar vista|share twin|copy view|share the twin/, href: '/gemelo/#cdt-share', es: 'Copiar vista', en: 'Copy view' },
    { id: 'gemelo-copia-agua', re: /compartir gemelo|copiar vista|share twin|copy view|share the twin/, href: '/gemelo/?theme=vivienda&scenario=water_first&path=diagnostico&lever=deficit&z=sniiv_2025', es: 'Agua primero', en: 'Water first' },
    { id: 'gemelo-recorrido', re: /recorrido del gemelo|demo gemelo|guion 10 minutos|twin walkthrough|twin demo|ten-minute twin/, href: '/gemelo/#recorrido-gemelo', es: 'Guión de diez minutos', en: 'Ten-minute script' },
    { id: 'gemelo-recorrido-agua', re: /recorrido del gemelo|demo gemelo|guion 10 minutos|twin walkthrough|twin demo|ten-minute twin/, href: '/gemelo/?theme=vivienda&scenario=water_first&path=diagnostico&lever=deficit&z=sniiv_2025', es: 'Agua primero', en: 'Water first' },
    { id: 'gemelo-checklist', re: /novedades gemelo|checklist anfitrion|que hay de nuevo en el gemelo|host checklist|what's new on the twin|what's new in the twin|twin news/, href: '/gemelo/#checklist-anfitrion', es: 'Checklist del anfitrión', en: 'Host checklist' },
    { id: 'gemelo-checklist-inicio', re: /novedades gemelo|checklist anfitrion|que hay de nuevo en el gemelo|host checklist|what's new on the twin|what's new in the twin|twin news/, href: '/inicio/', es: 'Novedades en inicio', en: 'What’s new on Home' },
    { id: 'gemelo-checklist-recorrido', re: /novedades gemelo|checklist anfitrion|que hay de nuevo en el gemelo|host checklist|what's new on the twin|what's new in the twin|twin news/, href: '/gemelo/#recorrido-gemelo', es: 'Guión de diez minutos', en: 'Ten-minute script' },
    { id: 'gemelo-novedades', re: /gemelo mas rapido|faster twin/, href: '/gemelo/#presets', es: 'Gemelo más rápido', en: 'Faster twin' },
    { id: 'gemelo-novedades-diag', re: /gemelo mas rapido|faster twin/, href: '/gemelo/?path=diagnostico', es: 'Diagnóstico', en: 'Diagnosis' },
    { id: 'gemelo-atlas', re: /abrir en el atlas|del gemelo al atlas|open in the atlas|from the twin to the atlas/, href: '/explorar/?tema=urbano&capas=cities,zoning', es: 'Abrir en el atlas', en: 'Open in atlas' },
    { id: 'gemelo-atlas-back', re: /abrir en el atlas|del gemelo al atlas|open in the atlas|from the twin to the atlas/, href: '/gemelo/?path=diagnostico&theme=urbano', es: 'Gemelo territorial', en: 'Decision twin' },
    { id: 'gemelo-still', re: /fotos del municipio|still gemelo|leyenda extrusion|municipality photos|twin still|extrusion legend/, href: '/gemelo/#cdt-fiche-wrap', es: 'Fotos en la ficha', en: 'Photos on the fiche' },
    { id: 'gemelo-still-legend', re: /fotos del municipio|still gemelo|leyenda extrusion|municipality photos|twin still|extrusion legend/, href: '/gemelo/?z=pob', es: 'Leyenda de la altura', en: 'Height legend' },
    { id: 'gemelo-preset', re: /presets del gemelo|reunion gemelo|para la reunion|meeting presets|twin meeting|for the meeting/, href: '/gemelo/#presets', es: 'Para la reunión', en: 'For the meeting' },
    { id: 'gemelo-preset-agua', re: /presets del gemelo|reunion gemelo|para la reunion|meeting presets|twin meeting|for the meeting/, href: '/gemelo/?theme=vivienda&scenario=water_first&path=diagnostico&lever=deficit&z=sniiv_2025', es: 'Agua primero', en: 'Water first' },
    { id: 'gemelo-lado', re: /comparar escenarios lado a lado|escenario a y b|compare scenarios side by side|scenario a and b/, href: '/gemelo/?scenario=baseline&compare=water_first', es: 'Comparar lado a lado', en: 'Compare side by side' },
    { id: 'gemelo-lado-b', re: /comparar escenarios lado a lado|escenario a y b|compare scenarios side by side|scenario a and b/, href: '/gemelo/?path=escenario', es: 'Qué cambia', en: 'What changes' },
    { id: 'gemelo-3d', re: /gemelo 3d|capas del gemelo|3d twin|twin layers|\bescenarios\b/, href: '/gemelo/', es: 'Gemelo 3D', en: '3D twin' },
    { id: 'gemelo-3d-limites', re: /gemelo 3d|capas del gemelo|3d twin|twin layers|\bescenarios\b/, href: '/gemelo/#limites', es: 'Qué puede y qué no puede', en: 'What it can and cannot do' },
    { id: 'gemelo-extrusion', re: /extrusion municipal|extrusion del municipio|palancas del escenario|scenario levers|municipal extrusion/, href: '/gemelo/?z=pob', es: 'Altura municipal', en: 'Municipal height' },
    { id: 'gemelo-extrusion-limites', re: /extrusion municipal|extrusion del municipio|palancas del escenario|scenario levers|municipal extrusion/, href: '/gemelo/#limites', es: 'Qué puede y qué no puede', en: 'What it can and cannot do' },
    { id: 'gemelo-camino-rec', re: /recomendacion gemelo|twin recommendation/, href: '/gemelo/?path=recomendacion', es: 'Recomendación', en: 'Recommendation' },
    { id: 'gemelo-camino', re: /camino de decision|diagnostico gemelo|decision path|twin diagnosis/, href: '/gemelo/?path=diagnostico', es: 'Camino de decisión', en: 'Decision path' },
    { id: 'gemelo-camino-meta', re: /camino de decision|decision path/, href: '/gemelo/?path=meta', es: 'Meta', en: 'Goal' },
    { id: 'gemelo-cruce', re: /impacto entre temas|efectos cruzados|ontologia del escenario|cross-theme impact|cross effects|scenario ontology/, href: '/gemelo/?path=escenario', es: 'Impacto entre temas', en: 'Cross-theme impact' },
    { id: 'gemelo-cruce-onto', re: /impacto entre temas|efectos cruzados|ontologia del escenario|cross-theme impact|cross effects|scenario ontology/, href: '/ontologia/', es: 'Ontología', en: 'Ontology' },
    { id: 'gemelo-ficha', re: /ficha municipal|demanda y oferta gemelo|municipal fiche|twin demand and supply/, href: '/gemelo/?muni=Los%20Cabos', es: 'Ficha municipal', en: 'Municipal fiche' },
    { id: 'gemelo-ficha-rec', re: /ficha municipal|demanda y oferta gemelo|municipal fiche|twin demand and supply/, href: '/gemelo/?path=recomendacion', es: 'Recomendación', en: 'Recommendation' },
    { id: 'vista-agua', re: /agua primero|water first/, href: '/vistas/#agua-sur', es: 'Agua primero en el sur', en: 'Water first in the south' },
    { id: 'vista-corredor', re: /crecimiento cabos|corredor cabos|cabos-la paz/, href: '/vistas/#corredor', es: 'Crecimiento Cabos–La Paz', en: 'Cabos–La Paz growth' },
    { id: 'vista-puertos', re: /puertos y aeropuertos|ports and airports/, href: '/vistas/#puertos', es: 'Puertos y aeropuertos', en: 'Ports and airports' },
    { id: 'vista-vivienda', re: /contexto de vivienda|housing context/, href: '/vistas/#vivienda', es: 'Contexto de vivienda', en: 'Housing context' },
    { id: 'vista-east', re: /east cape.{0,40}(vista|view|capa|mapa|proteg)|(vista|view).{0,40}east cape/, href: '/vistas/#east-cape', es: 'East Cape y áreas protegidas', en: 'East Cape and protected areas' },
    { id: 'foro-10', re: /recorrido de 10|ten-minute walk|10 minutos/, href: '/foro/#recorrido', es: 'Recorrido de 10 minutos', en: 'Ten-minute walk' },
    { id: 'vistas-cinco', re: /cinco vistas|five named views|five saved views/, href: '/vistas/', es: 'Las cinco vistas', en: 'The five views' },
    { id: 'gemelo-urbano', re: /\b(diseno urbano|urban design|forma del asentamiento)\b/, href: '/gemelo/?theme=urbano', es: 'Gemelo · diseño urbano', en: 'Twin · urban design' },
    { id: 'gemelo-economia', re: /\b(desarrollo economico|economic development|ley de ingresos)\b/, href: '/gemelo/?theme=economia', es: 'Gemelo · desarrollo económico', en: 'Twin · economic development' },
    { id: 'gemelo-invest', re: /\b(innovacion e investigacion|tema de investigacion|university network)\b/, href: '/gemelo/?theme=investigacion', es: 'Gemelo · investigación', en: 'Twin · research' },
    { id: 'gemelo-mov', re: /\b(movilidad|logistica|pasajeros aereos|air passengers|cruceros)\b/, href: '/gemelo/?theme=movilidad', es: 'Gemelo · movilidad', en: 'Twin · mobility' },
    { id: 'gemelo-viv', re: /\b(vivienda|nivel de vida|housing backlog|rezago habitacional)\b/, href: '/gemelo/?theme=vivienda', es: 'Gemelo · vivienda', en: 'Twin · housing' },
    { id: 'gemelo', re: /\b(gemelo|territorial twin)\b|compar(?:ar|o)\b.{0,24}\bmunicipios|compare municipalities/, href: '/gemelo/', es: 'Gemelo territorial', en: 'Territorial twin' },
    { id: 'vistas', re: /\b(vistas guardadas|saved views|vista guardada)\b|\bvistas\b(?! aereas)/, href: '/vistas/', es: 'Vistas guardadas', en: 'Saved views' },
    { id: 'metas', re: /\b(preguntas abiertas|open questions|brechas de datos|data gaps)\b/, href: '/metas/', es: 'Preguntas abiertas', en: 'Open questions' },
    { id: 'coord', re: /\b(coordinacion|project coordination)\b/, href: '/coordinacion/', es: 'Coordinación de proyectos', en: 'Project coordination' },
    { id: 'apr-ev', re: /\b(evidencia externa|external evidence)\b/, href: '/aprendizaje/#evidencia', es: 'Evidencia externa', en: 'External evidence' },
    { id: 'apr', re: /\b(aprender de otras ciudades|learn from other cities|otras ciudades|other cities|aprendizaje)\b/, href: '/aprendizaje/', es: 'Aprender de otras ciudades', en: 'Learn from other cities' },
    { id: 'foro', re: /\b(hoja para invitados|guest sheet|foro mar de cortes|foro)\b/, href: '/foro/', es: 'Hoja para invitados', en: 'Guest sheet' },
  ];
  const hits = [];
  for (const s of surfaces) {
    if (!s.re.test(q)) continue;
    if (s.id === 'gemelo' && hits.some((h) => String(h.href).includes('theme='))) continue;
    hits.push({ type: 'link', kind: 'portal', label: en ? s.en : s.es, href: s.href });
    if (hits.length >= 3) break;
  }
  return hits;
}

function portalGuideBoost(message, chunk) {
  const q = normQ(message);
  const hay = `${chunk?.id || ''} ${chunk?.path || ''}`;
  if (!/^portal[:/]/.test(hay)) return 0;
  const rules = [
    [/pasajeros?\s+loreto|loreto.{0,30}pasajeros|compar(?:ar|o)\s+aeropuertos|compare airports|eje aereo|air axis/, /eje-aereo/],
    [/agua primero|water first|cinco vistas|five named views|five saved views|contexto de vivienda|housing context|recorrido de 10|ten-minute walk|puertos y aeropuertos|east cape/, /vistas-nombres/],
    [/desalaci|desalinat|agua no contabilizada|non-revenue water|uncounted water|unbilled water|\bc40\b|urbanshift|urban shift/, /evidencia-desal/],
    [/como usar el gemelo|como leer el tablero|how to use the twin|how to read the twin|how to read the board/, /gemelo-leer/],
    [/que no puede el gemelo|limites del gemelo|limites fase 1|what the twin cannot|twin limits|phase 1 limits/, /gemelo-limites/],
    [/que falta en el gemelo|listo para fase 3|\bageb\b|data readiness|ready for phase 3|what the twin is missing|what is missing from the twin/, /gemelo-listo/],
    [/recorrido del gemelo|demo gemelo|guion 10 minutos|twin walkthrough|twin demo|ten-minute twin/, /gemelo-recorrido/],
    [/compartir gemelo|copiar vista|share twin|copy view|share the twin/, /gemelo-copia/],
    [/consulta ciudadana gemelo|preguntas para la mesa|citizen consultation twin|questions for the table|twin consultation/, /gemelo-consulta/],
    [/recetas de escenario|generar escenario|scenario recipes|generate scenario|scenario recipe/, /gemelo-recetas/],
    [/fuentes del gemelo|de donde salen las capas|twin layer sources|where the layers come from|layer sources twin|sources for these layers/, /gemelo-fuentes/],
    [/kit reunion|imprimir foro|lista para la reunion/, /foro-kit/],
    [/que me llevo del foro|enlaces despues de la reunion|takeaway foro|what i take away|links after the meeting|forum takeaway/, /foro-cierre/],
    [/ruta del foro|mapa del foro|como seguir el foro|forum route|forum map|how to follow the forum/, /foro-ruta/],
    [/gemelo 3d|capas del gemelo|3d twin|twin layers|\bescenarios\b/, /gemelo-3d/],
    [/extrusion municipal|extrusion del municipio|palancas del escenario|scenario levers|municipal extrusion/, /gemelo-extrusion/],
    [/camino de decision|diagnostico gemelo|recomendacion gemelo|decision path|twin diagnosis|twin recommendation/, /gemelo-camino/],
    [/impacto entre temas|efectos cruzados|ontologia del escenario|cross-theme impact|cross effects|scenario ontology/, /gemelo-cruce/],
    [/ficha municipal|demanda y oferta gemelo|municipal fiche|twin demand and supply/, /gemelo-ficha/],
    [/comparar escenarios lado a lado|escenario a y b|compare scenarios side by side|scenario a and b/, /gemelo-lado/],
    [/presets del gemelo|reunion gemelo|para la reunion|meeting presets|twin meeting|for the meeting/, /gemelo-preset/],
    [/fotos del municipio|still gemelo|leyenda extrusion|municipality photos|twin still|extrusion legend/, /gemelo-stills/],
    [/abrir en el atlas|del gemelo al atlas|open in the atlas|from the twin to the atlas/, /gemelo-atlas/],
    [/novedades gemelo|checklist anfitrion|que hay de nuevo en el gemelo|host checklist|what's new on the twin|what's new in the twin|twin news/, /gemelo-checklist/],
    [/gemelo mas rapido|faster twin/, /gemelo-novedades/],
    [/\bevidencia\b|casos de otras ciudades|cases from other cities|recorrido foro|hoja invitados/, /consulta-ruta/],
    [/\bgemelo\b|territorial twin|compar(?:ar|o)\b.{0,24}\bmunicipios|compare municipalities|diseno urbano|urban design|desarrollo economico|ley de ingresos|movilidad|pasajeros aereos|vivienda|nivel de vida/, /gemelo/],
    [/vistas guardadas|saved views|\bvistas\b/, /vistas/],
    [/preguntas abiertas|open questions|brechas de datos|data gaps/, /metas/],
    [/\bcoordinacion\b|project coordination/, /coordinacion/],
    [/aprender de otras ciudades|otras ciudades|learn from other cities|evidencia externa|external evidence|\baprendizaje\b/, /aprendizaje|evidencia/],
    [/hoja para invitados|guest sheet|foro mar de cortes|\bforo\b/, /foro/],
  ];
  for (const [re, prefer] of rules) {
    if (re.test(q) && prefer.test(hay)) return 48;
  }
  return 0;
}

function buildAnswerBlocks({ evidence, message, lang, noEvidence, primary_file, placeId, uiPlace }) {
  const surfaces = portalSurfaceBlocks(message, lang);
  if (noEvidence) return surfaces;
  const munis = targetMunis(message, uiPlace || placeId);
  const muniOk = (m) => !munis || (m && munis.includes(m));
  const en = lang === 'en';
  const blocks = [];
  // 1) Population table from municipio chunks (whole-municipality figures only)
  const muni = [];
  for (const c of evidence) {
    if (c.type !== 'municipio' || /localidad/.test(c.path || '')) continue;
    const m = String(c.sum_es || '').match(/del municipio ([^()]+?) \(municipio completo[^)]*\):\s*([\d,]+) habitantes/);
    if (m && !muni.find((r) => r[0] === m[1].trim())) muni.push([m[1].trim(), m[2], 'INEGI Censo 2020']);
  }
  if (muni.length >= 2) {
    blocks.push({ type: 'table', title: en ? 'Population by municipality' : 'Población por municipio',
      headers: en ? ['Municipality', 'Inhabitants', 'Source'] : ['Municipio', 'Habitantes', 'Fuente'], rows: muni });
  }
  // 1b) Charts — ONLY from numbers literally present in retrieved chunks
  if (muni.length >= 2) {
    blocks.push({ type: 'chart', kind: 'bar', title: en ? 'Inhabitants by municipality (2020)' : 'Habitantes por municipio (2020)',
      source: 'INEGI, Censo de Población y Vivienda 2020', unit: en ? 'inhabitants' : 'habitantes',
      series: muni.map((r) => ({ label: r[0], value: Number(String(r[1]).replace(/,/g, '')) })).sort((a, b) => b.value - a.value) });
  } else {
    for (const c of evidence) {
      if (c.type !== 'municipio' || /localidad/.test(c.path || '')) continue;
      const s0 = String(c.sum_es || '');
      const m = s0.match(/del municipio ([^()]+?) \(municipio completo[^)]*\):\s*([\d,]+) habitantes/);
      const k = s0.match(/cabecera, la localidad ([^,]+), tiene ([\d,]+) habitantes/);
      if (m && k && (!munis || munis.includes(m[1].trim()))) {
        const mv = Number(m[2].replace(/,/g, '')), kv = Number(k[2].replace(/,/g, ''));
        blocks.push({ type: 'chart', kind: 'bar', title: en ? `${m[1].trim()}: municipality vs. main town (2020)` : `${m[1].trim()}: municipio vs. cabecera (2020)`,
          source: 'INEGI, Censo de Población y Vivienda 2020', unit: en ? 'inhabitants' : 'habitantes',
          series: [{ label: en ? `Municipality ${m[1].trim()}` : `Municipio ${m[1].trim()}`, value: mv },
            { label: en ? `Town ${k[1].trim()} (seat)` : `Ciudad ${k[1].trim()} (cabecera)`, value: kv },
            { label: en ? 'Rest of the municipality' : 'Resto del municipio', value: mv - kv }] });
        break;
      }
    }
  }
  {
    const dma = evidence.filter((c) => c.type === 'fact' && /^DMA\b/.test(String(c.metric || '')) && /^[+\-−]?\d+(\.\d+)?$/.test(String(c.value || '').trim()));
    if (dma.length >= 2) blocks.push({ type: 'chart', kind: 'bar', signed: true,
      title: en ? 'Mean water availability by aquifer (hm³/yr)' : 'Disponibilidad media de agua por acuífero (hm³/año)',
      source: en ? 'CONAGUA via portal water guide' : 'CONAGUA vía guía de agua del portal', unit: 'hm³',
      series: dma.slice(0, 8).map((c) => ({ label: String(c.metric).replace(/^DMA\s*—\s*/, (en ? 'Aquifer ' : 'Acuífero ')), value: Number(String(c.value).replace('−', '-')) })) });
  }
  // 2) Facts table (metric/value pairs already in the corpus)
  const facts = evidence.filter((c) => c.type === 'fact' && c.metric && c.value).slice(0, 8);
  if (facts.length >= 3) {
    blocks.push({ type: 'table', title: en ? 'Figures from the portal' : 'Cifras del portal',
      headers: en ? ['Metric', 'Value', 'Topic'] : ['Indicador', 'Valor', 'Tema'],
      rows: facts.map((c) => {
        const yr = String(c.sum_es || '').match(/=\s*[^()]*\((\d{4})\)/);
        return [c.metric, c.value + (yr ? ` (${yr[1]})` : ''), c.theme_label || c.theme || ''];
      }) });
  }
  // 3) Stills (real aerial views) with coordinates
  const stills = [];
  for (const c of evidence.filter((x) => x.type === 'still')) {
    if (stills.length >= 4) break;
    const sid = String(c.id || '').replace(/^still:/, '');
    const md = chatMedia.stills?.[sid];
    if (!md?.thumb) continue;
    if (!muniOk(md.municipio || c.municipio)) continue;
    const lat = md.lat ?? c.lat, lon = md.lon ?? c.lon;
    stills.push(c);
    blocks.push({ type: 'image', src: md.thumb, full: md.image || md.thumb,
      alt: md.name || c.title, caption: `${md.name || ''}${md.municipio ? ' · ' + md.municipio : ''}`,
      href: '/explorar?fotos=1',
      maps_url: lat != null && lon != null ? `https://www.google.com/maps?q=${lat},${lon}` : null });
  }
  // 4) Map atlas images: hits on map files first, then topic match on the question
  const mapFiles = [];
  for (const c of evidence) {
    const m = String(c.path || '').match(/\/maps\/([\w.-]+\.jpg)$/);
    if (m && chatMedia.maps?.includes(m[1]) && !mapFiles.includes(m[1])) mapFiles.push(m[1]);
  }
  const q = normQ(message);
  for (const [re, files] of MAP_TOPICS) {
    if (re.test(q)) for (const f of files) if (chatMedia.maps?.includes(f) && !mapFiles.includes(f)) mapFiles.push(f);
  }
  const okMaps = mapFiles.filter((f) => { const m = mapFileMuni(f); return m ? !!munis && munis.includes(m) : true; });
  mapFiles.length = 0; mapFiles.push(...okMaps);
  for (const f of mapFiles.slice(0, 4)) {
    const cap = mapCaption(f, lang);
    blocks.push({ type: 'map', title: cap.title, caption: cap.source ? (en ? 'Source: ' : 'Fuente: ') + cap.source : null,
      thumb: '/maps/' + f, href: '/mapas/' });
  }
  if (placeId || stills.length || mapFiles.length) {
    blocks.push({ type: 'map', title: en ? 'Open the 3D territorial atlas' : 'Abrir el atlas territorial 3D',
      href: '/explorar' + (stills.length ? '?fotos=1' : ''), thumb: null });
  }
  // 5) Primary document link
  const pfOther = munis && primary_file && MUNI_RES.some(([m, re]) => !munis.includes(m) && re.test(normQ(primary_file.title || '')))
    && !MUNI_RES.some(([m, re]) => munis.includes(m) && re.test(normQ(primary_file.title || '')));
  if (primary_file && !pfOther && (primary_file.view_url || primary_file.catalog_url)) {
    blocks.push({ type: 'link', kind: 'document', label: primary_file.title || (en ? 'Source document' : 'Documento fuente'),
      href: primary_file.view_url || primary_file.catalog_url });
  }
  for (const link of surfaces) {
    if (!blocks.some((b) => b.type === 'link' && b.href === link.href)) blocks.push(link);
  }
  return blocks.filter((b) => !/08_fp_team_research/i.test(JSON.stringify(b)));
}

function evidenceSources(chunks, max = 5, newsFirst = false) {
  // Mixed answers show both kinds: news-intent questions lead with news cards, others with official sources;
  // at most 3 of the leading kind come first, then the best of the other kind, then the rest.
  const isNews = (c) => c.type === 'news';
  const lead = chunks.filter((c) => (newsFirst ? isNews(c) : !isNews(c)));
  const other = chunks.filter((c) => (newsFirst ? !isNews(c) : isNews(c)));
  if (lead.length && other.length) chunks = [...lead.slice(0, 3), ...other.slice(0, 1), ...lead.slice(3), ...other.slice(1)];
  const out = [];
  const seen = new Set();
  for (const c of chunks) {
    const key = (cardTitle(c) + (c.display_title ? '' : '|' + (c.path || ''))).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const portalHref = {
      gemelo: '/gemelo/',
      aprendizaje: '/aprendizaje/',
      coordinacion: '/coordinacion/',
      vistas: '/vistas/',
      metas: '/metas/',
      foro: '/foro/',
    };
    const portalSlug = String(c.path || '').startsWith('portal/') ? String(c.path).slice(7).split('/')[0] : '';
    const card = { title: cardTitle(c), theme_label: c.theme_label || null, path: c.path, drive_url: c.drive_url || null, href: c.href || portalHref[portalSlug] || null, type: c.type || null };
    if (c.type === 'news') {
      Object.assign(card, {
        label: c.no_summary ? 'Noticia sin resumen' : 'Noticia',
        label_en: c.no_summary ? 'News (no summary)' : 'News',
        no_summary: !!c.no_summary,
        outlet: c.outlet || null,
        date: c.date || null,
        date_label_es: c.date_label_es || null,
        date_label_en: c.date_label_en || null,
        url: c.url || c.href || null,
        official: false,
      });
    }
    out.push(card);
    if (out.length >= max) break;
  }
  return out;
}

function evidencePrimaryFile(chunks) {
  const best = chunks.find((c) => (c.type === 'file' || c.type === 'library') && (c.drive_url || (c.href && /^https?:/.test(c.href))));
  if (!best) return null;
  const view = best.drive_url || best.href || null;
  return {
    title: cardTitle(best),
    theme_label: best.theme_label || null,
    path: best.path || null,
    view_url: view,
    download_url: best.drive_url ? driveDownloadUrl(best.drive_url) : null,
    catalog_url: catalogHref(best),
    why: 'retrieved evidence',
  };
}

function stakeholderFromEvidence(chunks) {
  const a = chunks.find((c) => c.type === 'actor');
  if (!a) return null;
  const id = String(a.id || '').replace(/^actor:/, '');
  const st = STAKEHOLDERS.find((x) => x.id === id);
  if (!st) return null;
  return {
    id: st.id, name: st.name, description: st.description || '', contact: st.contact || '', group: st.group || '',
    subgroup: st.subgroup || '', org: st.org || null, type: st.type || 'person',
    href: `/stakeholders?q=${encodeURIComponent(st.name)}&id=${encodeURIComponent(st.id)}`,
  };
}

function relevantSignals(index, message, placeId, limit = 2) {
  const fs = foresightsData && typeof foresightsData === 'object' ? foresightsData : {};
  const signals = Array.isArray(fs.signals) ? fs.signals : [];
  return signals
    .map((s) => ({ s, n: ragOverlap(index, message, `${s.title_es} ${s.title_en} ${s.why_es || ''} ${s.theme || ''}`) + (placeId && (s.place_ids || []).includes(placeId) ? 0.5 : 0) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ s }) => ({
      id: s.id, title_es: s.title_es || null, title_en: s.title_en || null, theme: s.theme || null, place_ids: s.place_ids || [],
      href: `/foresights/${placeId ? `?place=${encodeURIComponent(placeId)}&` : '?'}signal=${encodeURIComponent(s.id)}#signal-${encodeURIComponent(s.id)}`,
    }));
}

function relevantStrategicQuestions(index, message, placeId, limit = 2) {
  const qs = strategicQuestionsData && Array.isArray(strategicQuestionsData.questions) ? strategicQuestionsData.questions : [];
  return qs
    .map((sq) => ({ sq, n: ragOverlap(index, message, `${sq.question_es} ${sq.question_en || ''}`) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ sq }) => ({ id: sq.id, question_es: sq.question_es, question_en: sq.question_en, href: `/preguntas/${sq.id}/` }));
}

const hits = new Map();
function rateOk(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 30;
  let arr = hits.get(ip) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}


function studioPathForPlace(placeId) {
  const map = {
    los_cabos: 'los_cabos',
    east_cape: 'los_cabos',
    la_paz: 'la_paz',
    todos_santos: 'la_paz',
    loreto: 'loreto',
    comondu: 'comondu',
    mulege_north: 'mulege',
  };
  if (!placeId) return '/studio/bcs/';
  return `/studio/${map[placeId] || 'bcs'}/`;
}

export async function handler(event) {
  const r = await handlerInner(event);
  try {
    if (r && typeof r.body === 'string' && r.body.charAt(0) === '{' && /"(sources|primary_file)"/.test(r.body)) {
      r.body = JSON.stringify(sanitizeCards(JSON.parse(r.body)));
    }
  } catch { /* leave body untouched */ }
  return r;
}

async function handlerInner(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!isAuthenticated(event)) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        error: 'Unauthorized',
        answer: 'Authentication required.',
        sources: [],
      }),
    };
  }

  const ip =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for'] ||
    'anon';
  if (!rateOk(String(ip).split(',')[0].trim())) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  const rawBody = event.body || '';
  if (typeof rawBody === 'string' && rawBody.length > BODY_MAX_BYTES) {
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'Payload too large' }),
    };
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const message = String(body.message || '').trim().slice(0, 2000);
  const lang = body.lang === 'en' ? 'en' : 'es';
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  if (!message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'message required' }) };
  }

  const cfg = providerConfig();
  if (!cfg.key || !cfg.url) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'Chat not configured',
        answer: lang === 'en' ? 'Chat backend is not configured.' : 'El chat no está configurado en el servidor.',
        sources: [],
      }),
    };
  }

  await ensureCorpus(event);
  const index = ragIndex();

  // ---- Grounded retrieval (see netlify/lib/rag.mjs) ----
  const lastUser = [...history].reverse().find((h) => h && h.role === 'user' && h.content);
  const isFollowUp = !!lastUser && isFollowUpMessage(message);
  const retrieveQuery = isFollowUp ? `${String(lastUser.content).slice(0, 300)} ${message}` : message;
  const explicitPlace = body.place && PLACE_SPINE[body.place] ? String(body.place) : null;
  const placeId =
    ragInferPlace(message) || (isFollowUp ? ragInferPlace(String(lastUser.content)) : null) || explicitPlace;
  const qIntents = expandQuery(message);
  const open = qIntents.isOpenIntent || qIntents.isGrowthConstraintIntent || qIntents.isScenarioIntent || qIntents.isFactorIntent;
  const res = ragSearch(index, retrieveQuery, { k: qIntents.isFactorIntent ? 12 : open ? 10 : 8, place: placeId });
  const airGuide = airAxisQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:eje-aereo-p116')
    : null;
  const viewsGuide = namedViewsQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:vistas-nombres-p118')
    : null;
  const evidenceGuide = evidenceDepthQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:evidencia-desal-p119')
    : null;
  const consultaGuide = consultaPathQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:consulta-ruta-p120')
    : null;
  const twinGuide = twinReadQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-leer-p121')
    : null;
  const kitGuide = kitQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:foro-kit-p122')
    : null;
  const limitsGuide = limitsQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-limites-p123')
    : null;
  const cierreGuide = cierreQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:foro-cierre-p124')
    : null;
  const rutaGuide = rutaQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:foro-ruta-p125')
    : null;
  const gemelo3dGuide = gemelo3dQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-3d-p20')
    : null;
  const extrusionGuide = extrusionQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-extrusion-p21')
    : null;
  const caminoGuide = caminoQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-camino-p22')
    : null;
  const cruceGuide = cruceQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-cruce-p23')
    : null;
  const fichaGuide = fichaQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-ficha-p24')
    : null;
  const sideGuide = sideQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-lado-p25')
    : null;
  const presetGuide = presetQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-presets-p26')
    : null;
  const stillGuide = stillFicheQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-stills-p27')
    : null;
  const atlasGuide = atlasQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-atlas-p28')
    : null;
  const novedadesGuide = novedadesQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-novedades-p29')
    : null;
  const readinessGuide = readinessQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-listo-p210')
    : null;
  const walkGuide = walkQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-recorrido-p211')
    : null;
  const shareGuide = shareQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-copia-p212')
    : null;
  const mesaGuide = consultaMesaQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-consulta-p213')
    : null;
  const recipeGuide = recipeQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-recetas-p214')
    : null;
  const fuentesGuide = fuentesQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-fuentes-p215')
    : null;
  const checklistGuide = checklistQuery(message)
    ? CORPUS.find((c) => c.id === 'portal:gemelo-checklist-p216')
    : null;
  let noEvidence = !res.hits.length || res.weakTop;
  const hits = noEvidence ? [] : res.hits;
  let evidence = hits.map((h) => h.c);
  if (airGuide && !evidence.some((c) => c.id === airGuide.id)) {
    evidence = [airGuide, ...evidence];
    noEvidence = false;
  }
  if (viewsGuide && !evidence.some((c) => c.id === viewsGuide.id)) {
    evidence = [viewsGuide, ...evidence];
    noEvidence = false;
  }
  if (evidenceGuide && !evidence.some((c) => c.id === evidenceGuide.id)) {
    evidence = [evidenceGuide, ...evidence];
    noEvidence = false;
  }
  if (consultaGuide && !evidence.some((c) => c.id === consultaGuide.id)) {
    evidence = [consultaGuide, ...evidence];
    noEvidence = false;
  }
  if (twinGuide && !evidence.some((c) => c.id === twinGuide.id)) {
    evidence = [twinGuide, ...evidence];
    noEvidence = false;
  }
  if (kitGuide && !evidence.some((c) => c.id === kitGuide.id)) {
    evidence = [kitGuide, ...evidence];
    noEvidence = false;
  }
  if (limitsGuide && !evidence.some((c) => c.id === limitsGuide.id)) {
    evidence = [limitsGuide, ...evidence];
    noEvidence = false;
  }
  if (cierreGuide && !evidence.some((c) => c.id === cierreGuide.id)) {
    evidence = [cierreGuide, ...evidence];
    noEvidence = false;
  }
  if (rutaGuide && !evidence.some((c) => c.id === rutaGuide.id)) {
    evidence = [rutaGuide, ...evidence];
    noEvidence = false;
  }
  if (gemelo3dGuide && !evidence.some((c) => c.id === gemelo3dGuide.id)) {
    evidence = [gemelo3dGuide, ...evidence];
    noEvidence = false;
  }
  if (extrusionGuide && !evidence.some((c) => c.id === extrusionGuide.id)) {
    evidence = [extrusionGuide, ...evidence];
    noEvidence = false;
  }
  if (caminoGuide && !evidence.some((c) => c.id === caminoGuide.id)) {
    evidence = [caminoGuide, ...evidence];
    noEvidence = false;
  }
  if (cruceGuide && !evidence.some((c) => c.id === cruceGuide.id)) {
    evidence = [cruceGuide, ...evidence];
    noEvidence = false;
  }
  if (fichaGuide && !evidence.some((c) => c.id === fichaGuide.id)) {
    evidence = [fichaGuide, ...evidence];
    noEvidence = false;
  }
  if (sideGuide && !evidence.some((c) => c.id === sideGuide.id)) {
    evidence = [sideGuide, ...evidence];
    noEvidence = false;
  }
  if (presetGuide && !evidence.some((c) => c.id === presetGuide.id)) {
    evidence = [presetGuide, ...evidence];
    noEvidence = false;
  }
  if (stillGuide && !evidence.some((c) => c.id === stillGuide.id)) {
    evidence = [stillGuide, ...evidence];
    noEvidence = false;
  }
  if (atlasGuide && !evidence.some((c) => c.id === atlasGuide.id)) {
    evidence = [atlasGuide, ...evidence];
    noEvidence = false;
  }
  if (novedadesGuide && !evidence.some((c) => c.id === novedadesGuide.id)) {
    evidence = [novedadesGuide, ...evidence];
    noEvidence = false;
  }
  if (readinessGuide && !evidence.some((c) => c.id === readinessGuide.id)) {
    evidence = [readinessGuide, ...evidence];
    noEvidence = false;
  }
  if (walkGuide && !evidence.some((c) => c.id === walkGuide.id)) {
    evidence = [walkGuide, ...evidence];
    noEvidence = false;
  }
  if (shareGuide && !evidence.some((c) => c.id === shareGuide.id)) {
    evidence = [shareGuide, ...evidence];
    noEvidence = false;
  }
  if (mesaGuide && !evidence.some((c) => c.id === mesaGuide.id)) {
    evidence = [mesaGuide, ...evidence];
    noEvidence = false;
  }
  if (recipeGuide && !evidence.some((c) => c.id === recipeGuide.id)) {
    evidence = [recipeGuide, ...evidence];
    noEvidence = false;
  }
  if (fuentesGuide && !evidence.some((c) => c.id === fuentesGuide.id)) {
    evidence = [fuentesGuide, ...evidence];
    noEvidence = false;
  }
  if (checklistGuide && !evidence.some((c) => c.id === checklistGuide.id)) {
    evidence = [checklistGuide, ...evidence];
    noEvidence = false;
  }
  if (qIntents.isFactorIntent) {
    const bundle = buildFactorEvidence(message, qIntents);
    if (bundle.length) {
      const seen = new Set();
      const bundleIds = new Set(bundle.map((c) => c.id));
      const merged = [];
      for (const c of [...bundle, ...evidence]) {
        if (!c || seen.has(c.id)) continue;
        if (c.type === 'still' && !bundleIds.has(c.id)) continue;
        seen.add(c.id);
        merged.push(c);
      }
      evidence = merged.slice(0, 24);
      noEvidence = false;
    }
  }

  const topScore = hits.length ? hits[0].score : 0;
  // chips need stronger relevance than context
  const chipEvidence = hits.filter((h) => h.coverage >= 0.5 && h.score >= topScore * 0.45).map((h) => h.c);

  let contextBlock = noEvidence
    ? (lang === 'en'
        ? '(no relevant evidence in the portal for this question)'
        : '(sin evidencia relevante en el portal para esta pregunta)')
    : formatEvidence(evidence, lang);
  if (qIntents.isFactorIntent && !noEvidence) {
    const brief = composeFactorBrief(evidence, lang);
    if (brief) contextBlock = `${brief}\n\n${contextBlock}`;
  }

  const messages = [
    {
      role: 'system',
      content: groundedPrompt(lang, contextBlock, {
        placeLabel: placeId ? (PLACE_SPINE[placeId][lang] || PLACE_SPINE[placeId].es) : null,
        noEvidence,
        factorKinds: qIntents.isFactorIntent ? qIntents.factorKinds : null,
      }),
    },
    ...history
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
      .map((h) => ({ role: h.role, content: String(h.content).slice(0, 1200) })),
    { role: 'user', content: message },
  ];

  async function callLLM(msgs) {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: msgs, max_tokens: 700, temperature: 0.1 }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Object.assign(new Error('LLM error'), { status: resp.status });
    return data?.choices?.[0]?.message?.content?.trim() || '';
  }

  let answer = '';
  let numberGuard = null;
  try {
    answer = await callLLM(messages);
    // Number guard: every figure must come from the retrieved evidence (or the user's own words)
    const allowed = `${contextBlock}\n${message}\n${history.map((h) => h?.content || '').join('\n')}`;
    let bad = unsupportedNumbers(answer, allowed);
    if (bad.length) {
      numberGuard = { first: bad };
      const fix =
        lang === 'en'
          ? `Your draft contains figures that are NOT in CONTEXT: ${bad.join(', ')}. Rewrite the answer using only figures that appear literally in CONTEXT; if a figure is not there, say the portal does not have it.`
          : `Tu borrador contiene cifras que NO están en el CONTEXTO: ${bad.join(', ')}. Reescribe la respuesta usando solo cifras que aparezcan literalmente en el CONTEXTO; si una cifra no está, di que el portal no la tiene.`;
      answer = await callLLM([...messages, { role: 'assistant', content: answer }, { role: 'user', content: fix }]);
      bad = unsupportedNumbers(answer, allowed);
      if (bad.length) {
        // last resort: drop sentences that still carry unsupported figures
        const kept = answer
          .split(/(?<=[.!?])\s+/)
          .filter((s) => !unsupportedNumbers(s, allowed).length);
        answer = kept.join(' ').trim();
        numberGuard.dropped = bad;
      }
    }
    if (!answer) answer = lang === 'en' ? 'The portal has no evidence to answer this.' : 'El portal no tiene evidencia para responder esto.';
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: e?.status ? 'LLM error' : 'Upstream failure',
        answer: lang === 'en' ? 'The language model returned an error. Try again later.' : 'El modelo de lenguaje devolvió un error. Intenta más tarde.',
        sources: [],
      }),
    };
  }

  answer = scrubOntologyIdsFromAnswer(answer);

  // ---- Chips: only from gated evidence, never fallbacks ----
  const sources = evidenceSources(hits.filter((h) => h.coverage >= 0.34).map((h) => h.c), 5, !!res.newsIntent);
  const primary_file = noEvidence ? null : evidencePrimaryFile(chipEvidence);
  const ontology = noEvidence ? [] : buildOntologyLinks(evidence.filter((c) => c.type === 'ontology'), message, qIntents, qIntents.isFactorIntent ? 6 : 2, true);
  const stakeholder = noEvidence ? null : stakeholderFromEvidence(chipEvidence);
  const foresight_signals = noEvidence || !open ? [] : relevantSignals(index, message, placeId, 2);
  const foresight_signal = foresight_signals[0] || null;
  const strategic_questions = noEvidence ? [] : relevantStrategicQuestions(index, message, placeId, 2);
  const placePayload = placeId
    ? { id: placeId, label_es: PLACE_SPINE[placeId].es, label_en: PLACE_SPINE[placeId].en }
    : null;


  let blocks = [];
  try {
    blocks = buildAnswerBlocks({ evidence, message, lang, noEvidence, primary_file, placeId, uiPlace: explicitPlace });
    // The model already drew a table: do not repeat a structured one underneath
    if (/^\s*\|.*\|\s*$/m.test(answer) && /^\s*\|?\s*:?-{2,}/m.test(answer)) blocks = blocks.filter((b) => b.type !== 'table');
  } catch (e) { console.warn('blocks', e?.message || e); }

  // ---- Conversational loop (2026-10-26): every reply ends with a question + clickable follow-up chips ----
  const followUps = buildFollowUps({ message, lang, placeId, munis: targetMunis(message, explicitPlace) });
  const surfaceLead = portalSurfaceBlocks(message, lang)[0];
  if (surfaceLead) {
    followUps.unshift(lang === 'en'
      ? `Do you want to open ${surfaceLead.label}, or ask about one municipality?`
      : `¿Abres ${surfaceLead.label}, o preguntas por un municipio?`);
  }
  try {
    const lines = String(answer).trim().split('\n');
    const last = (lines[lines.length - 1] || '').trim();
    const q0 = /👉/.test(last) ? last.replace(/^.*?👉\s*/, '').trim() : null;
    if (q0 && !followUps.includes(q0)) followUps.unshift(q0);
    if (!/\?\s*\**\s*$/.test(last)) answer = String(answer).trim() + '\n\n👉 ' + followUps[0];
  } catch (e) {}
  followUps.splice(3);

  const clientIp = String(ip).split(',')[0].trim();
  // Durable turn log (Blobs); never block the chat response on store failure
  let memory_log = null;
  try {
    memory_log = await logChatTurn(
      event,
      {
        q: message,
        answer,
        sources,
        lang,
        sessionRaw: body.session || body.session_id || null,
        intents: qIntents,
        gapExplicit:
          typeof body.gap === 'boolean'
            ? body.gap
            : noEvidence
              ? true // no evidence in the portal -> logged as a data gap
              : undefined,
        voice: !!body.voice,
        place: placeId,
      },
      clientIp
    );
  } catch (e) {
    memory_log = { ok: false, reason: String(e?.message || e) };
    console.warn('chat turn log', e?.message || e);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      answer,
      primary_file,
      ontology,
      stakeholder,
      sources,
      place: placePayload,
      foresight_signal,
      foresight_signals,
      strategic_questions,
      blocks,
      followUps,
      grounded: !noEvidence,
      evidence_count: evidence.length,
      number_guard: numberGuard,
      memory_log,
      actions: {
        open_lugares: studioPathForPlace(placeId),
        open_crecimiento: placeId ? `/crecimiento/?place=${placeId}#${placeId}` : '/crecimiento/',
        open_map: '/mapas/',
        compare_places: '/studio/',
        create_strategic_question: '/preguntas/',
            open_studio: studioPathForPlace(placeId),
        request_missing_evidence: placeId ? `/crecimiento/?place=${placeId}#${placeId}` : '/crecimiento/',
        strategy_session: placeId ? `/sesion/?place=${placeId}` : '/sesion/',
      },
    }),
  };
}

export { retrieve, expandQuery, pickOntologyNodeIds, scoreChunk, buildFactorEvidence, composeFactorBrief, portalSurfaceBlocks, inferPlaceId, targetMunis };
