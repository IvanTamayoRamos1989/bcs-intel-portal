/**
 * Citizen-facing chat polish. No network. Does not run the retrieval gate.
 * Run: node scripts/eval/citizen_answer_check.mjs
 */
import { readFileSync } from 'node:fs';
import {
  scrubCitizenText,
  citizenTitle,
  cleanFactRows,
  polishCitizenBundle,
  polishFollowUps,
  censusRowsFromChunks,
  populationTable,
  filterBlocks,
  welcomeFollowUps,
} from '../../netlify/lib/citizen_answer.mjs';
import { buildFollowUps } from '../../netlify/functions/chat.mjs';
import corpus from '../../netlify/functions/chat_corpus.json' with { type: 'json' };

const fails = [];
function check(name, cond) {
  if (!cond) fails.push(name);
  else console.log('ok', name);
}

const dirty = 'Ontology Evidence: gap_loreto_dma en guides/agua.md y grid_23.500_-109.460. Onto: Still territorial: Hueco: nivel. Hecho turismo: Trade-off. Ciudad Ciudad Constitución.';
const clean = scrubCitizenText(dirty, 'es');
check('strips ontology, gap id, guide path and grid', !/Ontology|gap_|guides\/|grid_23/.test(clean));
check('plain missing-data label', /Dato faltante/.test(clean));
check('spanish tension word', /Tensión/.test(clean) && !/Trade-off/.test(clean));
check('ciudad not doubled', /Ciudad Constitución/.test(clean) && !/Ciudad Ciudad/.test(clean));

check('english guide title hidden in spanish', citizenTitle('All BCS aquifers in the state', 'es') === 'Acuíferos de Baja California Sur');
check('growth-pole title translated', /Déficit de agua/.test(citizenTitle('Growth-pole DMA deficits (portal)', 'es')));
check('markdown stripped from a source title', citizenTitle('**POEL** `Loreto`', 'es') === 'POEL Loreto');

const rows = cleanFactRows([
  ['gap_loreto_dma', '1', 'acervo de datos'],
  ['Valor — Rezago habitacional BCS', '58,987 viv. (21.4%)', 'acervo de datos'],
  ['Habitantes', '798447', 'territorio'],
], 'es');
check('internal fact key dropped', rows.every((r) => !/gap_/.test(r[0])));
check('tema is not acervo de datos', rows.every((r) => r[2] !== 'acervo de datos'));
check('habitants carry a unit', rows.some((r) => /habitantes/.test(r[1])));
check('spanish column topic', rows.some((r) => r[2] === 'Territorio'));

const census = censusRowsFromChunks(corpus);
check('five municipality population rows', census.length === 5);
const table = populationTable(census, 'es');
check('population table names all five', /los 5/.test(table.title) && table.rows.length === 5);
check('partial population title', /parcial: 2 de 5/.test(populationTable(census.slice(0, 2), 'es').title));

const blocks = filterBlocks('¿Qué ANP hay en Loreto?', [
  { type: 'chart', title: 'Disponibilidad media de agua por acuífero' },
  { type: 'map', title: 'POER UGAs', href: '/maps/poer-ugas-56.jpg' },
  { type: 'map', title: 'Abrir el atlas territorial 3D', href: '/explorar' },
]);
check('ANP question drops aquifer chart and generic atlas', blocks.length === 1 && /POER/.test(blocks[0].title));

const loreto = polishCitizenBundle({
  answer: 'Incluye Balandra y el acuífero Santo Domingo 0306.',
  message: '¿Qué áreas naturales protegidas hay en Loreto?',
  lang: 'es',
  sources: [{ type: 'still', id: 'still:S0002', title: 'Still territorial: Loreto', href: '/stills', path: 'stills/S0002' }],
  blocks: [],
  followUps: ['¿Y el aeropuerto?', '¿Y el aeropuerto?'],
  ontology: [{ label: 'Ontology Evidence: núcleo', label_es: 'Núcleo del parque' }],
  history: [],
  media: { stills: { S0002: { image: '/stills/batch_01/full/S0002_loreto.jpg', thumb: '/stills/batch_01/thumbs/S0002_loreto.jpg' } } },
});
check('Loreto ANP lead names Bahía de Loreto and not Balandra as Loreto', /Bahía de Loreto/.test(loreto.answer) && /Balandra es de La Paz/.test(loreto.answer));
check('still chip uses the image url', loreto.sources[0].href === '/stills/batch_01/full/S0002_loreto.jpg');
check('ontology chip has a citizen name', loreto.ontology[0].label_es === 'Núcleo del parque');
check('repeated airport chip dropped for an ANP question', loreto.followUps.every((q) => !/aeropuerto/i.test(q)));

