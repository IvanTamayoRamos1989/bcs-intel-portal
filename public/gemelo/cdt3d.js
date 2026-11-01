/* Phase 2.0 — MapLibre terrain for /gemelo. Reuses the atlas DEM and base mask. */
(function () {
  var STATE = [-115.2243, 22.8717, -109.4131, 28.0];
  var TILES = {
    '5/5/13': 1, '5/6/13': 1,
    '6/11/26': 1, '6/11/27': 1, '6/12/26': 1, '6/12/27': 1,
    '7/22/53': 1, '7/22/54': 1, '7/22/55': 1,
    '7/23/53': 1, '7/23/54': 1, '7/23/55': 1,
    '7/24/53': 1, '7/24/54': 1, '7/24/55': 1,
    '7/25/53': 1, '7/25/54': 1, '7/25/55': 1,
  };
  var memory = new Map();

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
    } catch (e) {
      return false;
    }
  }

  async function flatten(buf) {
    var bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
    var cv = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bmp.width, bmp.height)
      : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    var im = ctx.getImageData(0, 0, cv.width, cv.height);
    var d = im.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i] < 128) { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; }
    }
    ctx.putImageData(im, 0, 0);
    var out = cv.convertToBlob ? await cv.convertToBlob({ type: 'image/png' }) : await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    return out.arrayBuffer();
  }

  function registerDem() {
    if (window.__cdtDem) return;
    window.__cdtDem = true;
    maplibregl.addProtocol('bcsdem', async function (p, ctrl) {
      var key = p.url.replace('bcsdem://', '').replace(/\.png$/, '');
      if (memory.has(key)) return { data: memory.get(key).slice(0) };
      var url = TILES[key]
        ? '/explorar/terrain/' + key + '.png'
        : 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + key + '.png';
      var r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('dem');
      var raw = await r.arrayBuffer();
      var flat = raw;
      try { flat = await flatten(raw); } catch (e) { flat = raw; }
      if (memory.size > 280) memory.delete(memory.keys().next().value);
      memory.set(key, flat);
      return { data: flat.slice(0) };
    });
  }

  function styleSpec(base) {
    var empty = { type: 'FeatureCollection', features: [] };
    var dem = {
      type: 'raster-dem',
      tiles: ['bcsdem://{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      minzoom: 5,
      maxzoom: 12,
      bounds: [-118, 20, -106, 31.5],
    };
    return {
      version: 8,
      sources: {
        dem: dem,
        shade: Object.assign({}, dem),
        land: { type: 'geojson', data: (base && base.land) || empty },
        bcs: { type: 'geojson', data: (base && base.boundary) || empty },
        munis: { type: 'geojson', data: (base && base.municipalities) || empty },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': '#c5d5de' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e7e2d4', 'fill-opacity': 0.9 } },
        { id: 'bcs-land', type: 'fill', source: 'bcs', paint: { 'fill-color': '#ece6d4' } },
        { id: 'hills', type: 'hillshade', source: 'shade', paint: {
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#6d848c',
          'hillshade-highlight-color': '#fbf8ee',
          'hillshade-accent-color': '#8ea0a4',
        } },
        { id: 'cdt-muni-fill', type: 'fill', source: 'munis', paint: { 'fill-color': '#d6e8f5', 'fill-opacity': 0.42 } },
        { id: 'cdt-muni-line', type: 'line', source: 'munis', paint: { 'line-color': '#006BA3', 'line-width': 1.3 } },
        { id: 'coast', type: 'line', source: 'bcs', paint: { 'line-color': '#5f7f8c', 'line-width': 1.1 } },
      ],
      terrain: { source: 'dem', exaggeration: 1.15 },
      sky: {
        'sky-color': '#d7e5ea',
        'horizon-color': '#f3f0e6',
        'fog-color': '#e7ece7',
        'fog-ground-blend': 0.55,
        'horizon-fog-blend': 0.65,
        'sky-horizon-blend': 0.65,
      },
    };
  }

  function matchExpr(colors, prop, fallback) {
    var expr = ['match', ['get', 'name']];
    Object.keys(colors).forEach(function (name) {
      expr.push(name, colors[name][prop]);
    });
    expr.push(fallback);
    return expr;
  }

  function start(opts) {
    registerDem();
    var reduced = !!opts.reduced;
    var pitch0 = reduced ? 0 : 50;
    var bearing0 = reduced ? 0 : -16;
    return fetch('/explorar/data/base.json').then(function (r) {
      if (!r.ok) throw new Error('base');
      return r.json();
    }).catch(function () { return null; }).then(function (base) {
      var map = new maplibregl.Map({
        container: opts.container,
        style: styleSpec(base),
        bounds: base && base.bounds ? base.bounds : [[STATE[0], STATE[1]], [STATE[2], STATE[3]]],
        fitBoundsOptions: { padding: 24, pitch: pitch0, bearing: bearing0 },
        pitch: pitch0,
        bearing: bearing0,
        maxPitch: 70,
        minZoom: 4.4,
        maxZoom: 13,
        attributionControl: true,
        dragRotate: !reduced,
        touchPitch: !reduced,
        cooperativeGestures: false,
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
      var stateBox = (base && base.bounds)
        ? [base.bounds[0][0], base.bounds[0][1], base.bounds[1][0], base.bounds[1][1]]
        : STATE;
      var cache = {};
      function fitBox(b) {
        var box = b && b.length === 4 ? b : stateBox;
        map.resize();
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], {
          padding: 22,
          pitch: map.getPitch(),
          bearing: reduced ? 0 : map.getBearing(),
          duration: reduced ? 0 : 650,
          maxZoom: 10,
        });
      }
      function paintMunis(colors) {
        if (!map.getLayer('cdt-muni-fill')) return;
        map.setPaintProperty('cdt-muni-fill', 'fill-color', matchExpr(colors, 'fill', '#e6eef2'));
        map.setPaintProperty('cdt-muni-line', 'line-color', matchExpr(colors, 'line', '#8aa0ad'));
        map.setPaintProperty('cdt-muni-line', 'line-width', matchExpr(colors, 'weight', 1.1));
      }
      function ensure(id, geo, meta) {
        var src = 'cdt-src-' + id;
        var lid = 'cdt-ly-' + id;
        if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: geo });
        if (map.getLayer(lid)) return lid;
        var point = meta.type === 'point' || meta.type === 'points';
        var line = meta.type === 'line';
        if (point) {
          map.addLayer({
            id: lid, type: 'circle', source: src,
            paint: {
              'circle-radius': 5.5,
              'circle-color': meta.color || '#0083C4',
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-pitch-alignment': 'map',
            },
          });
        } else if (line) {
          map.addLayer({
            id: lid, type: 'line', source: src,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': meta.color || '#0083C4', 'line-width': 1.5, 'line-opacity': 0.9 },
          }, 'cdt-muni-fill');
        } else {
          map.addLayer({
            id: lid, type: 'fill', source: src,
            paint: {
              'fill-color': meta.color || '#0083C4',
              'fill-opacity': 0.22,
              'fill-outline-color': meta.color || '#0083C4',
            },
          }, 'cdt-muni-fill');
        }
        return lid;
      }
      function hide(id) {
        var lid = 'cdt-ly-' + id;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', 'none');
      }
      function show(id, geo, meta, mode) {
        var lid = ensure(id, geo, meta);
        map.setLayoutProperty(lid, 'visibility', mode === 'off' ? 'none' : 'visible');
        var point = meta.type === 'point' || meta.type === 'points';
        var line = meta.type === 'line';
        if (point) {
          map.setPaintProperty(lid, 'circle-stroke-width', mode === 'compare' ? 3 : 1);
          map.setPaintProperty(lid, 'circle-stroke-color', mode === 'compare' ? '#0b3a56' : '#ffffff');
        } else if (line) {
          map.setPaintProperty(lid, 'line-width', mode === 'compare' ? 3.2 : 1.5);
        } else {
          map.setPaintProperty(lid, 'fill-opacity', mode === 'compare' ? 0.42 : 0.22);
        }
      }
      function load(meta) {
        if (cache[meta.id]) return Promise.resolve(cache[meta.id]);
        return fetch(meta.url).then(function (r) {
          if (!r.ok) throw new Error(meta.id);
          return r.json();
        }).then(function (geo) {
          cache[meta.id] = geo;
          return geo;
        }).catch(function () {
          cache[meta.id] = null;
          return null;
        });
      }
      function label(btn, es, en, pressed) {
        if (!btn) return;
        var a = btn.querySelector('[data-lang-es]');
        var b = btn.querySelector('[data-lang-en]');
        if (a) a.textContent = es;
        if (b) b.textContent = en;
        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      }
      function bindTools() {
        var pitchBtn = document.getElementById('cdt-pitch');
        var rot = document.getElementById('cdt-rot');
        var north = document.getElementById('cdt-north');
        var fit = document.getElementById('cdt-fit');
        function syncPitch() {
          label(pitchBtn, map.getPitch() > 8 ? 'Vista cenital' : 'Vista 3D', map.getPitch() > 8 ? 'Top view' : '3D view', map.getPitch() > 8);
        }
        if (pitchBtn) pitchBtn.onclick = function () {
          var flat = map.getPitch() > 8;
          map.easeTo({ pitch: flat ? 0 : 52, duration: reduced ? 0 : 600 });
        };
        if (rot && !reduced) rot.onclick = function () {
          map.easeTo({ bearing: map.getBearing() + 22, duration: 450 });
        };
        if (rot && reduced) rot.hidden = true;
        if (north) north.onclick = function () { map.easeTo({ bearing: 0, duration: reduced ? 0 : 400 }); };
        if (fit) fit.onclick = function () { fitBox(null); };
        map.on('pitchend', syncPitch);
        syncPitch();
      }
      map.on('click', 'cdt-muni-fill', function (e) {
        var f = e.features && e.features[0];
        var name = f && f.properties && f.properties.name;
        if (name && opts.onMunicipality) opts.onMunicipality(name);
      });
      map.on('mouseenter', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = ''; });
      return new Promise(function (resolve, reject) {
        var settled = false;
        map.on('load', function () {
          if (settled) return;
          settled = true;
          bindTools();
          if (!base || !base.municipalities) {
            fetch('/gis/osm_municipalities.geojson').then(function (r) { return r.json(); }).then(function (geo) {
              if (map.getSource('munis')) map.getSource('munis').setData(geo);
            }).catch(function () {});
          }
          resolve({
            kind: '3d',
            fitBox: fitBox,
            resize: function () { map.resize(); },
            paintMunis: paintMunis,
            show: show,
            hide: hide,
            load: load,
          });
        });
        function fail(err) {
          if (settled) return;
          settled = true;
          try { map.remove(); } catch (e) {}
          reject(err);
        }
        map.on('error', function (ev) {
          var msg = String(ev && ev.error && ev.error.message || '');
          if (/WebGL|failed to initialize/i.test(msg)) fail(ev.error || new Error(msg));
        });
        setTimeout(function () { if (!settled) fail(new Error('timeout')); }, 20000);
      });
    });
  }

  window.CDT3D = { hasWebGL: hasWebGL, start: start };
})();
