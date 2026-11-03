const decree = 'https://finanzas.bcs.gob.mx/wp-content/themes/voice/assets/images/armonizacion_contable/cumpl_V/anual/2026/02.%20Presupuesto%20de%20Egresos%20para%20el%20Ejercicio%202026.pdf';
const report = 'https://finanzas.bcs.gob.mx/wp-content/themes/voice/assets/images/armonizacion_contable/ley_dici_finan/2026/3ertrim/F6C%20Egresos%20Detallado%20-LDF%20(C.Funcional)%20T3%202026.pdf';

// F6C, pp. 1–2. Combine unrestricted and earmarked appropriations by function.
const headings = [
  ['Gobierno', 'Government', 4193654835, 510847557],
  ['Desarrollo social', 'Social development', 4120546749, 9987428124],
  ['Desarrollo económico', 'Economic development', 604030403, 62212733],
  ['Otras funciones', 'Other functions', 6199776709, 1224543035],
];

export function stateBudgetOverview(message, lang) {
  const q = String(message).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\bclaifornia\b/g, 'california');
  if (!/\b(budget|presupuesto|egresos)\b/.test(q) ||
      !/\b(bcs|baja california sur|state budget|state government|presupuesto estatal|presupuesto del estado)\b/.test(q)) return null;
  // Handle an overview only. A municipal, historical, project or sector question belongs in retrieval.
  if (/\bbaja california\b(?! sur\b)/.test(q)) return null;
  const remaining = q.replace(/\b(2026|baja california sur|bcs|statewide|state|government|budget|public|spending|expenditure|expenditures|approved|total|annual|fiscal|year|current|latest|overview|breakdown|detail|details|detailed|explain|give|tell|show|me|a|an|the|how|much|what|is|was|of|for|in|and|please|presupuesto|egresos|gasto|publico|estatal|estado|gobierno|aprobado|anual|actual|ejercicio|explica|explicame|desglosa|desglose|detalle|detallado|dame|cual|cuanto|es|fue|de|del|en|el|la|los|las|un|al|para|y|por|favor)\b/g,'').replace(/[\s¿?¡!.,:;()-]/g,'');
  if (remaining) return null;

  const en = lang === 'en';
  const lines = headings.map(([es,english,a,b]) => '- ' + (en ? english : es) + ': **' + (a+b).toLocaleString('en-US') + ' MXN**');
  const answer = [
    en ? 'Baja California Sur approved **26,903,040,145 MXN** for fiscal year **2026** (Decree 3266).' :
      'Baja California Sur aprobó **26,903,040,145 MXN** para el ejercicio **2026** (Decreto 3266).',
    (en ? 'Annual budget by purpose, combining earmarked and unrestricted funds:' : 'Presupuesto anual aprobado por finalidad, sumando gasto etiquetado y no etiquetado:')+'\n'+lines.join('\n'),
    en ? 'Social development is the largest category. It includes education and health. Other functions include transfers between levels of government and the financial cost of debt.' :
      'Desarrollo social es la categoría más grande e incluye educación y salud. Otras funciones incluyen transferencias entre órdenes de gobierno y el costo financiero de la deuda.',
    en ? 'By **September 30, 2026**, the revised annual budget was **28,537,686,690 MXN**. The state had recognized **19,849,997,508 MXN** in spending obligations and paid **19,168,131,266 MXN** (third-quarter F6C report, pp. 1–2).' :
      'Al **30 de septiembre de 2026**, el presupuesto anual modificado era de **28,537,686,690 MXN**. El estado había reconocido obligaciones por **19,849,997,508 MXN** (devengado) y pagado **19,168,131,266 MXN** (informe F6C del tercer trimestre, pp. 1–2).',
  ].join('\n\n');
  return {answer,grounded:true,mode:'official_budget',sources:[
    {title:en?'State expenditure budget 2026 · Decree 3266':'Presupuesto estatal de egresos 2026 · Decreto 3266',drive_url:decree,path:'finanzas/decreto-3266',type:'file'},
    {title:en?'State spending by function · January–September 2026':'Gasto estatal por finalidad · enero–septiembre de 2026',drive_url:report,path:'finanzas/f6c-t3-2026',type:'file'},
  ],blocks:[],followUps:[]};
}

