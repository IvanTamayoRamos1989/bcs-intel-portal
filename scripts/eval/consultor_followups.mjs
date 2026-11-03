/**
 * Consultant follow-ups stay on the thread. No network, no new figures.
 * Run: node scripts/eval/consultor_followups.mjs
 */
import {
  buildFollowUps,
  composeRetrieveQuery,
  isThreadFollowUp,
  groundedPrompt,
  followUpStaysOnThread,
  consultThreadNote,
} from '../../netlify/functions/chat.mjs';

const fails = [];
function check(name, cond) {
  if (!cond) fails.push(name);
  else console.log('ok', name);
}

const water = '¿Cuánta agua hay en La Paz?';
const histWater = [{ role: 'user', content: water }, { role: 'assistant', content: 'El acuífero de La Paz está presionado.' }];

const chips = buildFollowUps({ message: water, lang: 'es', history: [], evidence: [] });
check('water chip stays on water and La Paz', chips.some((q) => /agua/i.test(q) && /La Paz/.test(q)));
check('water chip is not a population or photo menu', chips.every((q) => !/poblaci|fotos aereas|electricidad del estado|cada municipio/i.test(q)));

const loreto = buildFollowUps({ message: '¿y Loreto?', lang: 'es', history: histWater, evidence: [] });
check('follow-up keeps water and switches to Loreto', loreto.some((q) => /agua/i.test(q) && /Loreto/.test(q)));
check('Loreto follow-up does not open a stock menu', loreto.every((q) => !/fotos|electricidad del estado|cada municipio/i.test(q)));

const both = buildFollowUps({
  message: 'compara el agua de La Paz y Los Cabos',
  lang: 'es',
  history: [],
  evidence: [],
});
check('compare stays on water and the two named municipalities', both.some((q) => /agua/i.test(q) && /La Paz/.test(q) && /Los Cabos/.test(q)));

const evidence = [
  { type: 'ontology', onto_id: 'cap_agua_lp', onto_type: 'ResourceCapacity', title: 'Capacidad: acuífero de La Paz' },
  { type: 'ontology', onto_id: 'con_sequia_lp', onto_type: 'Constraint', title: 'Restricción: sequía en La Paz' },
  { type: 'ontology', onto_id: 'actor_conagua', onto_type: 'Actor', title: 'Actor: CONAGUA' },
  { type: 'ontology', onto_id: 'gap_renta_hotel', onto_type: 'Evidence', title: 'Hueco: renta hotelera' },
];
const rich = buildFollowUps({ message: water, lang: 'es', history: [], evidence });
check('trade-off names retrieved cards', rich.some((q) => /acuífero de La Paz/.test(q) && /sequía en La Paz/.test(q)));
check('gap chip asks who covers the hole, not for the missing number', rich.some((q) => /renta hotelera/.test(q) && /sin dato/.test(q) && !/cu[aá]nt/i.test(q)));
check('chips invent no three-digit figure', rich.every((q) => !/\d{3,}/.test(q)));

const greet = buildFollowUps({ message: 'hola', lang: 'es', history: [], evidence: [] });
check('greeting does not jump to a stock topic', greet.every((q) => !/agua|poblaci|electric|fotos|Los Cabos|Loreto/i.test(q)));

const en = buildFollowUps({ message: 'How much water is available in La Paz?', lang: 'en', history: [], evidence: [] });
check('english chip stays on water in La Paz', en.some((q) => /water/i.test(q) && /La Paz/.test(q)));

check('short place follow-up is detected', isThreadFollowUp('¿y Loreto?', histWater));
check('a full new question is not a follow-up', !isThreadFollowUp('¿Cuánta agua hay en Loreto?', histWater));
check('a statewide question does not inherit the thread place', !isThreadFollowUp('¿Cuánta agua hay en el estado?', histWater));
const qLoreto = composeRetrieveQuery('¿y Loreto?', histWater);
check('retrieve query keeps the water theme and Loreto', /agua/i.test(qLoreto) && /Loreto/.test(qLoreto));
const qPlan = composeRetrieveQuery('¿qué dice el plan urbano?', histWater);
check('new theme keeps the place and drops the old theme', /La Paz/.test(qPlan) && /plan urbano/i.test(qPlan) && !/agua/i.test(qPlan));
const qWho = composeRetrieveQuery('¿quién decide?', histWater);
check('bare follow-up keeps the prior question', /agua/i.test(qWho) && /La Paz/.test(qWho));

check('stock electricity question is off a water thread', !followUpStaysOnThread('¿De dónde viene la electricidad del estado?', water, []));
check('same-theme question stays', followUpStaysOnThread(chips[0], water, []));
check('a new municipality is off-thread', !followUpStaysOnThread('Compara La Paz con Mulegé', water, []));

const note = consultThreadNote('es', { message: '¿y Loreto?', history: histWater, placeLabel: 'Loreto' });
check('thread note names Loreto and water', /Loreto/.test(note) && /agua/.test(note));
const prompt = groundedPrompt('es', '(fragmento)', { threadNote: note });
check('prompt is a consultant and carries the thread', /consultor de la consulta ciudadana/.test(prompt) && /HILO:/.test(prompt) && /Dato faltante:/.test(prompt));
check('prompt no longer prescribes the stock menu as the default close', !/invitando a seguir explorando un tema/.test(prompt));
const promptEn = groundedPrompt('en', '(fragment)', { noEvidence: true });
check('empty context does not invent a figure', /invent no figure/.test(promptEn));

if (fails.length) {
  console.error('FAILED', fails);
  process.exit(1);
}
console.log('consultor follow-ups ok');
