/**
 * Citizen-facing polish for chat answers, source chips, tables and follow-ups.
 * Does not change retrieval order. Figures below are copied from portal files
 * (aquifers_bcs.json 0328; ambiente guide; INEGI rows already in the corpus).
 */

export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const GAP = { es: 'Dato faltante', en: 'Missing data' };

const THEME_LABEL = {
  agua: ['Agua', 'Water'],
  territorio: ['Territorio', 'Territory'],
  turismo: ['Turismo', 'Tourism'],
  economia: ['Economía', 'Economy'],
  energia: ['Energía', 'Energy'],
  ambiente: ['Ambiente', 'Environment'],
  planeacion: ['Planeación', 'Planning'],
  conectividad: ['Conectividad', 'Connectivity'],
  riesgos: ['Riesgos', 'Hazards'],
  portal: ['Portal', 'Portal'],
  poblacion: ['Población', 'Population'],
  vivienda: ['Vivienda', 'Housing'],
  ontologia: ['Relaciones', 'Relationships'],
};

const EN_GUIDE_ES = [
  [/all bcs aquifers/i, 'Acuíferos de Baja California Sur'],
  [/growth-pole dma deficits/i, 'Déficit de agua en los polos de crecimiento'],
  [/bcs dma deficit snapshot/i, 'Disponibilidad de agua — estimación con cifras CONAGUA'],
  [/documented dma deficits/i, 'Disponibilidad de agua — estimación con cifras CONAGUA'],
];

const MUNI_RES = [
  ['Los Cabos', /\b(los cabos|cabo san lucas|san jose del cabo)\b/],
  ['La Paz', /\b(la paz|todos santos|balandra)\b/],
  ['Loreto', /\bloreto\b/],
  ['Comondú', /\b(comondu|ciudad constitucion)\b/],
  ['Mulegé', /\b(mulege|santa rosalia|guerrero negro)\b/],
];

export function munisIn(text) {
  const q = fold(text);
  return MUNI_RES.filter(([, re]) => re.test(q)).map(([m]) => m);
}

