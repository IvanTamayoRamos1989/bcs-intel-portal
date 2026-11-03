(function () {
  var input = document.getElementById('map-place-search'),
    list = document.getElementById('map-place-results');
  if (!input || !list) return;
  var places = [],
    ready = false;
  function isEn() {
    return document.documentElement.getAttribute('data-lang') === 'en';
  }
  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  var LANDMARKS = [
    { name: 'Los Cabos', kind: 'muni', muni: 'Los Cabos', coords: [-109.78, 23.06], aliases: 'municipio los cabos san jose cabo san lucas' },
    { name: 'La Paz', kind: 'muni', muni: 'La Paz', coords: [-110.31, 24.14], aliases: 'municipio la paz capital' },
    { name: 'Loreto', kind: 'muni', muni: 'Loreto', coords: [-111.35, 26.01], aliases: 'municipio loreto nopolo' },
    { name: 'Comondú', kind: 'muni', muni: 'Comondú', coords: [-111.67, 25.03], aliases: 'municipio comondu ciudad constitucion valle santo domingo' },
    { name: 'Mulegé', kind: 'muni', muni: 'Mulegé', coords: [-112.85, 27.15], aliases: 'municipio mulege santa rosalia guerrero negro vizcaino' },
    { name: 'Cabo Pulmo', kind: 'landmark', coords: [-109.425, 23.442], aliases: 'parque nacional cabo pulmo arrecife east cape cabo del este' },
    { name: 'Cabo del Este (East Cape)', kind: 'landmark', coords: [-109.52, 23.56], aliases: 'east cape cabo del este la ribera buenavista los barriles' },
    { name: 'Balandra', kind: 'landmark', coords: [-110.325, 24.322], aliases: 'playa balandra anp la paz' },
    { name: 'Pichilingue', kind: 'landmark', coords: [-110.331, 24.269], aliases: 'puerto pichilingue la paz ferry' },
    { name: 'Sierra La Laguna', kind: 'landmark', coords: [-109.98, 23.55], aliases: 'reserva biosfera sierra la laguna recarga' },
    { name: 'Bahía de Loreto', kind: 'landmark', coords: [-111.25, 25.92], aliases: 'parque nacional bahia de loreto islas' },
    { name: 'Reserva El Vizcaíno', kind: 'landmark', coords: [-113.45, 27.55], aliases: 'reserva biosfera el vizcaino oulook laguna ojo de liebre san ignacio' },
    { name: 'Valle de Santo Domingo', kind: 'landmark', coords: [-111.67, 25.15], aliases: 'acuifero santo domingo comondu ciudad constitucion' }
  ];
  function labelFor(item) {
    if (item.kind === 'muni') {
      return item.name + (isEn() ? ' (Municipality)' : ' (Municipio)');
    }
    if (item.muni && norm(item.muni) !== norm(item.name)) {
      return item.name + ' · ' + item.muni;
    }
    return item.name;
  }
  function render() {
    list.innerHTML = '';
    var q = norm(input.value.trim());
    list.hidden = !q;
    if (!q) return;
    var matches = places
      .filter(function (item) {
        return item.searchKey.indexOf(q) !== -1;
      })
      .slice(0, 8);
    if (!matches.length) {
      var empty = document.createElement('li');
      empty.textContent = ready
        ? isEn()
          ? 'No places found. Try another name.'
          : 'No se encontraron lugares. Prueba otro nombre.'
        : isEn()
          ? 'Loading places…'
          : 'Cargando lugares…';
      list.appendChild(empty);
      return;
    }
    matches.forEach(function (item) {
      var li = document.createElement('li'),
        b = document.createElement('button');
      b.type = 'button';
      b.textContent = labelFor(item);
      b.addEventListener('click', function () {
        if (window.Shell) {
          if (item.kind === 'muni' && window.Shell.focusMuni) {
            window.Shell.focusMuni(item.muni || item.name);
          } else {
            window.Shell.focusPoint(item.coords[0], item.coords[1], item.name);
          }
        }
        input.value = item.name;
        list.hidden = true;
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  }
  Promise.all([
    fetch('/gis/osm_towns.geojson').then(function (r) { return r.ok ? r.json() : { features: [] }; }).catch(function () { return { features: [] }; }),
    fetch('/gis/settlements.geojson').then(function (r) { return r.ok ? r.json() : { features: [] }; }).catch(function () { return { features: [] }; })
  ])
    .then(function (res) {
      var seen = {};
      var out = [];
      LANDMARKS.forEach(function (lm) {
        var k = lm.kind + ':' + norm(lm.name);
        seen[k] = true;
        out.push({
          name: lm.name,
          kind: lm.kind,
          muni: lm.muni || '',
          coords: lm.coords,
          searchKey: norm(lm.name + ' ' + (lm.aliases || '') + ' ' + (lm.muni || ''))
        });
      });
      function addFeatures(features) {
        (features || []).forEach(function (f) {
          if (!f || !f.geometry || f.geometry.type !== 'Point' || !f.properties || !f.properties.name) return;
          var name = String(f.properties.name).trim();
          var muni = f.properties.municipio || f.properties.MUNICIPIO || '';
          var k = 'town:' + norm(name);
          if (seen[k]) return;
          seen[k] = true;
          out.push({
            name: name,
            kind: 'town',
            muni: muni,
            coords: f.geometry.coordinates,
            searchKey: norm(name + ' ' + muni)
          });
        });
      }
      addFeatures(res[1].features);
      addFeatures(res[0].features);
      places = out;
      ready = true;
      render();
    })
    .catch(function () {
      ready = true;
      list.textContent = isEn()
        ? 'Places could not be loaded. Reload the page.'
        : 'No se pudieron cargar los lugares. Recarga la página.';
    });
  input.addEventListener('input', render);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') list.hidden = true;
    if (e.key === 'ArrowDown') {
      var b = list.querySelector('button');
      if (b) {
        e.preventDefault();
        b.focus();
      }
    }
  });
  document.addEventListener('bcs:lang', function () {
    if (!list.hidden) render();
  });
})();
