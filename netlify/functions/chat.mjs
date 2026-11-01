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
    ['loreto', ['loreto', 'lto']],
    ['comondu', ['comondu', 'constitucion', 'ciudad constitucion']],
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

  const isLibraryIntent = LIB_INTENT_RE.test(qn);
  return {
    tokens: [...set],
    isLibraryIntent,
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

function groundedPrompt(lang, contextBlock, { placeLabel = null, noEvidence = false } = {}) {
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
${contextBlock}`;
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
${contextBlock}`;
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
  ['Comondú', /\b(comondu|ciudad constitucion|constitucion|puerto san carlos|puerto adolfo lopez mateos|ciudad insurgentes)\b/],
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
  return /novedades gemelo|gemelo mas rapido|twin news|faster twin/.test(q);
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
    { id: 'gemelo-novedades', re: /novedades gemelo|gemelo mas rapido|twin news|faster twin/, href: '/gemelo/#presets', es: 'Novedades del gemelo', en: 'What is new on the twin' },
    { id: 'gemelo-novedades-diag', re: /novedades gemelo|gemelo mas rapido|twin news|faster twin/, href: '/gemelo/?path=diagnostico', es: 'Diagnóstico', en: 'Diagnosis' },
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
    [/novedades gemelo|gemelo mas rapido|twin news|faster twin/, /gemelo-novedades/],
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
  const open = qIntents.isOpenIntent || qIntents.isGrowthConstraintIntent || qIntents.isScenarioIntent;
  const res = ragSearch(index, retrieveQuery, { k: open ? 10 : 8, place: placeId });
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
  const topScore = hits.length ? hits[0].score : 0;
  // chips need stronger relevance than context
  const chipEvidence = hits.filter((h) => h.coverage >= 0.5 && h.score >= topScore * 0.45).map((h) => h.c);

  const contextBlock = noEvidence
    ? (lang === 'en'
        ? '(no relevant evidence in the portal for this question)'
        : '(sin evidencia relevante en el portal para esta pregunta)')
    : formatEvidence(evidence, lang);

  const messages = [
    {
      role: 'system',
      content: groundedPrompt(lang, contextBlock, {
        placeLabel: placeId ? (PLACE_SPINE[placeId][lang] || PLACE_SPINE[placeId].es) : null,
        noEvidence,
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
  const ontology = noEvidence ? [] : buildOntologyLinks(evidence.filter((c) => c.type === 'ontology'), message, qIntents, 2, true);
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

export { retrieve, expandQuery, pickOntologyNodeIds, scoreChunk, portalSurfaceBlocks };
