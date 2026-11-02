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
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#6d848c',
          'hillshade-highlight-color': '#fbf8ee',
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
    var pitch0 = opts.pitch != null ? opts.pitch : (reduced ? 0 : 50);
    var bearing0 = reduced ? 0 : -16;
    return loadBase().then(function (base) {
      var stateBounds = base && base.bounds ? base.bounds : [[STATE[0], STATE[1]], [STATE[2], STATE[3]]];
      var pad = 0.45;
      var map = new maplibregl.Map({
        container: opts.container,
        style: styleSpec(base),
        bounds: stateBounds,
        fitBoundsOptions: { padding: 24, pitch: pitch0, bearing: bearing0 },
        pitch: pitch0,
        bearing: bearing0,
        maxPitch: 70,
        minZoom: 6.15,
        maxZoom: 13,
        maxBounds: [[stateBounds[0][0] - pad, stateBounds[0][1] - pad], [stateBounds[1][0] + pad, stateBounds[1][1] + pad]],
        maxBoundsViscosity: 0.85,
        attributionControl: true,
        dragRotate: !reduced,
        touchPitch: !reduced,
        cooperativeGestures: false,
      });
      if (opts.tools !== false) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
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
      var marker = null;
      function setBasemap(mode) {
        var sat = mode === 'satellite';
        var streets = mode === 'streets';
        if (map.getLayer('basemap-sat')) map.setLayoutProperty('basemap-sat', 'visibility', sat ? 'visible' : 'none');
        if (map.getLayer('basemap-osm')) map.setLayoutProperty('basemap-osm', 'visibility', streets ? 'visible' : 'none');
        if (map.getLayer('land')) map.setPaintProperty('land', 'fill-opacity', sat ? 0 : streets ? 0.16 : 0.9);
        if (map.getLayer('bcs-land')) map.setPaintProperty('bcs-land', 'fill-opacity', sat ? 0.04 : streets ? 0.18 : 1);
        if (map.getLayer('hills')) map.setLayoutProperty('hills', 'visibility', sat ? 'none' : 'visible');
      }
      function mark(lng, lat, label) {
        if (marker) { marker.remove(); marker = null; }
        if (lng == null || lat == null) return;
        var el = document.createElement('div');
        el.className = 'cdt-pin';
        el.textContent = label || '';
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
      }
      map.on('click', 'cdt-muni-fill', onMuniClick);
      map.on('click', 'cdt-muni-extrude', onMuniClick);
      map.on('mouseenter', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cdt-muni-fill', function () { map.getCanvas().style.cursor = ''; });
      var removed = false;
      return new Promise(function (resolve, reject) {
        var settled = false;
        map.on('load', function () {
          if (settled) return;
          settled = true;
          bindTools();
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
            show: show,
            hide: hide,
            load: load,
            setBasemap: setBasemap,
            mark: mark,
            getBounds: function () {
              var b = map.getBounds();
              return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
            },
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
        setTimeout(function () { if (!settled) fail(new Error('timeout')); }, 20000);
      });
    });
  }

  window.CDT3D = { hasWebGL: hasWebGL, start: start };
})();
