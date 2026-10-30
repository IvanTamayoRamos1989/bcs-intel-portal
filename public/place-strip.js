/**
 * BCS place-vocation strip — persist ?place= / localStorage, sync chips, filter/scroll cards.
 */
(function () {
  var KEY = 'bcs_place';
  
  var NESTED = {
    los_cabos: ['los_cabos', 'east_cape'],
    la_paz: ['la_paz', 'todos_santos'],
    loreto: ['loreto'],
    comondu: ['comondu'],
    mulege_north: ['mulege_north'],
    east_cape: ['east_cape', 'los_cabos'],
    todos_santos: ['todos_santos', 'la_paz']
  };
  function matchPlace(cardId, selected) {
    if (!selected) return true;
    var group = NESTED[selected] || [selected];
    return group.indexOf(cardId) >= 0;
  }

  var VALID = {
    los_cabos: 1,
    east_cape: 1,
    todos_santos: 1,
    la_paz: 1,
    loreto: 1,
    comondu: 1,
    mulege_north: 1,
  };

  function readUrl() {
    try {
      var p = new URLSearchParams(window.location.search).get('place');
      return p && VALID[p] ? p : '';
    } catch (e) {
      return '';
    }
  }

  function readStored() {
    try {
      var p = localStorage.getItem(KEY) || '';
      return p && VALID[p] ? p : '';
    } catch (e) {
      return '';
    }
  }

  
  /* PASS4_SYNC_FROM_PATH */
  function placeFromPath() {
    var m = (location.pathname || '').match(/\/studio\/([a-z0-9_]+)/);
    if (!m) return '';
    var id = m[1];
    if (id === 'bcs') return '';
    var rev = { los_cabos: 'los_cabos', la_paz: 'la_paz', loreto: 'loreto', comondu: 'comondu', mulege: 'mulege_north' };
    return rev[id] || (VALID[id] ? id : '');
  }
  function getPlace() {
    return readUrl() || placeFromPath() || readStored() || '';
  }

  function writeUrl(id) {
    try {
      var u = new URL(window.location.href);
      if (id) u.searchParams.set('place', id);
      else u.searchParams.delete('place');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  function writeStored(id) {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function setPlace(id, opts) {
    opts = opts || {};
    if (id && !VALID[id]) id = '';
    writeStored(id);
    if (!opts.skipUrl) writeUrl(id);
    syncChips(id);
    applyPage(id, { scroll: !!opts.scroll });
    updateDeepLinks(id);
    try {
      window.dispatchEvent(new CustomEvent('bcs:placechange', { detail: { place: id || null } }));
    } catch (e) {}
    /* PASS4_STUDIO_NAV: on place hubs, Ámbito opens the matching municipio page */
    try {
      if (opts && opts.skipNav) return;
      var path = location.pathname || '';
      if (/\/studio(\/|$)/.test(path) || /\/lugares(\/|$)/.test(path)) {
        var target = studioPath(id);
        if (target && location.pathname.replace(/\/$/, '') !== target.replace(/\/$/, '')) {
          location.href = target;
        }
      }
    } catch (e2) {}
  }

  function syncState(id) {
    var labels = {
      '': { es: 'Contexto: BCS', en: 'Context: BCS' },
      los_cabos: { es: 'Contexto: Los Cabos', en: 'Context: Los Cabos' },
      east_cape: { es: 'Contexto: Cabo Este', en: 'Context: East Cape' },
      todos_santos: { es: 'Contexto: Todos Santos', en: 'Context: Todos Santos' },
      la_paz: { es: 'Contexto: La Paz', en: 'Context: La Paz' },
      loreto: { es: 'Contexto: Loreto', en: 'Context: Loreto' },
      comondu: { es: 'Contexto: Comondú', en: 'Context: Comondú' },
      mulege_north: { es: 'Contexto: Mulegé', en: 'Context: Mulegé' },
    };
    var lab = labels[id || ''] || labels[''];
    document.querySelectorAll('[data-bcs-place-state]').forEach(function (el) {
      var es = el.querySelector('[data-lang-es]');
      var en = el.querySelector('[data-lang-en]');
      if (es) es.textContent = lab.es;
      if (en) en.textContent = lab.en;
    });
  }

  function chipIdFor(id) {
    if (!id) return '';
    if (id === 'east_cape') return 'los_cabos';
    if (id === 'todos_santos') return 'la_paz';
    return id;
  }

  function syncChips(id) {
    syncState(id);
    var chipFocus = chipIdFor(id);
    document.querySelectorAll('[data-bcs-place-strip]').forEach(function (strip) {
      strip.querySelectorAll('.bcs-ps-chip').forEach(function (btn) {
        var pid = btn.getAttribute('data-place') || '';
        var on = pid === (chipFocus || '');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }

  function studioPath(id) {
    var map = {
      los_cabos: 'los_cabos',
      east_cape: 'los_cabos',
      la_paz: 'la_paz',
      todos_santos: 'la_paz',
      loreto: 'loreto',
      comondu: 'comondu',
      mulege_north: 'mulege'
    };
    if (!id) return '/studio/bcs/';
    return '/studio/' + (map[id] || 'bcs') + '/';
  }

  function updateDeepLinks(id) {
    document.querySelectorAll('[data-bcs-place-links]').forEach(function (wrap) {
      var fs = wrap.querySelector('[data-deep="foresights"]');
      var gd = wrap.querySelector('[data-deep="crecimiento"]');
      var st = wrap.querySelector('[data-deep="studio"]');
      var lg = wrap.querySelector('[data-deep="lugares"]');
      var q = id ? '?place=' + encodeURIComponent(id) : '';
      if (fs) fs.href = '/foresights/' + q + (id ? '#' + id : '');
      if (gd) gd.href = '/crecimiento/' + q + (id ? '#' + id : '');
      if (st) st.href = studioPath(id);
      if (lg) lg.href = studioPath(id);
      if (id) wrap.removeAttribute('hidden');
      else wrap.setAttribute('hidden', '');
    });
  }

  function applyPage(id, opts) {
    opts = opts || {};
    var cards = document.querySelectorAll('[data-place-card]');
    if (!cards.length) {
      // Fallback: elements with id matching place ids
      Object.keys(VALID).forEach(function (pid) {
        var el = document.getElementById(pid);
        if (el && !el.hasAttribute('data-place-card')) {
          el.setAttribute('data-place-card', pid);
        }
      });
      cards = document.querySelectorAll('[data-place-card]');
    }

    var target = null;
    cards.forEach(function (card) {
      var pid = card.getAttribute('data-place-card') || card.id || '';
      card.classList.remove('bcs-place-dim', 'bcs-place-active');
      if (!id) return;
      if (matchPlace(pid, id)) {
        card.classList.add('bcs-place-active');
        if (!target || pid === id) target = card;
      } else {
        card.classList.add('bcs-place-dim');
      }
    });

    // Stills / items tagged by place
    document.querySelectorAll('[data-place-item]').forEach(function (item) {
      var pid = item.getAttribute('data-place-item') || '';
      item.classList.remove('bcs-place-dim', 'bcs-place-active');
      if (!id) return;
      if (pid === id) item.classList.add('bcs-place-active');
      else item.classList.add('bcs-place-dim');
    });

    if (opts.scroll && target) {
      setTimeout(function () {
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {}
      }, 60);
    }
  }

  function bindStrips() {
    document.querySelectorAll('[data-bcs-place-strip]').forEach(function (strip) {
      if (strip.getAttribute('data-bcs-bound')) return;
      strip.setAttribute('data-bcs-bound', '1');
      strip.addEventListener('click', function (e) {
        var btn = e.target.closest('.bcs-ps-chip');
        if (!btn || !strip.contains(btn)) return;
        e.preventDefault();
        var id = btn.getAttribute('data-place') || '';
        setPlace(id, { scroll: !!id });
      });
    });
  }

  function init() {
    bindStrips();
    var id = getPlace();
    // Prefer URL; if only storage, also reflect in URL for shareability
    if (id && !readUrl()) writeUrl(id);
    syncChips(id);
    applyPage(id, { scroll: !!readUrl() });
    updateDeepLinks(id);
  }

  window.BCSPlace = {
    get: getPlace,
    set: setPlace,
    valid: VALID,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