export function scrubCitizenText(text, lang = 'es') {
  const gap = GAP[lang === 'en' ? 'en' : 'es'];
  let s = String(text || '');
  s = s.replace(/\b(?:Ontology|Ontolog[ií]a)\s+(?:Territory|Evidence|ResourceCapacity|DecisionQuestion|Instrument|Constraint|Actor|Project|DemandDriver)\s*:\s*/gi, '');
  s = s.replace(/\b(?:Ontology|Ontolog[ií]a)\s+[A-Za-z][A-Za-z0-9]*\s*:\s*/gi, '');
  s = s.replace(/\bOnto:\s*/gi, '');
  s = s.replace(/\bStill(?:\s+territorial)?\s*:\s*/gi, '');
  s = s.replace(/\bHUECO\s*—\s*sin dato\s*:\s*/gi, `${gap}: `);
  s = s.replace(/\bHueco\s*:\s*/gi, `${gap}: `);
  s = s.replace(/\bgap_[a-z0-9_]+\b/gi, gap);
  s = s.replace(/\bguides\/[A-Za-z0-9_./#\-]+\.md\b/gi, '');
  s = s.replace(/\bgrid_-?\d+(?:\.\d+)?_-?\d+(?:\.\d+)?\b/gi, '');
  s = s.replace(/\bHecho\s+[a-z0-9_]+\s*:\s*/gi, '');
  if (lang !== 'en') s = s.replace(/\bTrade-off\b/g, 'Tensión');
  s = s.replace(/\bCiudad\s+Ciudad\s+/gi, 'Ciudad ');
  s = s.replace(/\bCONTEXT\b/g, lang === 'en' ? 'the portal' : 'el portal');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function stripMd(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function citizenTitle(title, lang = 'es') {
  let t = stripMd(scrubCitizenText(title, lang));
  t = t.replace(/^(Documento del acervo BCS 2050)\s*[—-]\s*acervo de datos$/i, '$1');
  if (lang !== 'en') {
    for (const [re, es] of EN_GUIDE_ES) {
      if (re.test(t)) return es;
    }
    const folded = fold(t);
    const spanish = /[áéíóúñ¿¡]|\b(de|del|la|el|los|las|en|con|para|agua|municipio|guía|guia)\b/.test(folded);
    const englishGuide = /\b(all|aquifers|deficits|snapshot|growth-pole|trade-off)\b/.test(folded);
    if (!spanish && englishGuide) return 'Guía del portal';
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

function themeLabel(theme, lang) {
  const key = fold(theme).replace(/\s+/g, '');
  if (!key || /acervo de datos|archivo\.json|guides\//.test(key)) return lang === 'en' ? 'Portal' : 'Portal';
  const pair = THEME_LABEL[key];
  if (pair) return lang === 'en' ? pair[1] : pair[0];
  const clean = citizenTitle(String(theme || ''), lang);
  if (!clean || /acervo de datos/i.test(clean)) return lang === 'en' ? 'Portal' : 'Portal';
  return clean;
}

function withUnit(metric, value) {
  const v = String(value || '').trim();
  const m = fold(metric);
  if (!v || /[a-z%]|hm/.test(fold(v))) return v;
  if (/^-?[\d.,]+$/.test(v)) {
    if (/hm3|hm³|disponibilidad|dma/.test(m)) return `${v} hm³/año`;
    if (/habitantes|poblaci/.test(m)) return `${v} habitantes`;
    if (/porcentaje|rezago/.test(m)) return v;
  }
  return v;
}

export function cleanFactRows(rows, lang = 'es') {
  const out = [];
  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const metric = citizenTitle(row[0], lang);
    let value = stripMd(scrubCitizenText(row[1], lang));
    const theme = themeLabel(row[2], lang);
    if (!metric || !value) continue;
    if (/^(gap_|fact:|onto:|grid_)/.test(fold(metric))) continue;
    if (/guides\/.+\.md/.test(metric + value)) continue;
    value = withUnit(metric, value);
    out.push([metric, value, theme]);
  }
  return out;
}

export function questionFocus(message) {
  const q = fold(message);
  const anp = /\b(anp|area natural|areas naturales|protegida|protegidas|conanp)\b/.test(q);
  const airport = /\b(aeropuerto|airport|\bsjd\b)\b/.test(q);
  const flood = /\b(inundaci|crecida|flood)\b/.test(q);
  const census = /\b(poblaci|habitantes|censo|personas)\b/.test(q) && /\b(municipio|cada|todos|estado|bcs|compar)\b/.test(q);
  return { anp, airport, flood, census, narrow: anp || airport || flood || census };
}

function blockText(b) {
  return fold([b?.title, b?.caption, b?.alt, b?.label, b?.source, b?.href, b?.thumb, b?.src].filter(Boolean).join(' '));
}

export function filterBlocks(message, blocks) {
  const focus = questionFocus(message);
  if (!focus.narrow) return blocks || [];
  return (blocks || []).filter((b) => {
    if (!b) return false;
    const hay = blockText(b);
    const off = /acuifer|energia|electric|cenace|prodesen|sibcs|desaladora|dma-|costa/.test(hay);
    if (focus.anp) {
      if (b.type === 'chart' && /acuifer|energia|habitantes/.test(hay)) return false;
      if (b.type === 'table' && /cifras del portal|figures from the portal/.test(hay)) return false;
      if ((b.type === 'map' || b.type === 'image') && off && !/anp|proteg|poer|parque|reserva/.test(hay)) return false;
      if (b.type === 'map' && /atlas territorial|open the 3d/.test(hay)) return false;
      return true;
    }
    if (focus.airport) {
      if (/dma|acuifer|pdu|psdu|energia|prodesen|desaladora/.test(hay) && !/aeropuerto|airport|sjd|san jose/.test(hay)) return false;
      if (b.type === 'map' && /atlas territorial|open the 3d/.test(hay)) return false;
      return true;
    }
    if (focus.flood) {
      if (/acuifer|energia|cenace|prodesen|poblaci|habitantes/.test(hay) && !/inund/.test(hay)) return false;
      if (b.type === 'map' && /atlas territorial|open the 3d/.test(hay)) return false;
      return true;
    }
    if (focus.census) {
      if (b.type === 'map' || b.type === 'image') return false;
      if (b.type === 'chart' && !/habitantes|poblaci|municipio/.test(hay)) return false;
      if (b.type === 'table' && /cifras del portal|figures from the portal/.test(hay)) return false;
      if (b.type === 'link' && /gemelo|foresights|crecimiento|studio/.test(hay)) return false;
      return true;
    }
    return true;
  });
}

export function asksPopulationByMunicipality(message) {
  const q = fold(message);
  return /\b(poblaci|habitantes|censo|personas|vive|viven)\b/.test(q)
    && /\b(municipio|cada|todos|estado|bcs|compar)\b/.test(q);
}

export function censusRowsFromChunks(chunks) {
  const re = /del municipio ([^()]+?) \(municipio completo[^)]*\):\s*([\d,]+) habitantes/;
  const rows = [];
  for (const c of chunks || []) {
    if (!c || c.type !== 'municipio' || /localidad/.test(c.path || '')) continue;
    const m = String(c.sum_es || '').match(re);
    if (!m) continue;
    const name = m[1].trim();
    if (rows.some((r) => r[0] === name)) continue;
    rows.push([name, m[2], 'INEGI Censo 2020']);
  }
  rows.sort((a, b) => Number(String(b[1]).replace(/,/g, '')) - Number(String(a[1]).replace(/,/g, '')));
  return rows;
}

export function populationTable(rows, lang = 'es') {
  const n = rows.length;
  const partial = n > 0 && n < 5;
  const title = partial
    ? (lang === 'en'
      ? `Population by municipality (partial: ${n} of 5)`
      : `Población por municipio (parcial: ${n} de 5)`)
    : (lang === 'en' ? 'Population by municipality (all 5)' : 'Población por municipio (los 5)');
  return {
    type: 'table',
    title,
    headers: lang === 'en' ? ['Municipality', 'Inhabitants', 'Source'] : ['Municipio', 'Habitantes', 'Fuente'],
    rows,
  };
}

function prependOnce(answer, sentence) {
  const a = String(answer || '').trim();
  const key = fold(sentence).slice(0, 48);
  if (key && fold(a).includes(key)) return a;
  return `${sentence.trim()}\n\n${a}`.trim();
}

function leadWithFigure(answer) {
  const lines = String(answer || '').split('\n');
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx < 0) return answer;
  const first = lines[firstIdx].trim();
  const decision = /^(\*\*)?(decisi[oó]n|qu[eé] puede decidir|what can .+ decide|trade-off|tensi[oó]n)\b/i.test(first)
    || (/^\*\*[^*]{8,}\*\*$/.test(first) && !/\d/.test(first));
  if (!decision || /\d/.test(first)) return answer;
  const rest = lines.slice(firstIdx + 1);
  const factIdx = rest.findIndex((l) => /\d/.test(l) && l.trim());
  if (factIdx < 0) return answer;
  const fact = rest.splice(factIdx, 1);
  return [...fact, '', first, ...rest].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function dropOffTopicSentences(answer, message) {
  const focus = questionFocus(message);
  if (!focus.narrow) return answer;
  const keep = (sentence) => {
    const s = fold(sentence);
    if (!s) return false;
    if (focus.anp) {
      if (/balandra/.test(s) && /la paz|no es|no pertenece|no incluye/.test(s)) return true;
      if (/\b(prodesen|cepal|acuifero|dma|energia electrica|distancia a la costa|hm3)\b/.test(s) && !/\b(anp|parque|reserva|proteg)\b/.test(s)) return false;
    }
    if (focus.airport && /\b(pdu|psdu|dma|acuifero|prodesen)\b/.test(s) && !/\b(aeropuerto|sjd|san jose|transpeninsular)\b/.test(s)) return false;
    if (focus.flood && /\b(acuifero|prodesen|cenace|poblacion)\b/.test(s) && !/inund/.test(s)) return false;
    if (focus.census && /\b(acuifero|dma|prodesen|cenace|anp)\b/.test(s) && !/\b(habitantes|poblaci|censo|inegi)\b/.test(s)) return false;
    return true;
  };
  return String(answer || '')
    .split('\n')
    .map((line) => {
      if (!line.trim() || /^👉/.test(line.trim())) return line;
      return line.split(/(?<=[.!?])\s+/).filter(keep).join(' ');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function polishAnswer(answer, message, lang = 'es') {
  const en = lang === 'en';
  let text = leadWithFigure(scrubCitizenText(answer, lang));
  text = dropOffTopicSentences(text, message);
  const q = fold(message);
  const loreto = /\bloreto\b/.test(q);
  const anp = questionFocus(message).anp;
  if (loreto && anp) {
    text = text.replace(/^.*\bBalandra\b.*$/gmi, (line) => (
      /\b(no|la paz|no es|no pertenece|no incluye)\b/.test(fold(line)) ? line : ''
    ));
    text = prependOnce(
      text,
      en
        ? 'In Loreto the portal lists Bahía de Loreto National Park, Loreto II National Park and Nopoló National Park. Balandra is in La Paz, not Loreto.'
        : 'En Loreto el portal registra el Parque Nacional Bahía de Loreto, el Parque Nacional Loreto II y el Parque Nacional Nopoló. Balandra es de La Paz, no de Loreto.'
    );
  }
  if (loreto && /\b(dma|acuifer|disponibilidad de agua|disponibilidad media)\b/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'CONAGUA names aquifer Loreto as key 0328 (mean annual availability 0.094632 hm³/year, DOF 9 Nov 2023). Santo Domingo (0306) is mostly Comondú, and San Juan B. Londó (0329) is not Loreto’s municipal DMA.'
        : 'CONAGUA nombra el acuífero Loreto con la clave 0328 (disponibilidad media anual 0.094632 hm³/año, DOF 9 nov 2023). Santo Domingo (0306) es sobre todo de Comondú, y San Juan B. Londó (0329) no es el DMA del municipio de Loreto.'
    );
  }
  if (/\b(aeropuerto|airport|\bsjd\b)\b/.test(q) && /\b(los cabos|sjd|san jose)\b/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'Los Cabos International Airport (SJD) is in San José del Cabo, on the Transpeninsular highway corridor.'
        : 'El aeropuerto de Los Cabos (SJD) está en San José del Cabo, sobre el corredor de la carretera Transpeninsular.'
    );
  }
  if (/todos santos/.test(q) && /\b(precio|vivienda|renta|costo|inmobiliari)\b/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'No local housing-price figure for Todos Santos. Any number below is a state or other-municipality figure, not a local price.'
        : 'Sin dato local de precio de vivienda en Todos Santos. Si aparece una cifra, es estatal o de otro municipio, no de esa localidad.'
    );
  }
  if (/la paz/.test(q) && /rezago/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'No municipal housing-backlog figure for La Paz. The CONAVI figure is for the state of Baja California Sur, not the municipality.'
        : 'Sin dato municipal de rezago habitacional en La Paz. La cifra de CONAVI es del estado de Baja California Sur, no del municipio.'
    );
  }
  if (/los cabos/.test(q) && /\b(gast\w*|egreso\w*|presupuesto\w*)\b/.test(q) && !/\bingresos?\b/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'No municipal expenditure figure for Los Cabos. The revenue law and the state expenditure budget are not the municipality’s spending, and a desalination plant does not answer this.'
        : 'Sin dato de egresos municipales de Los Cabos. La Ley de Ingresos y el egreso del gobierno del estado no son el gasto del municipio, y una desaladora no responde esta pregunta.'
    );
  }
  if (/\b(permiso|permisos|licencia|zofemat|mia)\b/.test(q) && /\b(costa|litoral|playa|zona federal|zofemat)\b/.test(q)) {
    text = prependOnce(
      text,
      en
        ? 'Coastal permits are framed by the federal maritime-terrestrial zone (ZOFEMAT), an environmental impact statement (MIA) and the municipal licence. PRODESEN and CEPAL do not describe that permit. If the portal lacks the local file, that gap stands.'
        : 'Los permisos de costa se enmarcan en la zona federal marítimo terrestre (ZOFEMAT), la manifestación de impacto ambiental (MIA) y la licencia municipal. PRODESEN y CEPAL no describen ese permiso. Si el portal no tiene el expediente local, ese dato falta.'
    );
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function sourceOffTopic(src, message) {
  const q = fold(message);
  const hay = fold(`${src?.title || ''} ${src?.outlet || ''} ${src?.path || ''}`);
  if (/rezago|vivienda/.test(q) && /bacheo|aeropuerto|\bdma\b|acuifer|desaladora/.test(hay)) return true;
  if (/los cabos/.test(q) && /gast|egreso|presupuesto/.test(q) && /desaladora/.test(hay)) return true;
  if (/permiso|licencia|zofemat/.test(q) && /costa|litoral|playa/.test(q) && /prodesen|cepal/.test(hay)) return true;
  if (questionFocus(message).anp && /prodesen|cepal/.test(hay) && !/anp|proteg|parque|reserva/.test(hay)) return true;
  return false;
}

function otherMuniNote(title, asked, lang) {
  const found = munisIn(title);
  if (!asked.length || !found.length) return '';
  if (found.some((m) => asked.includes(m))) return '';
  return lang === 'en'
    ? `Other municipality (${found[0]}) — this file does not replace the one for ${asked[0]}: `
    : `Otro municipio (${found[0]}) — no sustituye el documento de ${asked[0]}: `;
}

export function polishSources(sources, message, lang = 'es', media = null) {
  const asked = munisIn(message);
  const out = [];
  for (const raw of sources || []) {
    if (!raw) continue;
    if (sourceOffTopic(raw, message)) continue;
    const src = { ...raw };
    const stillId = (String(src.id || '').match(/S\d{4}/) || String(src.path || '').match(/S\d{4}/) || [])[0];
    const md = stillId && media?.stills ? media.stills[stillId] : null;
    if (src.type === 'still' || src.href === '/stills' || src.href === '/stills/') {
      const image = md?.image || md?.thumb || src.image || null;
      if (image) src.href = image;
      else delete src.href;
      src.type = src.type || 'still';
    }
    const note = otherMuniNote(src.title || '', asked, lang);
    src.title = note + citizenTitle(src.title || '', lang);
    if (/^Documento del acervo BCS 2050 — acervo de datos$/i.test(src.title)) {
      src.title = lang === 'en' ? 'Portal document' : 'Documento del portal';
    }
    if (src.theme_label) src.theme_label = themeLabel(src.theme_label, lang);
    out.push(src);
  }
  return out;
}

export function polishBlocks(message, lang, blocks) {
  const focus = questionFocus(message);
  return filterBlocks(message, blocks).map((b) => {
    if (!b || b.type !== 'table') return b;
    const title = String(b.title || '');
    if (/cifras del portal|figures from the portal/i.test(title)) {
      const rows = cleanFactRows(b.rows, lang);
      if (rows.length < 2) return null;
      return {
        ...b,
        title: lang === 'en' ? 'Figures from the portal' : 'Cifras del portal',
        headers: lang === 'en' ? ['Indicator', 'Value', 'Topic'] : ['Indicador', 'Valor', 'Tema'],
        rows,
      };
    }
    if (/poblaci[oó]n por municipio|population by municipality/i.test(title)) {
      const rows = b.rows || [];
      const partial = asksPopulationByMunicipality(message) && rows.length < 5;
      return {
        ...b,
        title: partial
          ? (lang === 'en'
            ? `Population by municipality (partial: ${rows.length} of 5)`
            : `Población por municipio (parcial: ${rows.length} de 5)`)
          : (rows.length >= 5
            ? (lang === 'en' ? 'Population by municipality (all 5)' : 'Población por municipio (los 5)')
            : title),
        headers: lang === 'en' ? ['Municipality', 'Inhabitants', 'Source'] : ['Municipio', 'Habitantes', 'Fuente'],
        rows: rows.map((r) => [String(r[0] || '').replace(/^Ciudad\s+Ciudad\s+/i, 'Ciudad '), r[1], r[2]]),
      };
    }
    return b;
  }).filter(Boolean);
}

export function polishOntology(nodes, lang = 'es') {
  return (nodes || []).map((n) => {
    const label = citizenTitle((lang === 'en' ? (n.label || n.label_es) : (n.label_es || n.label)) || '', lang);
    return {
      ...n,
      label: label || (lang === 'en' ? 'Relationship' : 'Relación'),
      label_es: citizenTitle(n.label_es || n.label || '', 'es') || 'Relación',
      kind: undefined,
    };
  }).filter((n) => n.label && !/^(ontology|onto|still|hueco)$/i.test(n.label));
}

export function polishPrimary(file, message, lang = 'es') {
  if (!file) return null;
  const note = otherMuniNote(file.title || '', munisIn(message), lang);
  return { ...file, title: note + citizenTitle(file.title || '', lang) };
}

const WELCOME = {
  es: ['¿En qué municipio y qué tema quieres consultar?', '¿Qué dato del portal quieres revisar?'],
  en: ['Which municipality and which topic should we look up?', 'What figure from the portal do you want to check?'],
};

export function welcomeFollowUps(lang = 'es') {
  return (lang === 'en' ? WELCOME.en : WELCOME.es).slice();
}

export function chipOffTopic(chip, message) {
  const topic = fold(message);
  const q = fold(chip);
  if (/rezago|vivienda|precio/.test(topic) && /\b(aeropuerto|dma|acuifer|bacheo|energia|electric)\b/.test(q) && !/vivienda|rezago|precio/.test(q)) return true;
  if (/\b(anp|protegida|protegidas)\b/.test(topic) && /\b(aeropuerto|dma|acuifer|energia|bacheo)\b/.test(q) && !/proteg|anp|parque|reserva/.test(q)) return true;
  if (/\b(aeropuerto|airport|sjd)\b/.test(topic) && /\b(dma|acuifer|pdu|rezago)\b/.test(q) && !/aeropuerto|sjd|san jose/.test(q)) return true;
  return false;
}

export function polishFollowUps(followUps, message, history, lang = 'es') {
  const asked = new Set([fold(message), ...(history || []).map((h) => fold(h?.content || h))]);
  const out = [];
  for (const raw of followUps || []) {
    let q = scrubCitizenText(raw, lang).replace(/\s+/g, ' ').trim();
    q = q.replace(/^👉\s*/, '');
    if (!q || chipOffTopic(q, message)) continue;
    const key = fold(q);
    if (asked.has(key) || out.some((x) => fold(x) === key)) continue;
    if (/\bcontext\b|\bcontexto\b/.test(key) && key.length < 12) continue;
    out.push(q);
    if (out.length >= 3) break;
  }
  if (!out.length) return welcomeFollowUps(lang);
  return out;
}

export function polishCitizenBundle({
  answer, sources, blocks, followUps, ontology, primary, message, lang, history, media,
} = {}) {
  const L = lang === 'en' ? 'en' : 'es';
  return {
    answer: polishAnswer(answer, message, L),
    sources: polishSources(sources, message, L, media),
    blocks: polishBlocks(message, L, blocks),
    followUps: polishFollowUps(followUps, message, history, L),
    ontology: polishOntology(ontology, L),
    primary: polishPrimary(primary, message, L),
  };
}
