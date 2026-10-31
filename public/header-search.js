/**
 * Drive-style header search — pages + catalog files + folders.
 * Lazy-loads /catalog_slim.json on first focus/type. Debounced.
 */
(function () {
  var DEBOUNCE_MS = 180;
  var MAX_PAGES = 6;
  var MAX_FOLDERS = 5;
  var MAX_FILES = 10;
  var catalog = null;
  var catalogLoading = null;
  var folders = null;
  var foldersLoading = null;
  var timer = null;
  var activeIdx = -1;

  var PAGES = [
    { href: '/resumen', es: 'Resumen', en: 'Summary', blurb_es: 'Tablero de cifras clave BCS', blurb_en: 'BCS key-figure dashboard' },
    { href: '/gemelo', es: 'Gemelo territorial', en: 'Territorial twin', blurb_es: 'Mapa, cifras y escenarios por tema', blurb_en: 'Map, figures and scenarios by theme', boost: 52 },
    { href: '/aprendizaje', es: 'Aprender de otras ciudades', en: 'Learn from other cities', blurb_es: 'Casos externos · sin cifras de BCS', blurb_en: 'External cases · no BCS figures', boost: 46 },
    { href: '/coordinacion', es: 'Coordinación de proyectos', en: 'Project coordination', blurb_es: 'Institución, obra y sexenio · inventario federal', blurb_en: 'Institution, work and administration · federal inventory', boost: 44 },
    { href: '/foresights', es: 'Prospectiva', en: 'Foresights', blurb_es: 'Vocaciones de lugar · señales semanales BCS 2050', blurb_en: 'Place vocations · weekly BCS 2050 signals', boost: 45 },
    { href: '/crecimiento', es: 'Crecimiento: demanda y oferta', en: 'Growth: demand and supply', blurb_es: 'Presión frente a capacidad por vocación', blurb_en: 'Pressure vs capacity scorecard by vocation', boost: 44 },
    { href: '/inicio', es: 'Inicio', en: 'Home', blurb_es: 'Inicio del portal · temas y datos', blurb_en: 'Portal home · topics and data' },
    { href: '/explorar', es: 'Explorar · atlas 3D', en: 'Explore · 3D atlas', blurb_es: 'Atlas territorial 3D: capas, inventario y fuentes', blurb_en: '3D territorial atlas: layers, inventory and sources' },
    { href: '/catalogo', es: 'Catálogo de datos', en: 'Data catalog', blurb_es: 'Inventario y descargas · subir contribución', blurb_en: 'Inventory and Drive downloads · upload contribution' },
    { href: '/mapas', es: 'Mapas', en: 'Maps', blurb_es: 'Mapa interactivo GIS + galería por tema', blurb_en: 'Interactive GIS map + gallery by theme', boost: 50 },
    { href: '/stills', es: 'Fotos del territorio', en: 'Territory photos', blurb_es: 'Fotos en el mapa', blurb_en: 'Photos on the map' },
    { href: '/territorio', es: 'Territorio', en: 'Territory', blurb_es: 'Geografía, municipios, demografía', blurb_en: 'Geography, municipalities, demographics' },
    { href: '/planeacion', es: 'Planeación', en: 'Planning', blurb_es: 'POER, PDU, POEL, instrumentos', blurb_en: 'POER, PDU, POEL, instruments' },
    { href: '/agua', es: 'Agua', en: 'Water', blurb_es: 'DMA, CONAGUA, desalación', blurb_en: 'DMA, CONAGUA, desalination' },
    { href: '/energia', es: 'Energía', en: 'Energy', blurb_es: 'SIBCS, generación, renovables', blurb_en: 'SIBCS, generation, renewables' },
    { href: '/ambiente', es: 'Ambiente', en: 'Environment', blurb_es: 'ANP, costa, residuos', blurb_en: 'Protected areas, coast, waste' },
    { href: '/conectividad', es: 'Conectividad', en: 'Connectivity', blurb_es: 'Carreteras, puertos, aeropuertos', blurb_en: 'Roads, ports, airports' },
    { href: '/riesgos', es: 'Riesgos', en: 'Hazards', blurb_es: 'Amenazas, tenencia, sismos', blurb_en: 'Hazards, tenure, seismic' },
    { href: '/economia', es: 'Economía', en: 'Economy', blurb_es: 'Inversión, empleo, sectores', blurb_en: 'Investment, jobs, sectors' },
    { href: '/comunidades', es: 'Comunidades', en: 'Communities', blurb_es: 'Localidades y perfiles municipales', blurb_en: 'Localities and municipal profiles' },
    { href: '/turismo', es: 'Turismo', en: 'Tourism', blurb_es: 'Oferta y destinos', blurb_en: 'Offer and destinations' },
    { href: '/inmobiliario', es: 'Inmobiliario', en: 'Real estate', blurb_es: 'Mercado residencial y reportes', blurb_en: 'Market reports' },
    { href: '/catastro', es: 'Catastro', en: 'Cadastre', blurb_es: 'IMPLAN y catastro municipal', blurb_en: 'IMPLAN and municipal cadastre' },
    { href: '/puertos', es: 'Puertos', en: 'Ports', blurb_es: 'Puertos y demanda', blurb_en: 'Ports and demand' },
    { href: '/vuelos', es: 'Conectividad aérea · vuelos', en: 'Air connectivity · flights', blurb_es: 'Destinos sin escalas SJD LAP LTO · FlightConnections', blurb_en: 'Non-stop destinations SJD LAP LTO · FlightConnections', boost: 40 },
    { href: '/fiscal', es: 'Finanzas públicas', en: 'Public finance', blurb_es: 'Ingresos y finanzas públicas', blurb_en: 'Revenue and public finance' },
    { href: '/earth-studio', es: 'Fotos del territorio (vistas satelitales)', en: 'Territory photos (satellite views)', blurb_es: 'Secuencias y carpetas satelitales', blurb_en: 'Sequences and satellite folders' },
    { href: '/studio/los_cabos', es: 'Municipio · Los Cabos', en: 'Municipality · Los Cabos', blurb_es: 'Ficha municipal', blurb_en: 'Municipal dossier hub', boost: 42 },
    { href: '/studio/la_paz', es: 'Municipio · La Paz', en: 'Municipality · La Paz', blurb_es: 'Ficha municipal', blurb_en: 'Municipal dossier hub', boost: 40 },
    { href: '/proyectos-federales', es: 'Proyectos federales', en: 'Federal projects', blurb_es: 'Inventario 44 proyectos', blurb_en: 'Inventory of 44 projects', boost: 48 },
    { href: '/ontologia', es: 'Mapa de relaciones', en: 'Relationship map', blurb_es: 'Lugares, proyectos y actores conectados', blurb_en: 'Programme entities and relations' },
    { href: '/stakeholders', es: 'Actores', en: 'Stakeholders', blurb_es: 'Directorio interno de contactos', blurb_en: 'Internal contacts directory' },
    { href: '/historia', es: 'Historia', en: 'History', blurb_es: 'Cronología y narrativas locales', blurb_en: 'Timeline and local narratives' },
    { href: '/planes-archivo', es: 'Archivo de planes', en: 'Plans archive', blurb_es: 'Instrumentos archivados', blurb_en: 'Archived instruments' },
    { href: '/studio', es: 'Municipios', en: 'Municipalities', blurb_es: 'Una ficha por municipio y una del estado', blurb_en: 'One page per municipality plus the state' },
    { href: '/agua/escorrentia', es: 'Escorrentía y agua de lluvia', en: 'Runoff and rainwater', blurb_es: 'Por dónde corre el agua de lluvia (modelo)', blurb_en: 'Where rainwater flows (model)' },
    { href: '/biblioteca', es: 'Biblioteca', en: 'Library', blurb_es: 'Referencias de planeación, agua, costa, transporte y finanzas', blurb_en: 'References on planning, water, coast, transport and finance' },
    { href: '/preguntas', es: 'Preguntas estratégicas', en: 'Strategic questions', blurb_es: 'Lo que hay que decidir y con qué evidencia', blurb_en: 'What must be decided and on what evidence' },
    { href: '/sesion', es: 'Sesión de estrategia', en: 'Strategy session', blurb_es: 'Vista para reuniones de estrategia', blurb_en: 'View for strategy meetings' },
    { href: '/memoria', es: 'Consultas al asistente', en: 'Assistant queries', blurb_es: 'Preguntas recientes y vacíos de información', blurb_en: 'Recent questions and information gaps' },
    { href: '/temas', es: 'Temas', en: 'Topics', blurb_es: 'Todo el portal en seis temas', blurb_en: 'The whole portal in six topics', boost: 30 },
    { href: '/ayuda', es: 'Ayuda y fuentes', en: 'Help and sources', blurb_es: 'Cómo moverse, preguntar y de dónde vienen los datos', blurb_en: 'Getting around, asking and data sources' },
    { href: '/noticias', es: 'Noticias', en: 'News', blurb_es: 'Notas BCS agua, energía, turismo, planeación', blurb_en: 'BCS water, energy, tourism, planning notes' },
  ];

  function lang() {
    return document.documentElement.getAttribute('data-lang') || 'es';
  }

  function t(key) {
    var ui = window.__BCS_UI__ || {};
    var L = ui[lang()] || ui.es || {};
    return L[key] || key;
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function tokens(q) {
    return norm(q).split(/\s+/).filter(Boolean);
  }

  function matchAll(hay, toks) {
    var h = norm(hay);
    for (var i = 0; i < toks.length; i++) {
      if (h.indexOf(toks[i]) === -1) return false;
    }
    return true;
  }

  function score(hay, toks) {
    var h = norm(hay);
    var s = 0;
    for (var i = 0; i < toks.length; i++) {
      var idx = h.indexOf(toks[i]);
      if (idx === 0) s += 40;
      else if (idx > 0) s += 20;
      else return -1;
      if (h === toks[i]) s += 30;
    }
    return s;
  }

  function ensureCatalog() {
    if (catalog) return Promise.resolve(catalog);
    if (catalogLoading) return catalogLoading;
    catalogLoading = fetch('/catalog_slim.json')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        catalog = Array.isArray(data) ? data : [];
        catalogLoading = null;
        return catalog;
      })
      .catch(function () {
        catalog = [];
        catalogLoading = null;
        return catalog;
      });
    return catalogLoading;
  }

  function ensureFolders() {
    if (folders) return Promise.resolve(folders);
    if (foldersLoading) return foldersLoading;
    foldersLoading = fetch('/search_folders.json')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var list = (data.folders || []).concat(data.ti || []);
        folders = list;
        foldersLoading = null;
        return folders;
      })
      .catch(function () {
        folders = [];
        foldersLoading = null;
        return folders;
      });
    return foldersLoading;
  }


  /* PASS3_SEARCH_INDEX */
  var searchIndex = null;
  var searchIndexLoading = null;
  function ensureSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchIndexLoading) return searchIndexLoading;
    searchIndexLoading = fetch('/search_index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        searchIndex = (data && data.items) || [];
        searchIndexLoading = null;
        return searchIndex;
      })
      .catch(function () {
        searchIndex = [];
        searchIndexLoading = null;
        return searchIndex;
      });
    return searchIndexLoading;
  }

  function searchIndexItems(toks, list) {
    var L = lang();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var title = L === 'en' ? (it.title_en || it.title_es) : (it.title_es || it.title_en);
      var blurb = L === 'en' ? (it.blurb_en || it.blurb_es) : (it.blurb_es || it.blurb_en);
      var hay = title + ' ' + blurb + ' ' + (it.id || '') + ' ' + (it.tags || []).join(' ') + ' ' + (it.kind || '');
      if (!matchAll(hay, toks)) continue;
      var sc = score(title + ' ' + (it.id || ''), toks);
      if (sc < 0) sc = 1;
      if (it.kind === 'place') sc += 25;
      if (it.kind === 'federal_project') sc += 20;
      if (it.kind === 'ontology') sc += 12;
      if (it.kind === 'theme') sc += 18;
      out.push({
        type: it.kind || 'index',
        title: title,
        blurb: blurb,
        href: it.href,
        score: sc,
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 8);
  }

  function searchPages(toks) {

    var L = lang();
    var out = [];
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      var title = L === 'en' ? p.en : p.es;
      var blurb = L === 'en' ? p.blurb_en : p.blurb_es;
      var hay = title + ' ' + blurb + ' ' + p.es + ' ' + p.en + ' ' + p.href;
      var sc = score(hay, toks);
      if (sc < 0 && !matchAll(hay, toks)) continue;
      if (sc < 0) sc = 1;
      out.push({ type: 'page', title: title, blurb: blurb, href: p.href, score: sc + 50 + (p.boost || 0) });
    }
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    return out.slice(0, MAX_PAGES);
  }

  function searchFolders(toks, list) {
    var L = lang();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var title = L === 'en' ? f.en : f.es;
      var hay = f.id + ' ' + f.es + ' ' + f.en;
      if (!matchAll(hay, toks)) continue;
      var sc = score(hay, toks);
      out.push({
        type: 'folder',
        title: title,
        blurb: f.id + (f.n ? ' · ' + f.n + ' ' + t('files') : ''),
        href: '/catalogo?folder=' + encodeURIComponent(f.id),
        score: sc,
      });
    }
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    return out.slice(0, MAX_FOLDERS);
  }

  function searchFiles(toks, list) {
    var L = lang();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var sum = L === 'en' ? f.sum_en || f.sum_es : f.sum_es || f.sum_en;
      var hay = (f.n || '') + ' ' + (f.p || '') + ' ' + (f.f || '') + ' ' + (sum || '');
      if (!matchAll(hay, toks)) continue;
      var sc = score((f.n || '') + ' ' + (f.f || ''), toks);
      if (sc < 0) sc = 1;
      if (f.gid || f.dv) sc += 5;
      var href = f.dv || (f.gid ? 'https://drive.google.com/file/d/' + f.gid + '/view' : '/catalogo?q=' + encodeURIComponent(f.n || ''));
      out.push({
        type: 'file',
        title: f.n || f.p || 'file',
        blurb: (f.f || '') + (sum ? ' — ' + String(sum).slice(0, 90) : ''),
        href: href,
        external: !!(f.dv || f.gid),
        score: sc,
      });
    }
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    return out.slice(0, MAX_FILES);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderSection(wrap, label, items) {
    if (!items.length) return;
    var h = el('div', 'bcs-hs-section-label', label);
    wrap.appendChild(h);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var a = el('a', 'bcs-hs-item');
      a.href = it.href;
      a.setAttribute('role', 'option');
      if (it.external) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      var tit = el('span', 'bcs-hs-item-title', it.title);
      var sub = el('span', 'bcs-hs-item-blurb', it.blurb || '');
      a.appendChild(tit);
      a.appendChild(sub);
      wrap.appendChild(a);
    }
  }

  function setActive(items, idx) {
    activeIdx = idx;
    for (var i = 0; i < items.length; i++) {
      if (i === idx) items[i].classList.add('active');
      else items[i].classList.remove('active');
    }
  }

  function openResults(panel) {
    panel.hidden = false;
    panel.setAttribute('aria-expanded', 'true');
  }

  function closeResults(panel, root) {
    panel.hidden = true;
    panel.innerHTML = '';
    activeIdx = -1;
    if (root) root.classList.remove('bcs-hs--open');
  }

  function runSearch(q, panel, input) {
    var toks = tokens(q);
    if (!toks.length) {
      closeResults(panel);
      return;
    }
    panel.innerHTML = '';
    var loading = el('div', 'bcs-hs-status', lang() === 'en' ? 'Searching…' : 'Buscando…');
    panel.appendChild(loading);
    openResults(panel);

    Promise.all([ensureCatalog(), ensureFolders(), ensureSearchIndex()]).then(function (pair) {
      var files = pair[0];
      var folds = pair[1];
      var idx = pair[2];
      var pageHits = searchPages(toks);
      var folderHits = searchFolders(toks, folds);
      var fileHits = searchFiles(toks, files);
      var indexHits = searchIndexItems(toks, idx);

      panel.innerHTML = '';
      if (!pageHits.length && !folderHits.length && !fileHits.length && !indexHits.length) {
        panel.appendChild(el('div', 'bcs-hs-status', t('searchNoResults') || (lang() === 'en' ? 'No results' : 'Sin resultados')));
        var more = el('a', 'bcs-hs-more');
        more.href = '/catalogo?q=' + encodeURIComponent(q);
        more.textContent = t('searchMoreCatalog') || (lang() === 'en' ? 'Search in catalog' : 'Buscar en catálogo');
        panel.appendChild(more);
        return;
      }

      renderSection(panel, t('searchSectionPages') || (lang() === 'en' ? 'Pages' : 'Páginas'), pageHits);
      renderSection(panel, lang() === 'en' ? 'Places · themes · projects · ontology' : 'Lugares · temas · proyectos · relaciones', indexHits);
      renderSection(panel, t('searchSectionFolders') || (lang() === 'en' ? 'Folders' : 'Carpetas'), folderHits);
      renderSection(panel, t('searchSectionFiles') || (lang() === 'en' ? 'Files' : 'Archivos'), fileHits);

      var more = el('a', 'bcs-hs-more');
      more.href = '/catalogo?q=' + encodeURIComponent(q);
      more.textContent = t('searchMoreCatalog') || (lang() === 'en' ? 'See all in catalog' : 'Ver todo en catálogo');
      panel.appendChild(more);

      var opts = panel.querySelectorAll('.bcs-hs-item');
      setActive(opts, opts.length ? 0 : -1);
    });
  }

  function wire(root) {
    var input = root.querySelector('.bcs-hs-input');
    var panel = root.querySelector('.bcs-hs-results');
    var toggle = root.querySelector('.bcs-hs-toggle');
    var clearBtn = root.querySelector('.bcs-hs-clear');
    if (!input || !panel) return;

    function syncPlaceholder() {
      input.placeholder = t('headerSearchPlaceholder') || (lang() === 'en' ? 'Search files and pages…' : 'Buscar archivos y páginas…');
      input.setAttribute('aria-label', input.placeholder);
    }
    syncPlaceholder();
    document.addEventListener('bcs:lang', syncPlaceholder);

    function onType() {
      clearTimeout(timer);
      var q = input.value.trim();
      if (clearBtn) clearBtn.hidden = !q;
      timer = setTimeout(function () {
        runSearch(q, panel, input);
      }, DEBOUNCE_MS);
    }

    input.addEventListener('focus', function () {
      root.classList.add('bcs-hs--open');
      ensureCatalog();
      ensureFolders();
      if (input.value.trim()) onType();
    });
    input.addEventListener('input', onType);

    input.addEventListener('keydown', function (e) {
      var opts = panel.querySelectorAll('.bcs-hs-item');
      if (e.key === 'Escape') {
        closeResults(panel, root);
        input.blur();
        root.classList.remove('bcs-hs--expanded');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!opts.length) return;
        setActive(opts, Math.min(activeIdx + 1, opts.length - 1));
        opts[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!opts.length) return;
        setActive(opts, Math.max(activeIdx - 1, 0));
        opts[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && opts[activeIdx]) {
          e.preventDefault();
          opts[activeIdx].click();
        } else if (input.value.trim()) {
          e.preventDefault();
          window.location.href = '/catalogo?q=' + encodeURIComponent(input.value.trim());
        }
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        clearBtn.hidden = true;
        closeResults(panel, root);
        input.focus();
      });
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        root.classList.toggle('bcs-hs--expanded');
        if (root.classList.contains('bcs-hs--expanded')) {
          input.focus();
        } else {
          closeResults(panel, root);
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) {
        closeResults(panel, root);
        root.classList.remove('bcs-hs--expanded');
      }
    });
  }

  function init() {
    var roots = document.querySelectorAll('[data-bcs-header-search]');
    for (var i = 0; i < roots.length; i++) wire(roots[i]);

    document.addEventListener('keydown', function (e) {
      var isK = (e.key === 'k' || e.key === 'K');
      if (!isK || !(e.metaKey || e.ctrlKey)) return;
      var root = document.querySelector('[data-bcs-header-search]');
      if (!root) return;
      e.preventDefault();
      root.classList.add('bcs-hs--expanded');
      var input = root.querySelector('.bcs-hs-input');
      if (input) input.focus();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
