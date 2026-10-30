/* Glossary tooltips (citizen UX): marks the first appearance of each technical acronym inside <main>
   with an ⓘ and a plain-language definition (ES/EN follows the portal language toggle). */
(function () {
  'use strict';
  var G = {
    'DMA': ['Disponibilidad media anual de agua: el volumen de agua que se puede extraer de un acuífero cada año sin agotarlo, según el cálculo oficial de CONAGUA.', 'Mean annual water availability: the volume that can be drawn from an aquifer each year without depleting it, per CONAGUA\u2019s official method.'],
    'SIBCS': ['Sistema Interconectado Baja California Sur: la red eléctrica del sur del estado, que no está conectada a la red nacional.', 'Baja California Sur Interconnected System: the power grid of the southern state, not connected to the national grid.'],
    'UGA': ['Unidad de gestión ambiental: zona del ordenamiento ecológico con reglas propias sobre qué usos del suelo son compatibles.', 'Environmental management unit: a zone in the ecological land-use plan with its own rules on compatible uses.'],
    'POEL': ['Programa de ordenamiento ecológico local: instrumento municipal que define dónde y cómo se puede usar el territorio para proteger el ambiente.', 'Local ecological land-use programme: municipal instrument that defines where and how land may be used to protect the environment.'],
    'PDU': ['Programa (o plan) de desarrollo urbano: instrumento que ordena el crecimiento de una ciudad: usos del suelo, densidades y vialidades.', 'Urban development programme (or plan): instrument that guides a city\u2019s growth: land uses, densities and roads.'],
    'ANP': ['Área natural protegida: zona decretada por el gobierno para conservar su naturaleza, con reglas de uso.', 'Protected natural area: a zone decreed by the government to conserve nature, with use rules.'],
    'PTAR': ['Planta de tratamiento de aguas residuales: instalación que limpia el agua usada para poder reutilizarla o devolverla al ambiente.', 'Wastewater treatment plant: a facility that cleans used water so it can be reused or returned to the environment.'],
    'APP': ['Asociación público-privada: contrato en el que gobierno y empresas privadas comparten la inversión y la operación de una obra o servicio.', 'Public-private partnership: a contract in which government and private firms share the investment in and operation of a project or service.'],
    'NOM-011': ['Norma oficial mexicana NOM-011-CONAGUA: establece el método oficial para calcular cuánta agua hay disponible en acuíferos y cuencas.', 'Mexican official standard NOM-011-CONAGUA: sets the official method to calculate how much water is available in aquifers and basins.']
  };
  var keys = Object.keys(G).sort(function (a, b) { return b.length - a.length; });
  var re = new RegExp('(^|[^A-Za-z0-9\\u00C0-\\u017F-])(' + keys.map(function (k) { return k.replace(/-/g, '\\-'); }).join('|') + ')(?![A-Za-z0-9\\u00C0-\\u017F])');
  var SKIP = { A: 1, SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, ABBR: 1, BUTTON: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, SVG: 1, H1: 1, LABEL: 1 };
  function lang() { return document.documentElement.getAttribute('data-lang') === 'en' ? 1 : 0; }
  function run() {
    var root = document.querySelector('main'); if (!root) return;
    var done = {};
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var p = n.parentNode; p && p !== root; p = p.parentNode) {
          if (SKIP[p.nodeName.toUpperCase()] || (p.classList && (p.classList.contains('bcs-chat') || p.classList.contains('gl-term')))) return NodeFilter.FILTER_REJECT;
          if (p.id === 'bcs-chat' || p.id === 'gis-map') return NodeFilter.FILTER_REJECT;
        }
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var m = n.nodeValue.match(re); if (!m) return;
      var k = m[2]; if (done[k]) return; done[k] = 1;
      var start = m.index + m[1].length;
      var after = n.splitText(start); after.nodeValue = after.nodeValue.slice(k.length);
      var abbr = document.createElement('abbr');
      abbr.className = 'gl-term'; abbr.tabIndex = 0;
      abbr.setAttribute('data-gl', k);
      abbr.title = G[k][lang()];
      abbr.textContent = k;
      var i = document.createElement('span'); i.className = 'gl-i'; i.setAttribute('aria-hidden', 'true'); i.textContent = '\u24D8';
      abbr.appendChild(i);
      n.parentNode.insertBefore(abbr, after);
    });
  }
  function relabel() {
    document.querySelectorAll('abbr.gl-term[data-gl]').forEach(function (a) { var d = G[a.getAttribute('data-gl')]; if (d) a.title = d[lang()]; });
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('abbr.gl-term');
    document.querySelectorAll('.gl-pop').forEach(function (p) { p.remove(); });
    if (!a) return;
    var p = document.createElement('span'); p.className = 'gl-pop'; p.setAttribute('role', 'tooltip'); p.textContent = a.title;
    a.appendChild(p);
  });
  document.addEventListener('bcs:lang', relabel);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.BCSGlossary = { terms: G, run: run };
})();
