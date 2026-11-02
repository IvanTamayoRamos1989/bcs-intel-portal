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
  var demWait = new Map();
  var baseWait = null;
  var geoReady = {};
  var geoWait = {};

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
    maplibregl.addProtocol('bcsdem', function (p) {
      var key = p.url.replace('bcsdem://', '').replace(/\.png$/, '');
      if (memory.has(key)) return Promise.resolve({ data: memory.get(key).slice(0) });
      if (demWait.has(key)) return demWait.get(key).then(function (flat) { return { data: flat.slice(0) }; });
      var url = TILES[key]
        ? '/explorar/terrain/' + key + '.png'
        : 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + key + '.png';
      var job = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('dem');
        return r.arrayBuffer();
      }).then(function (raw) {
        return flatten(raw).catch(function () { return raw; });
      }).then(function (flat) {
        if (memory.size > 280) memory.delete(memory.keys().next().value);
        memory.set(key, flat);
        demWait.delete(key);
        return flat;
      }).catch(function (err) {
        demWait.delete(key);
        throw err;
      });
      demWait.set(key, job);
      return job.then(function (flat) { return { data: flat.slice(0) }; });
    });
  }

  function loadBase() {
    if (!baseWait) {
      baseWait = fetch('/explorar/data/base.json').then(function (r) {
        if (!r.ok) throw new Error('base');
        return r.json();
      }).catch(function () {
        baseWait = null;
        return null;
      });
    }
    return baseWait;
  }

  function loadGeo(meta) {
    if (Object.prototype.hasOwnProperty.call(geoReady, meta.id)) return Promise.resolve(geoReady[meta.id]);
    if (geoWait[meta.id]) return geoWait[meta.id];
    geoWait[meta.id] = fetch(meta.url).then(function (r) {
      if (!r.ok) throw new Error(meta.id);
      return r.json();
    }).then(function (geo) {
      geoReady[meta.id] = geo;
      delete geoWait[meta.id];
      return geo;
    }).catch(function () {
      geoReady[meta.id] = null;
      delete geoWait[meta.id];
      return null;
    });
    return geoWait[meta.id];
  }

  function bcsMask(base) {
    var fc = base && base.boundary;
    var feat = fc && fc.features && fc.features[0];
    var g = feat && feat.geometry;
    var empty = { type: 'FeatureCollection', features: [] };
    if (!g) return empty;
    var polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    var holes = [];
    polys.forEach(function (poly) {
      if (poly && poly[0] && poly[0].length > 3) holes.push(poly[0].slice().reverse());
    });
    var world = [[-130, 14], [-90, 14], [-90, 40], [-130, 40], [-130, 14]];
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world].concat(holes) } };
  }

  function styleSpec(base) {
    var empty = { type: 'FeatureCollection', features: [] };
    var dem = {
      type: 'raster-dem',
      tiles: ['bcsdem://{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      minzoom: 5,
      maxzoom: 14,
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
        bars: { type: 'geojson', data: empty },
        mask: { type: 'geojson', data: bcsMask(base) },
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap',
          maxzoom: 19,
        },
        sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri',
          maxzoom: 18,
        },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': '#c5d5de' } },
        { id: 'basemap-sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
        { id: 'basemap-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e7e2d4', 'fill-opacity': 0.9 } },
        { id: 'bcs-land', type: 'fill', source: 'bcs', paint: { 'fill-color': '#ece6d4' } },
        { id: 'hills', type: 'hillshade', source: 'shade', paint: {
          // Several light directions show ridges on every side of the sierra (MapLibre >= 5.5).
          'hillshade-method': 'multidirectional',
          'hillshade-illumination-direction': [270, 315, 0, 45],
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 10, 0.5],
          'hillshade-shadow-color': ['#6d848c', '#6d848c', '#7f9298', '#7f9298'],
          'hillshade-highlight-color': ['#fbf8ee', '#fbf8ee', '#f6f1e3', '#f6f1e3'],
          'hillshade-accent-color': '#8ea0a4',
        } },
        { id: 'bcs-mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#c5d5de', 'fill-opacity': 1 } },
        { id: 'cdt-muni-fill', type: 'fill', source: 'munis', paint: { 'fill-color': '#d6e8f5', 'fill-opacity': 0.42 } },
        { id: 'cdt-muni-extrude', type: 'fill-extrusion', source: 'munis', filter: ['>', ['get', 'h'], 0], paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 2500, '#9fd0ea', 25000, '#006BA3'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.78,
          'fill-extrusion-vertical-gradient': true,
        } },
        { id: 'cdt-muni-line', type: 'line', source: 'munis', paint: { 'line-color': '#006BA3', 'line-width': 1.3 } },
        { id: 'cdt-bars', type: 'fill-extrusion', source: 'bars', filter: ['==', ['geometry-type'], 'Polygon'], paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 8000, '#9fd0ea', 28000, '#0083C4'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.72,
          'fill-extrusion-vertical-gradient': true,
        } },
        { id: 'coast', type: 'line', source: 'bcs', paint: { 'line-color': '#5f7f8c', 'line-width': 1.1 } },
      ],
      terrain: { source: 'dem', exaggeration: 1.35 },
      // Low afternoon sun from the south-west: volumes read with a lit face and a shaded face.
      light: { anchor: 'map', color: '#fff7ea', intensity: 0.42, position: [1.3, 225, 38] },
      sky: {
        'sky-color': '#d7e5ea',
        'horizon-color': '#f3f0e6',
        'fog-color': '#e7ece7',
        'fog-ground-blend': 0.55,
        'horizon-fog-blend': 0.65,
        'sky-horizon-blend': 0.65,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 5, 0.85, 10, 0.5, 13, 0.15],
      },
    };
  }

  var POP = ['to-number', ['coalesce', ['get', 'population'], ['get', 'pobtot'], 0], 0];
  // Circle size follows the population the file carries. Features without one stay small.
  function circleR(k) {
    return ['interpolate', ['linear'], ['zoom'],
      6, ['*', k, ['+', 2.4, ['*', 0.013, ['sqrt', POP]]]],
      10, ['*', k, ['+', 4, ['*', 0.022, ['sqrt', POP]]]]];
  }
  var CIRCLE_R = circleR(1);
  var ROAD = ['coalesce', ['get', 'highway'], ''];
  function lineW(k) {
    return ['interpolate', ['exponential', 1.5], ['zoom'],
      6, ['*', k, ['match', ROAD, 'motorway', 1.9, 'trunk', 1.6, 'primary', 1.1, 'secondary', 0.6, 1.2]],
      11, ['*', k, ['match', ROAD, 'motorway', 5, 'trunk', 4.2, 'primary', 3, 'secondary', 1.8, 2.6]]];
  }
  var LINE_W = lineW(1);
  var CASE_W = ['interpolate', ['exponential', 1.5], ['zoom'],
    6, ['match', ROAD, 'motorway', 3.2, 'trunk', 2.8, 'primary', 2.1, 'secondary', 0, 0],
    11, ['match', ROAD, 'motorway', 7.5, 'trunk', 6.6, 'primary', 5, 'secondary', 3.4, 0]];

  function injectCss() {
    if (document.getElementById('cdt3d-css')) return;
    var st = document.createElement('style');
    st.id = 'cdt3d-css';
    st.textContent = [
      '.cdt-place{pointer-events:none;font:600 12px/1.15 "DM Sans","Helvetica Neue",Arial,sans-serif;color:#1f3440;letter-spacing:.01em;white-space:nowrap;',
      'text-shadow:0 0 2px #f6f3ea,0 0 3px #f6f3ea,0 0 6px rgba(246,243,234,.9);padding-left:9px}',
      '.cdt-place.is-hid{visibility:hidden}',
      '.cdt-orbit button[aria-pressed="true"]{background:#0083C4;color:#fff}',
      '.cdt-orbit button{color:#1f3440;display:flex;align-items:center;justify-content:center}',
      '.cdt-orbit button:hover{background:#eef5f9}',
      '.cdt-orbit button[aria-pressed="true"]:hover{background:#006BA3}',
      '.cdt-hint{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:min(560px,90%);z-index:3;background:rgba(251,248,240,.96);',
      'color:#1f3440;font:400 13px/1.45 "DM Sans","Helvetica Neue",Arial,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 4px 18px rgba(31,52,64,.18)}',
      '.cdt-hint b{display:block;font-weight:700;margin-bottom:2px}',
      '.cdt-hint.is-touch{top:64px;bottom:auto;left:12px;right:64px;transform:none;max-width:none;font-size:12.5px}',
      '.cdt-hint button{margin-left:8px;font:inherit;font-weight:700;color:#006BA3;background:none;border:1px solid #0083C4;border-radius:999px;padding:1px 10px;cursor:pointer}',
      '.cdt-place.t1{font-size:14px;font-weight:700;letter-spacing:.02em}',
      '.cdt-place.t3{font-weight:500;font-size:11px;color:#3c5260}',
      '.maplibregl-map[data-ztier="1"] .cdt-place.t3,.maplibregl-map[data-base="streets"] .cdt-place{visibility:hidden}',
      '.maplibregl-map[data-sat="1"] .cdt-place{color:#fff;text-shadow:0 0 3px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.6)}',
    ].join('');
    document.head.appendChild(st);
  }

  // Orbit tools: turn and tilt buttons, a slow auto-orbit, and a mode where a one-finger / left drag orbits.
  function orbitControl(map) {
    var wrap = document.createElement('div');
    wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group cdt-orbit';
    var lang = function () { return (document.documentElement.lang || 'es').slice(0, 2) === 'en' ? 'en' : 'es'; };
    var spin = null;
    var orbitMode = false;
    function btn(icon, es, en, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = icon;
      b.title = lang() === 'en' ? en : es;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(b); });
      wrap.appendChild(b);
      return b;
    }
    function svg(path) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }
    function stopSpin() {
      if (!spin) return;
      cancelAnimationFrame(spin);
      spin = null;
      spinBtn.setAttribute('aria-pressed', 'false');
    }
    btn(svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>'), 'Girar a la izquierda', 'Orbit left', function () {
      stopSpin(); map.easeTo({ bearing: map.getBearing() - 45, duration: 700 });
    });
    btn(svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>'), 'Girar a la derecha', 'Orbit right', function () {
      stopSpin(); map.easeTo({ bearing: map.getBearing() + 45, duration: 700 });
    });
    btn(svg('<path d="M4 17l8-8 8 8"/>'), 'Inclinar más', 'Tilt up', function () {
      map.easeTo({ pitch: Math.min(map.getMaxPitch(), map.getPitch() + 15), duration: 500 });
    });
    btn(svg('<path d="M4 8l8 8 8-8"/>'), 'Inclinar menos', 'Tilt down', function () {
      map.easeTo({ pitch: Math.max(0, map.getPitch() - 15), duration: 500 });
    });
    var spinBtn = btn(svg('<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M12 21a9 9 0 0 1-9-9"/>'), 'Órbita automática', 'Auto-orbit', function (b) {
      if (spin) { stopSpin(); return; }
      b.setAttribute('aria-pressed', 'true');
      if (map.getPitch() < 35) map.easeTo({ pitch: 55, duration: 600 });
      var last = performance.now();
      (function step(t) {
        var dt = Math.min(64, t - last); last = t;
        map.setBearing(map.getBearing() + dt * 0.006);
        spin = requestAnimationFrame(step);
      })(last);
    });
    spinBtn.setAttribute('aria-pressed', 'false');
    var modeBtn = btn(svg('<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>'), 'Arrastrar para orbitar (activar o desactivar)', 'Drag to orbit (toggle)', function (b) {
      orbitMode = !orbitMode;
      b.setAttribute('aria-pressed', orbitMode ? 'true' : 'false');
      if (orbitMode) map.dragPan.disable(); else map.dragPan.enable();
      map.getCanvas().style.cursor = orbitMode ? 'grab' : '';
    });
    modeBtn.setAttribute('aria-pressed', 'false');
    // Drag-to-orbit: horizontal turns, vertical tilts, around the centre of the view.
    var drag = null;
    function down(x, y) { if (!orbitMode) return; stopSpin(); drag = { x: x, y: y, b: map.getBearing(), p: map.getPitch(), moved: false }; map.getCanvas().style.cursor = 'grabbing'; }
    function move(x, y) {
      if (!drag) return;
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 4) drag.moved = true;
      map.jumpTo({ bearing: drag.b - (x - drag.x) * 0.35, pitch: Math.max(0, Math.min(map.getMaxPitch(), drag.p - (y - drag.y) * 0.25)) });
    }
    function up() { if (!drag) return; if (drag.moved) map.__orbitDragAt = Date.now(); drag = null; map.getCanvas().style.cursor = orbitMode ? 'grab' : ''; }
    var cv = map.getCanvasContainer();
    cv.addEventListener('mousedown', function (e) { if (e.button === 0) down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', function (e) { if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    cv.addEventListener('touchmove', function (e) { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY); else up(); }, { passive: true });
    cv.addEventListener('touchend', up);
    // Any manual interaction stops the auto-orbit.
    ['mousedown', 'wheel', 'touchstart'].forEach(function (ev) { cv.addEventListener(ev, stopSpin, { passive: true }); });
    return {
      onAdd: function () { return wrap; },
      onRemove: function () { stopSpin(); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); },
    };
  }

  function navHint(map) {
    var key = 'cdt3d-hint-v1';
    try { if (localStorage.getItem(key)) return; } catch (e) {}
    var en = (document.documentElement.lang || 'es').slice(0, 2) === 'en';
    var el = document.createElement('div');
    el.className = 'cdt-hint';
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch) el.classList.add('is-touch');
    el.innerHTML = touch
      ? (en
        ? '<b>Move around in 3D</b> One finger to pan · two fingers to zoom and turn · drag two fingers up or down to tilt. <button type="button">Got it</button>'
        : '<b>Moverse en 3D</b> Un dedo para desplazar · dos dedos para acercar y girar · arrastra dos dedos arriba o abajo para inclinar. <button type="button">Entendido</button>')
      : en
      ? '<b>Move around in 3D</b> Drag to pan · right-drag or Ctrl+drag to orbit · two fingers to turn and tilt · double-click to zoom in. <button type="button">Got it</button>'
      : '<b>Moverse en 3D</b> Arrastra para desplazar · clic derecho o Ctrl+arrastrar para orbitar · dos dedos para girar e inclinar · doble clic para acercar. <button type="button">Entendido</button>';
    map.getContainer().appendChild(el);
    function close() { el.remove(); try { localStorage.setItem(key, '1'); } catch (e) {} }
    el.querySelector('button').addEventListener('click', close);
    map.once('rotatestart', close);
    map.once('pitchstart', function () { setTimeout(close, 1200); });
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
    var pitch0 = opts.pitch != null ? opts.pitch : (reduced ? 0 : 52);
    var bearing0 = opts.bearing != null ? opts.bearing : (reduced ? 0 : -18);
    var exaggeration = opts.exaggeration != null ? opts.exaggeration : 1.35;
    return loadBase().then(function (base) {
      var stateBounds = base && base.bounds ? base.bounds : [[STATE[0], STATE[1]], [STATE[2], STATE[3]]];
      // Room to pull back: a tight box forces the zoom up and cuts Los Cabos off when the view is tilted.
      var pad = 2.2;
      var map = new maplibregl.Map({
        container: opts.container,
        style: styleSpec(base),
        bounds: stateBounds,
        fitBoundsOptions: { padding: 24, pitch: pitch0, bearing: bearing0 },
        pitch: pitch0,
        bearing: bearing0,
        maxPitch: 82,
        minZoom: 6.15,
        maxZoom: 17,
        // Sharp on high-density screens, smooth volume edges.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        // MSAA only where it pays: desktop screens at normal density. High-DPI and touch screens are already
        // sharp at pixelRatio 2, and MSAA costs real time on modest GPUs.
        canvasContextAttributes: { antialias: (window.devicePixelRatio || 1) < 2 && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) },
        fadeDuration: 180,
        maxBounds: [[stateBounds[0][0] - pad, stateBounds[0][1] - pad], [stateBounds[1][0] + pad, stateBounds[1][1] + pad]],
        maxBoundsViscosity: 0.85,
        attributionControl: true,
        dragRotate: !reduced,
        touchPitch: !reduced,
        cooperativeGestures: false,
      });
      if (opts.tools !== false) {
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
        if (!reduced) map.addControl(orbitControl(map), 'top-right');
      }
      var stateBox = (base && base.bounds)
        ? [base.bounds[0][0], base.bounds[0][1], base.bounds[1][0], base.bounds[1][1]]
        : STATE;
      var cache = {};
      var stateRing = [];
      (function () {
        var g = base && base.boundary && base.boundary.features && base.boundary.features[0] && base.boundary.features[0].geometry;
        var polys = !g ? [] : g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
        polys.forEach(function (poly) {
          var ring = poly && poly[0];
          if (!ring || ring.length < 40) return; // islands do not set the frame
          var step = Math.max(1, Math.floor(ring.length / 220));
          for (var i = 0; i < ring.length; i += step) stateRing.push(ring[i]);
        });
      })();
      function boxRing(b) {
        var pts = [];
        for (var i = 0; i <= 4; i++) {
          var fx = b[0] + (b[2] - b[0]) * i / 4;
          var fy = b[1] + (b[3] - b[1]) * i / 4;
          pts.push([fx, b[1]], [fx, b[3]], [b[0], fy], [b[2], fy]);
        }
        return pts;
      }
      // Frame what is drawn, tilted: project the outline, then correct zoom and centre until it fills the view.
      function frame(pts, maxZ) {
        var el = map.getContainer();
        var W = el.clientWidth;
        var H = el.clientHeight;
        // Room for the page chrome that floats over the map (title pill, zoom buttons, attribution).
        var pad = { l: 32, r: 64, t: 58, b: 40 };
        if (opts.fitPadding) {
          try {
            var extra = opts.fitPadding(el.getBoundingClientRect()) || {};
            ['l', 'r', 't', 'b'].forEach(function (k) { if (extra[k] > pad[k]) pad[k] = extra[k]; });
          } catch (e) {}
        }
        if (pad.l + pad.r > W * 0.7) pad.l = pad.r = W * 0.15;
        if (pad.t + pad.b > H * 0.7) pad.t = pad.b = H * 0.15;
        var bearing = reduced ? 0 : map.getBearing();
        var pitch = map.getPitch();
        var prev = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: pitch };
        var b0 = pts.reduce(function (a, c) { return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])]; }, [180, 90, -180, -90]);
        var cam = map.cameraForBounds([[b0[0], b0[1]], [b0[2], b0[3]]], { padding: 24, bearing: bearing });
        if (!cam) return;
        var minZ = map.getMinZoom();
        var z = cam.zoom;
        var center = cam.center;
        for (var it = 0; it < 4; it++) {
          map.jumpTo({ center: center, zoom: z, bearing: bearing, pitch: pitch });
          var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          pts.forEach(function (c) {
            var q = map.project(c);
            if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
            if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
          });
          var sw = (W - pad.l - pad.r) / Math.max(1, x1 - x0);
          var sh = (H - pad.t - pad.b) / Math.max(1, y1 - y0);
          var mid = map.unproject([(x0 + x1) / 2 + (pad.r - pad.l) / 2, (y0 + y1) / 2 + (pad.b - pad.t) / 2]);
          center = [mid.lng, mid.lat];
          z = Math.max(minZ, Math.min(maxZ, z + Math.log2(Math.min(sw, sh)) * 0.85));
        }
        map.jumpTo(prev);
        map.easeTo({ center: center, zoom: z, bearing: bearing, pitch: pitch, duration: reduced ? 0 : 650 });
      }
      function fitBox(b) {
        map.resize();
        if (b && b.length === 4) frame(boxRing(b), 10);
        else frame(stateRing.length ? stateRing : boxRing(stateBox), 10);
      }
      var muniBase = (base && base.municipalities) || { type: 'FeatureCollection', features: [] };
      var lastHeights = {};
      function applyHeights(heights) {
        lastHeights = heights || {};
        var fc = JSON.parse(JSON.stringify(muniBase));
        (fc.features || []).forEach(function (f) {
          if (!f.properties) f.properties = {};
          var h = lastHeights[f.properties.name];
          f.properties.h = h > 0 ? h : 0;
        });
        if (map.getSource('munis')) map.getSource('munis').setData(fc);
      }
      function pointInRing(ring, x, y) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var xi = ring[i][0];
          var yi = ring[i][1];
          var xj = ring[j][0];
          var yj = ring[j][1];
          if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
      }
      function pointInFeature(feature, x, y) {
        var g = feature && feature.geometry;
        if (!g) return false;
        var polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
        for (var p = 0; p < polys.length; p++) {
          var poly = polys[p];
          if (!poly || !poly[0] || !pointInRing(poly[0], x, y)) continue;
          var hole = false;
          for (var h = 1; h < poly.length; h++) if (pointInRing(poly[h], x, y)) hole = true;
          if (!hole) return true;
        }
        return false;
      }
      function anchorOf(feature) {
        var g = feature && feature.geometry;
        if (!g) return null;
        var polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
        var ring = null;
        var best = 0;
        polys.forEach(function (poly) {
          var outer = poly && poly[0];
          if (outer && outer.length > best) { best = outer.length; ring = outer; }
        });
        if (!ring || ring.length < 4) return null;
        var minX = 180;
        var minY = 90;
        var maxX = -180;
        var maxY = -90;
        ring.forEach(function (c) {
          if (c[0] < minX) minX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] > maxY) maxY = c[1];
        });
        var pick = null;
        var pickD = -1;
        var steps = 22;
        for (var iy = 1; iy < steps; iy++) {
          for (var ix = 1; ix < steps; ix++) {
            var x = minX + (maxX - minX) * ix / steps;
            var y = minY + (maxY - minY) * iy / steps;
            if (!pointInFeature(feature, x, y)) continue;
            var dMin = 1e9;
            for (var k = 0; k < ring.length; k += 4) {
              var dx = ring[k][0] - x;
              var dy = ring[k][1] - y;
              var d = dx * dx + dy * dy;
              if (d < dMin) dMin = d;
            }
            if (dMin > pickD) { pickD = dMin; pick = [x, y]; }
          }
        }
        return pick;
      }
      function setPopulationBars(heights) {
        var feats = [];
        if (heights) {
          (muniBase.features || []).forEach(function (f) {
            var name = f.properties && f.properties.name;
            var h = name ? heights[name] : 0;
            if (!(h > 0)) return;
            var c = anchorOf(f);
            if (!c) return;
            var d = 0.055;
            feats.push({
              type: 'Feature',
              properties: { name: name, h: h },
              geometry: { type: 'Polygon', coordinates: [[
                [c[0] - d, c[1] - d],
                [c[0] + d, c[1] - d],
                [c[0] + d, c[1] + d],
                [c[0] - d, c[1] + d],
                [c[0] - d, c[1] - d],
              ]] },
            });
          });
        }
        var src = map.getSource('bars');
        if (src) src.setData({ type: 'FeatureCollection', features: feats });
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
        if (meta.extrude) {
          // Blocks rise by a published figure (meta.extrude). A blank cell stays low and grey: it is not zero.
          var v = ['get', meta.extrude];
          var known = ['!=', v, null];
          map.addLayer({
            id: lid, type: 'fill-extrusion', source: src, minzoom: meta.minzoom || 9,
            paint: {
              'fill-extrusion-color': ['case', known,
                ['interpolate', ['linear'], v, 0, '#efe6cf', 25, '#d9e9f2', 100, '#7ec8e8', 300, '#0083C4', 1000, '#0b3a56'],
                '#cfc8b8'],
              'fill-extrusion-height': ['case', known,
                ['interpolate', ['linear'], v, 0, 4, 50, 45, 200, 140, 600, 260, 2000, 320],
                3],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.9,
              'fill-extrusion-vertical-gradient': true,
            },
          });
          map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
          return lid;
        }
        if (point) {
          map.addLayer({
            id: lid, type: 'circle', source: src,
            paint: {
              'circle-radius': CIRCLE_R,
              'circle-color': meta.color || '#0083C4',
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-pitch-alignment': 'map',
            },
          });
        } else if (line) {
          map.addLayer({
            id: lid + '-case', type: 'line', source: src,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#fbf8f0', 'line-width': CASE_W, 'line-opacity': 0.85 },
          });
          map.addLayer({
            id: lid, type: 'line', source: src,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': meta.color || '#0083C4', 'line-width': LINE_W, 'line-opacity': 0.92 },
          });
        } else {
          map.addLayer({
            id: lid, type: 'fill', source: src,
            paint: {
              'fill-color': meta.color || '#0083C4',
              'fill-opacity': 0.28,
              'fill-outline-color': meta.color || '#0083C4',
            },
          }, 'cdt-muni-fill');
          map.addLayer({
            id: lid + '-edge', type: 'line', source: src,
            paint: { 'line-color': meta.color || '#0083C4', 'line-width': 1.6, 'line-opacity': 0.95 },
          });
        }
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
        if (map.getLayer(lid + '-edge')) {
          map.on('mouseenter', lid + '-edge', function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', lid + '-edge', function () { map.getCanvas().style.cursor = ''; });
        }
        return lid;
      }
      function hide(id) {
        var lid = 'cdt-ly-' + id;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', 'none');
        if (map.getLayer(lid + '-edge')) map.setLayoutProperty(lid + '-edge', 'visibility', 'none');
        if (map.getLayer(lid + '-case')) map.setLayoutProperty(lid + '-case', 'visibility', 'none');
      }
      function tagPoer(geo) {
        if (!geo || !geo.features) return geo;
        geo.features.forEach(function (f) {
          if (!f.properties) f.properties = {};
          var clas = String(f.properties.CLASIFICAC || '');
          var m = clas.match(/_(AS|PT|PR|RT)$/);
          f.properties.politica = m ? m[1] : 'OTRA';
        });
        return geo;
      }
      function show(id, geo, meta, mode) {
        if (id === 'poer_ugas') geo = tagPoer(geo);
        var lid = ensure(id, geo, meta);
        if (id === 'poer_ugas' && map.getSource('cdt-src-' + id)) map.getSource('cdt-src-' + id).setData(geo);
        var vis = mode === 'off' ? 'none' : 'visible';
        map.setLayoutProperty(lid, 'visibility', vis);
        if (map.getLayer(lid + '-edge')) map.setLayoutProperty(lid + '-edge', 'visibility', vis);
        if (map.getLayer(lid + '-case')) map.setLayoutProperty(lid + '-case', 'visibility', vis);
        if (meta.extrude) return;
        var point = meta.type === 'point' || meta.type === 'points';
        var line = meta.type === 'line';
        if (point) {
          map.setPaintProperty(lid, 'circle-radius', mode === 'compare' ? circleR(1.25) : CIRCLE_R);
          map.setPaintProperty(lid, 'circle-stroke-width', mode === 'compare' ? 3 : 1.4);
          map.setPaintProperty(lid, 'circle-stroke-color', mode === 'compare' ? '#0b3a56' : '#ffffff');
        } else if (line) {
          map.setPaintProperty(lid, 'line-width', mode === 'compare' ? lineW(1.5) : LINE_W);
        } else if (id === 'poer_ugas') {
          var poerColor = ['match', ['get', 'politica'], 'AS', '#2d6a4f', 'PT', '#6b3fa0', 'PR', '#d4a017', 'RT', '#c0392b', '#8d99ae'];
          map.setPaintProperty(lid, 'fill-color', poerColor);
          map.setPaintProperty(lid, 'fill-opacity', mode === 'compare' ? 0.62 : 0.5);
          map.setPaintProperty(lid, 'fill-outline-color', poerColor);
          if (map.getLayer(lid + '-edge')) map.setPaintProperty(lid + '-edge', 'line-color', '#1a1a1a');
        } else {
          map.setPaintProperty(lid, 'fill-opacity', mode === 'compare' ? 0.4 : 0.28);
        }
      }
      function load(meta) {
        if (cache[meta.id]) return Promise.resolve(cache[meta.id]);
        return loadGeo(meta).then(function (geo) {
          cache[meta.id] = geo;
          return geo;
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
        if (opts.tools === false) return;
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
      function onMuniClick(e) {
        var f = e.features && e.features[0];
        var name = f && f.properties && f.properties.name;
        if (name && opts.onMunicipality) opts.onMunicipality(name);
      }
      function featureLayers() {
        var style = map.getStyle();
        var ids = [];
        ((style && style.layers) || []).forEach(function (layer) {
          var id = layer.id;
          if (id === 'cdt-muni-fill' || id === 'cdt-muni-extrude' || id === 'cdt-bars' || id.indexOf('cdt-ly-') === 0 || id.indexOf('cdt-bld-') === 0) ids.push(id);
        });
        return ids.filter(function (id) { return map.getLayer(id); });
      }
      var marker = null;
      var reliefOn = true;
      var basemapMode = 'relief';
      function syncHills() {
        if (!map.getLayer('hills')) return;
        var sat = map.getLayer('basemap-sat') && map.getLayoutProperty('basemap-sat', 'visibility') === 'visible';
        map.setLayoutProperty('hills', 'visibility', reliefOn ? 'visible' : 'none');
        map.setPaintProperty('hills', 'hillshade-exaggeration', sat
          ? ['interpolate', ['linear'], ['zoom'], 6, 0.45, 10, 0.3]
          : ['interpolate', ['linear'], ['zoom'], 6, 0.9, 10, 0.55]);
        if (map.getLayer('cdt-tint')) map.setPaintProperty('cdt-tint', 'color-relief-opacity', sat ? 0 : basemapMode === 'streets' ? 0.25 : 0.85);
      }
      function setTerrain(on, ex) {
        reliefOn = !!on;
        if (on) map.setTerrain({ source: 'dem', exaggeration: ex || exaggeration });
        else map.setTerrain(null);
        syncHills();
      }
      function setMuniWash(opacity) {
        if (map.getLayer('cdt-muni-fill')) map.setPaintProperty('cdt-muni-fill', 'fill-opacity', opacity);
      }
      function setExtrudeOpacity(opacity) {
        if (map.getLayer('cdt-muni-extrude')) map.setPaintProperty('cdt-muni-extrude', 'fill-extrusion-opacity', opacity);
      }
      function setPitch(pitch, bearing) {
        map.easeTo({
          pitch: pitch,
          bearing: bearing != null ? bearing : map.getBearing(),
          duration: reduced ? 0 : 700,
        });
      }
      var ICLUSTER = {
        uso: 'cimp100',
        parcelas: 'cspyde100',
      };
      function iclusterTiles(layer) {
        return ['/api/icluster-wms?layers=' + layer + '&bbox={bbox-epsg-3857}'];
      }
      function setIcluster(kind, on) {
        var layer = ICLUSTER[kind];
        if (!layer) return;
        var src = 'icluster-src-' + kind;
        var lid = 'icluster-ly-' + kind;
        if (!map.getSource(src)) {
          map.addSource(src, {
            type: 'raster',
            tiles: iclusterTiles(layer),
            tileSize: 256,
            attribution: 'IMPLAN Los Cabos / SIG BCS / INEGI',
          });
        }
        if (!map.getLayer(lid)) {
          var before = map.getLayer('cdt-muni-line') ? 'cdt-muni-line' : undefined;
          map.addLayer({
            id: lid,
            type: 'raster',
            source: src,
            paint: { 'raster-opacity': kind === 'parcelas' ? 0.95 : 0.82 },
          }, before);
        }
        map.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none');
      }
      function setBasemap(mode) {
        var sat = mode === 'satellite';
        var streets = mode === 'streets';
        if (map.getLayer('basemap-sat')) map.setLayoutProperty('basemap-sat', 'visibility', sat ? 'visible' : 'none');
        if (map.getLayer('basemap-osm')) map.setLayoutProperty('basemap-osm', 'visibility', streets ? 'visible' : 'none');
        if (map.getLayer('land')) map.setPaintProperty('land', 'fill-opacity', sat ? 0 : streets ? 0.16 : 0.9);
        if (map.getLayer('bcs-land')) map.setPaintProperty('bcs-land', 'fill-opacity', sat ? 0.04 : streets ? 0.18 : 1);
        map.getContainer().setAttribute('data-sat', sat ? '1' : '0');
        // Street tiles carry their own names and colours: no tint, no second set of labels.
        map.getContainer().setAttribute('data-base', sat ? 'satellite' : streets ? 'streets' : 'relief');
        basemapMode = mode;
        syncHills();
      }
      function mark(lng, lat, label) {
        if (marker) { marker.remove(); marker = null; }
        if (lng == null || lat == null) return;
        var el = document.createElement('div');
        el.className = 'cdt-pin';
        el.textContent = label || '';
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
      }
      map.on('click', function (e) {
        // An orbit drag ends with a mouseup: it is not a click on the map.
        if (map.__orbitDragAt && Date.now() - map.__orbitDragAt < 400) return;
        var layers = featureLayers();
        var feats = layers.length ? map.queryRenderedFeatures(e.point, { layers: layers }) : [];
        if (opts.onFeature) {
          opts.onFeature(feats, { lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
          return;
        }
        var muniHit = feats.filter(function (f) {
          var id = f.layer && f.layer.id;
          return id === 'cdt-muni-fill' || id === 'cdt-muni-extrude' || id === 'cdt-bars';
        })[0];
        if (muniHit) onMuniClick({ features: [muniHit] });
      });
      map.on('mouseenter', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = ''; });
      function addTint() {
        // Hypsometric tint from the same DEM (MapLibre >= 5.6). Sea level was flattened to 0 m.
        try {
          if (map.getLayer('cdt-tint')) return;
          if (!map.getSource('tint')) map.addSource('tint', Object.assign({}, styleSpec(null).sources.dem));
          map.addLayer({
            id: 'cdt-tint', type: 'color-relief', source: 'tint',
            paint: {
              'color-relief-opacity': 0.85,
              'color-relief-color': ['interpolate', ['linear'], ['elevation'],
                0, 'rgba(236,230,212,0)', 40, '#ece5d1', 250, '#e3d8bc', 600, '#d6c5a0',
                1100, '#c3ab84', 1700, '#ad9270', 2200, '#987e62'],
            },
          }, 'hills');
        } catch (e) { /* older engine: hillshade alone */ }
      }
      var zTier = 0;
      function syncTier() {
        var z = map.getZoom();
        var tier = z < 8 ? 1 : 2;
        if (tier === zTier) return;
        zTier = tier;
        map.getContainer().setAttribute('data-ztier', String(tier));
      }
      var placeEls = [];
      // Larger places first: a name that would overlap one already drawn waits for more zoom.
      function declutter() {
        var box = map.getContainer().getBoundingClientRect();
        var taken = [];
        placeEls.forEach(function (el) {
          el.classList.remove('is-hid');
          var r = el.getBoundingClientRect();
          if (!r.width) return;
          var out = r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom;
          var hit = taken.some(function (q) { return r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 2 && r.bottom > q.top - 2; });
          if (out || hit) el.classList.add('is-hid');
          else taken.push(r);
        });
      }
      function addPlaces() {
        if (opts.places === false) return;
        injectCss();
        syncTier();
        map.on('zoom', syncTier);
        fetch('/gis/osm_towns.geojson').then(function (r) { return r.ok ? r.json() : null; }).then(function (geo) {
          if (!geo || removed) return;
          var rows = (geo.features || []).map(function (f) {
            var p = f.properties || {};
            return { name: p.name, pop: Number(String(p.population || '').replace(/[^0-9]/g, '')) || 0, c: f.geometry && f.geometry.coordinates };
          }).filter(function (r) { return r.name && r.pop > 0 && r.c; });
          rows.sort(function (a, b) { return b.pop - a.pop; });
          rows.slice(0, 18).forEach(function (r) {
            var el = document.createElement('div');
            el.className = 'cdt-place ' + (r.pop >= 100000 ? 't1' : r.pop >= 8000 ? 't2' : 't3');
            el.textContent = r.name.replace(/^Villa Alberto Andrés Alvarado Arámburo \((.+)\)$/, '$1');
            el.setAttribute('aria-hidden', 'true');
            new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(r.c).addTo(map);
            placeEls.push(el);
          });
          declutter();
          map.on('moveend', declutter);
          map.on('zoomend', declutter);
        }).catch(function () {});
      }
      // Real buildings: one GeoJSON per city, added only when the view reaches it.
      var bld = { on: false, index: null, added: {} };
      var BLD_MINZ = 12.5;
      function bldColor() {
        return ['step', ['get', 'n'], '#ebe4d3', 2, '#ddd0b5', 3, '#cbb795', 5, '#ad916c', 10, '#7d6650'];
      }
      function bldSync() {
        if (!bld.on || !bld.index) return;
        var b = map.getBounds();
        var z = map.getZoom();
        bld.index.cities.forEach(function (c) {
          var hit = !(c.bbox[2] < b.getWest() || c.bbox[0] > b.getEast() || c.bbox[3] < b.getSouth() || c.bbox[1] > b.getNorth());
          var lid = 'cdt-bld-' + c.id;
          if (hit && z >= BLD_MINZ - 0.5 && !bld.added[c.id]) {
            bld.added[c.id] = true;
            map.addSource('bld-' + c.id, { type: 'geojson', data: c.url });
            map.addLayer({
              id: lid, type: 'fill-extrusion', source: 'bld-' + c.id, minzoom: BLD_MINZ,
              paint: {
                'fill-extrusion-color': bldColor(),
                'fill-extrusion-height': ['get', 'h'],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], BLD_MINZ, 0, BLD_MINZ + 0.6, 0.96],
                'fill-extrusion-vertical-gradient': true,
              },
            });
            map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
          }
          if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', 'visible');
        });
      }
      function setBuildings(on) {
        bld.on = !!on;
        if (!on) {
          Object.keys(bld.added).forEach(function (id) { if (map.getLayer('cdt-bld-' + id)) map.setLayoutProperty('cdt-bld-' + id, 'visibility', 'none'); });
          return Promise.resolve(null);
        }
        var wait = bld.index ? Promise.resolve(bld.index) : fetch('/gis/edificios/index.json').then(function (r) { return r.ok ? r.json() : null; });
        return wait.then(function (ix) {
          if (!ix) return null;
          bld.index = ix;
          bldSync();
          return ix;
        }).catch(function () { return null; });
      }
      map.on('moveend', bldSync);
      var removed = false;
      return new Promise(function (resolve, reject) {
        var settled = false;
        map.on('load', function () {
          if (settled) return;
          settled = true;
          bindTools();
          addTint();
          addPlaces();
          injectCss();
          if (opts.tools !== false && !reduced) navHint(map);
          syncHills();
          if (exaggeration !== 1.35) map.setTerrain({ source: 'dem', exaggeration: exaggeration });
          fitBox(null);
          if (!base || !base.municipalities) {
            fetch('/gis/osm_municipalities.geojson').then(function (r) { return r.json(); }).then(function (geo) {
              muniBase = geo;
              applyHeights(lastHeights);
            }).catch(function () {});
          } else {
            applyHeights(lastHeights);
          }
          resolve({
            kind: '3d',
            fitBox: fitBox,
            resize: function () { map.resize(); },
            paintMunis: paintMunis,
            setExtrusion: applyHeights,
            setPopulationBars: setPopulationBars,
            show: show,
            hide: hide,
            load: load,
            setBasemap: setBasemap,
            setIcluster: setIcluster,
            setTerrain: setTerrain,
            setMuniWash: setMuniWash,
            setExtrudeOpacity: setExtrudeOpacity,
            setPitch: setPitch,
            getPitch: function () { return map.getPitch(); },
            mark: mark,
            getBounds: function () {
              var b = map.getBounds();
              return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
            },
            getZoom: function () { return map.getZoom(); },
            setBuildings: setBuildings,
            readCamera: function () {
              var c = map.getCenter();
              return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
            },
            jumpCamera: function (cam) {
              if (removed || !cam) return;
              map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
            },
            watchMove: function (fn) { map.on('move', fn); },
            destroy: function () {
              removed = true;
              try { map.remove(); } catch (e) {}
            },
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
        setTimeout(function () { if (!settled) fail(new Error('timeout')); }, 35000);
      });
    });
  }

  window.CDT3D = { hasWebGL: hasWebGL, start: start };
})();