const dma = polishCitizenBundle({
  answer: 'El DMA de Loreto es Santo Domingo 0306 y Londó 0329.',
  message: '¿Cuál es el DMA de Loreto?',
  lang: 'es', sources: [], blocks: [], followUps: [], ontology: [], history: [],
});
check('Loreto DMA cites aquifer 0328 and refuses 0306 as the municipal DMA', /0328/.test(dma.answer) && /0\.094632/.test(dma.answer) && /no es el DMA del municipio de Loreto/.test(dma.answer));

const house = polishCitizenBundle({
  answer: 'El promedio estatal es 2 millones.',
  message: '¿Cuál es el precio de la vivienda en Todos Santos?',
  lang: 'es', sources: [], blocks: [], followUps: [], ontology: [], history: [],
});
check('local housing gap leads', /^Sin dato local/.test(house.answer));

const rezago = polishCitizenBundle({
  answer: 'CONAVI reporta 58,987 viviendas.',
  message: '¿Cuál es el rezago habitacional en La Paz?',
  lang: 'es',
  sources: [{ title: 'Noticia: bacheo en La Paz', type: 'news', href: 'https://example.test' }],
  blocks: [],
  followUps: ['¿Y el aeropuerto de La Paz?', '¿Qué falta del rezago en La Paz?'],
  ontology: [], history: [],
});
check('rezago says the municipal figure is missing', /Sin dato municipal/.test(rezago.answer));
check('bacheo source dropped', rezago.sources.length === 0);
check('rezago follow-up stays off the airport', rezago.followUps.every((q) => !/aeropuerto/i.test(q)));

const spend = polishCitizenBundle({
  answer: 'La Ley de Ingresos 2026 y el egreso estatal.',
  message: '¿Cuánto gasta el municipio de Los Cabos?',
  lang: 'es', sources: [{ title: 'Desaladora APP 2020', href: '/x' }], blocks: [], followUps: [], ontology: [], history: [],
});
check('spend leads with the municipal gap', /^Sin dato de egresos municipales/.test(spend.answer));
check('desalination source dropped from a spend question', spend.sources.length === 0);

const permit = polishCitizenBundle({
  answer: 'Según PRODESEN y CEPAL hay energía.',
  message: '¿Qué permisos necesito en la costa de La Paz?',
  lang: 'es', sources: [{ title: 'PRODESEN SIBCS', href: '/p' }], blocks: [], followUps: [], ontology: [], history: [],
});
check('coastal permits lead with ZOFEMAT', /^Los permisos de costa/.test(permit.answer) && /ZOFEMAT/.test(permit.answer));
check('PRODESEN source dropped for a permit question', permit.sources.length === 0);

const air = polishCitizenBundle({
  answer: 'El PDU de Los Cabos y el DMA condicionan el predio.',
  message: '¿Dónde está el aeropuerto de Los Cabos?',
  lang: 'es', sources: [], blocks: [], followUps: [], ontology: [], history: [],
});
check('airport leads with San José del Cabo', /^El aeropuerto de Los Cabos \(SJD\) está en San José del Cabo/.test(air.answer));

const pdf = polishCitizenBundle({
  answer: 'Aquí está el plan.',
  message: '¿Dónde está el POEL de Loreto?',
  lang: 'es',
  sources: [{ title: 'POEL La Paz 2018', href: '/x', type: 'file' }],
  blocks: [], followUps: [], ontology: [], history: [],
});
check('other municipality file is labeled as such', /Otro municipio \(La Paz\)/.test(pdf.sources[0].title));

const hello = buildFollowUps({ message: 'hola', lang: 'es', history: [{ role: 'user', content: '¿Cuánta agua hay en La Paz?' }], evidence: [] });
check('unknown turn does not keep the previous place', hello.every((q) => !/La Paz|agua|CONTEXT/i.test(q)));
check('welcome chips exist', welcomeFollowUps('es').length === 2);

const again = polishFollowUps(
  ['¿Qué capacidad de agua hay en La Paz?', '¿Qué capacidad de agua hay en La Paz?', 'CONTEXT'],
  '¿Cuánta agua hay en La Paz?',
  [],
  'es',
);
check('follow-ups are not repeated', new Set(again.map((q) => q.toLowerCase())).size === again.length);

if (fails.length) {
  console.error('FAILED', fails);
  process.exit(1);
}
console.log('citizen answer polish ok');
