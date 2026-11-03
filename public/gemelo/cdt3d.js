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
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      light: {
        anchor: 'viewport',
        color: '#fffaf2',
        intensity: 0.62,
        position: [1.35, 210, 28],
      },
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
        { id: 'cdt-bars', type: 'fill-extrusion', source: 'bars', filter: ['==', ['geometry-type'], 'Polygon'], paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 8000, '#f59e0b', 28000, '#b45309'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-vertical-gradient': true,
        } },
        { id: 'coast', type: 'line', source: 'bcs', paint: { 'line-color': '#5f7f8c', 'line-width': 1.1 } },
      ],
      terrain: { source: 'dem', exaggeration: 1.35 },
      sky: {
        'sky-color': '#c5dff2',
        'horizon-color': '#f6f3ea',
        'fog-color': '#d5e6ee',
        'fog-ground-blend': 0.42,
        'horizon-fog-blend': 0.58,
        'sky-horizon-blend': 0.72,
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
    var pitch0 = opts.pitch != null ? opts.pitch : (reduced ? 0 : 52);
    var bearing0 = opts.bearing != null ? opts.bearing : (reduced ? 0 : -18);
    var exaggeration = opts.exaggeration != null ? opts.exaggeration : 1.35;
    return loadBase().then(function (base) {
      var stateBounds = base && base.bounds ? base.bounds : [[STATE[0], STATE[1]], [STATE[2], STATE[3]]];
      var pad = 0.45;
      function framePadding(pitch) {
        if (pitch < 18) return 22;
        return { top: 18, bottom: Math.round(24 + pitch * 0.9), left: 16, right: 16 };
      }
      var map = new maplibregl.Map({
        container: opts.container,
        style: styleSpec(base),
        bounds: stateBounds,
        fitBoundsOptions: { padding: framePadding(pitch0), pitch: pitch0, bearing: bearing0 },
        pitch: pitch0,
        bearing: bearing0,
        maxPitch: 75,
        antialias: !reduced,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        minZoom: 6.15,
        maxZoom: 14,
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
          padding: framePadding(map.getPitch()),
          pitch: map.getPitch(),
          bearing: reduced ? 0 : map.getBearing(),
          duration: reduced ? 0 : 650,
          maxZoom: 10.5,
        });
      }
      var muniBase = (base && base.municipalities) || { type: 'FeatureCollection', features: [] };
      var lastHeights = {};
      var barsEnabled = false;
      function applyHeights(heights) {
        lastHeights = heights || {};
        var fc = JSON.parse(JSON.stringify(muniBase));
        (fc.features || []).forEach(function (f) {
          if (!f.properties) f.properties = {};
          var h = lastHeights[f.properties.name];
          f.properties.h = h > 0 ? h : 0;
        });
        if (map.getSource('munis')) map.getSource('munis').setData(fc);
        if (barsEnabled) setPopulationBars(lastHeights);
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
      function buildListingPrisms(geo) {
        var feats = [];
        ((geo && geo.features) || []).forEach(function (f) {
          var g = f && f.geometry;
          if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
          var lng = Number(g.coordinates[0]);
          var lat = Number(g.coordinates[1]);
          if (!isFinite(lng) || !isFinite(lat)) return;
          var p = Object.assign({}, f.properties || {});
          p.height_m = Number(p.height_m) > 0 ? Number(p.height_m) : 120;
          var d = 0.0038;
          feats.push({
            type: 'Feature',
            properties: p,
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [lng - d, lat - d],
                [lng + d, lat - d],
                [lng + d, lat + d],
                [lng - d, lat + d],
                [lng - d, lat - d],
              ]],
            },
          });
        });
        return { type: 'FeatureCollection', features: feats };
      }
      var listingTypeColor = [
        'match', ['get', 'propertyType'],
        'RESIDENTIAL', '#f59e0b',
        'CONDO', '#0ea5e9',
        'LAND', '#10b981',
        'MULTI_FAMILY', '#8b5cf6',
        '#ec4899'
      ];
      var PLACE_LABEL = { osm_towns: 1, settlements: 1, focus_ports_air: 1 };
      function ensurePlaceLabel(id, src) {
        if (!PLACE_LABEL[id]) return;
        var lid = 'cdt-ly-' + id + '-label';
        if (map.getLayer(lid)) return;
        map.addLayer({
          id: lid,
          type: 'symbol',
          source: src,
          layout: {
            'text-field': ['coalesce', ['get', 'name'], ['get', 'name_es'], ''],
            'text-font': ['Open Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 11, 14],
            'text-offset': [0, 0.85],
            'text-anchor': 'top',
            'text-max-width': 10,
            'text-padding': 2,
            'text-allow-overlap': false,
            'text-optional': true,
          },
          paint: {
            'text-color': '#0b3a56',
            'text-halo-color': '#fbf8f1',
            'text-halo-width': 1.3,
          },
        });
      }
      function ensure(id, geo, meta) {
        var src = 'cdt-src-' + id;
        var lid = 'cdt-ly-' + id;
        if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: geo });
        if (id === 'bcs_market_listings' && !map.getSource(src + '-3d')) {
          map.addSource(src + '-3d', { type: 'geojson', data: buildListingPrisms(geo) });
        }
        if (map.getLayer(lid)) return lid;
        var point = meta.type === 'point' || meta.type === 'points';
        var line = meta.type === 'line';
        if (point) {
          if (id === 'bcs_market_listings' && !map.getLayer(lid + '-3d')) {
            map.addLayer({
              id: lid + '-3d',
              type: 'fill-extrusion',
              source: src + '-3d',
              paint: {
                'fill-extrusion-color': listingTypeColor,
                'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 120],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.86,
                'fill-extrusion-vertical-gradient': true,
              },
            });
          }
          map.addLayer({
            id: lid, type: 'circle', source: src,
            paint: {
              'circle-radius': id === 'bcs_market_listings' ? 6.5 : 5.5,
              'circle-color': id === 'bcs_market_listings' ? listingTypeColor : (meta.color || '#0083C4'),
              'circle-stroke-width': 1.4,
              'circle-stroke-color': '#ffffff',
              'circle-pitch-alignment': 'map',
            },
          });
        } else if (line) {
          map.addLayer({
            id: lid, type: 'line', source: src,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': meta.color || '#0083C4', 'line-width': 2.2, 'line-opacity': 0.95 },
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
        ensurePlaceLabel(id, src);
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
        if (map.getLayer(lid + '-3d')) {
          map.on('mouseenter', lid + '-3d', function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', lid + '-3d', function () { map.getCanvas().style.cursor = ''; });
        }
        if (map.getLayer(lid + '-edge')) {
          map.on('mouseenter', lid + '-edge', function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', lid + '-edge', function () { map.getCanvas().style.cursor = ''; });
        }
        return lid;
      }
      function hide(id) {
        var lid = 'cdt-ly-' + id;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', 'none');
        if (map.getLayer(lid + '-3d')) map.setLayoutProperty(lid + '-3d', 'visibility', 'none');
        if (map.getLayer(lid + '-edge')) map.setLayoutProperty(lid + '-edge', 'visibility', 'none');
        if (map.getLayer(lid + '-label')) map.setLayoutProperty(lid + '-label', 'visibility', 'none');
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
        if (id === 'bcs_market_listings' && map.getSource('cdt-src-' + id + '-3d')) {
          map.getSource('cdt-src-' + id + '-3d').setData(buildListingPrisms(geo));
        }
        var vis = mode === 'off' ? 'none' : 'visible';
        map.setLayoutProperty(lid, 'visibility', vis);
        if (map.getLayer(lid + '-3d')) map.setLayoutProperty(lid + '-3d', 'visibility', vis);
        if (map.getLayer(lid + '-edge')) map.setLayoutProperty(lid + '-edge', 'visibility', vis);
        if (map.getLayer(lid + '-label')) map.setLayoutProperty(lid + '-label', 'visibility', vis);
        var point = meta.type === 'point' || meta.type === 'points';
        var line = meta.type === 'line';
        if (point) {
          map.setPaintProperty(lid, 'circle-radius', id === 'bcs_market_listings' ? 6.5 : 6);
          map.setPaintProperty(lid, 'circle-stroke-width', mode === 'compare' ? 3 : 1.4);
          map.setPaintProperty(lid, 'circle-stroke-color', mode === 'compare' ? '#0b3a56' : '#ffffff');
        } else if (line) {
          if (id === 'osm_highways') {
            map.setPaintProperty(lid, 'line-width', ['match', ['get', 'highway'], 'motorway', 3.6, 'trunk', 3.1, 'primary', 2.6, 'secondary', 2, 'tertiary', 1.5, 1.15]);
          } else {
            map.setPaintProperty(lid, 'line-width', mode === 'compare' ? 3.4 : 2.2);
          }
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
        var basemapBtn = document.getElementById('cdt-basemap');
        var reliefBtn = document.getElementById('cdt-relief');
        var barsBtn = document.getElementById('cdt-bars-btn');
        var flyBtn = document.getElementById('cdt-fly');
        function syncPitch() {
          label(pitchBtn, map.getPitch() > 8 ? 'Vista cenital' : 'Vista 3D', map.getPitch() > 8 ? 'Top view' : '3D view', map.getPitch() > 8);
        }
        if (pitchBtn) pitchBtn.onclick = function () {
          var flat = map.getPitch() > 8;
          map.easeTo({ pitch: flat ? 0 : 54, duration: reduced ? 0 : 600 });
        };
        if (rot && !reduced) rot.onclick = function () {
          map.easeTo({ bearing: map.getBearing() + 25, duration: 450 });
        };
        if (rot && reduced) rot.hidden = true;
        if (north) north.onclick = function () { map.easeTo({ bearing: 0, duration: reduced ? 0 : 400 }); };
        if (fit) fit.onclick = function () { fitBox(null); };
        var bmModes = ['default', 'satellite', 'streets'];
        var bmIdx = 0;
        if (basemapBtn) basemapBtn.onclick = function () {
          bmIdx = (bmIdx + 1) % bmModes.length;
          var m = bmModes[bmIdx];
          setBasemap(m);
          var es = m === 'satellite' ? 'Base: Satélite' : m === 'streets' ? 'Base: Calles' : 'Base: Relieve';
          var en = m === 'satellite' ? 'Base: Satellite' : m === 'streets' ? 'Base: Streets' : 'Base: Terrain';
          label(basemapBtn, es, en, m !== 'default');
        };
        var exModes = [1.35, 2.5, 0];
        var exIdx = 0;
        if (reliefBtn) reliefBtn.onclick = function () {
          exIdx = (exIdx + 1) % exModes.length;
          var ex = exModes[exIdx];
          setTerrain(ex > 0, ex || 1.35);
          var es = ex === 0 ? 'Relieve: Plano' : 'Relieve: ' + ex + '×';
          var en = ex === 0 ? 'Relief: Flat' : 'Relief: ' + ex + '×';
          label(reliefBtn, es, en, ex > 1.35);
        };
        if (barsBtn) barsBtn.onclick = function () {
          barsEnabled = !barsEnabled;
          setPopulationBars(barsEnabled ? lastHeights : null);
          label(barsBtn, barsEnabled ? 'Columnas 3D: Sí' : 'Columnas 3D', barsEnabled ? '3D Columns: On' : '3D Columns', barsEnabled);
        };
        var flySpots = [
          { es: 'Vuelo: Cabo San Lucas', en: 'Fly: Cabo San Lucas', center: [-109.916, 22.892], zoom: 11.4, pitch: 60, bearing: -28 },
          { es: 'Vuelo: Corredor / SJD', en: 'Fly: Corridor / SJD', center: [-109.735, 23.025], zoom: 11.1, pitch: 58, bearing: 18 },
          { es: 'Vuelo: East Cape', en: 'Fly: East Cape', center: [-109.585, 23.485], zoom: 10.2, pitch: 56, bearing: -15 },
          { es: 'Vuelo: Todos Santos', en: 'Fly: Todos Santos', center: [-110.215, 23.425], zoom: 11.2, pitch: 58, bearing: 32 },
          { es: 'Vuelo: La Paz', en: 'Fly: La Paz', center: [-110.325, 24.155], zoom: 11.0, pitch: 56, bearing: -20 },
          { es: 'Vuelo: Loreto', en: 'Fly: Loreto', center: [-111.345, 25.985], zoom: 10.8, pitch: 58, bearing: -12 },
        ];
        var flyIdx = -1;
        if (flyBtn) flyBtn.onclick = function () {
          flyIdx = (flyIdx + 1) % flySpots.length;
          var sp = flySpots[flyIdx];
          map.flyTo({
            center: sp.center,
            zoom: sp.zoom,
            pitch: reduced ? 0 : sp.pitch,
            bearing: reduced ? 0 : sp.bearing,
            duration: reduced ? 0 : 1400,
          });
          label(flyBtn, sp.es, sp.en, true);
        };
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
          if (id === 'cdt-muni-fill' || id === 'cdt-muni-extrude' || id === 'cdt-bars' || id.indexOf('cdt-ly-') === 0) ids.push(id);
        });
        return ids.filter(function (id) { return map.getLayer(id); });
      }
      var marker = null;
      var reliefOn = true;
      function syncHills() {
        if (!map.getLayer('hills')) return;
        var sat = map.getLayer('basemap-sat') && map.getLayoutProperty('basemap-sat', 'visibility') === 'visible';
        map.setLayoutProperty('hills', 'visibility', reliefOn ? 'visible' : 'none');
        map.setPaintProperty('hills', 'hillshade-exaggeration', sat ? 0.5 : 0.9);
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
      var activePopup = null;
      function escHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      function buildFeaturePopupHtml(feat) {
        var p = (feat && feat.properties) || {};
        var lid = (feat && feat.layer && feat.layer.id) || '';
        if (lid.indexOf('bcs_market_listings') !== -1 || p.propertyType) {
          var typeBadges = {
            RESIDENTIAL: 'Residencial / Casa',
            CONDO: 'Condominio',
            LAND: 'Lote / Terreno',
            MULTI_FAMILY: 'Multifamiliar',
            OTHER: 'Comercial / Otro',
          };
          var badge = typeBadges[p.propertyType] || p.propertyType || 'Propiedad';
          var specs = [];
          if (p.bedrooms) specs.push(escHtml(p.bedrooms) + ' rec.');
          if (p.bathrooms) specs.push(escHtml(p.bathrooms) + ' baños');
          if (p.livingAreaSqft) specs.push(Number(p.livingAreaSqft).toLocaleString('en-US') + ' sq ft');
          var loc = [p.subdivision, p.city, p.municipality].filter(Boolean).join(' · ');
          return (
            '<div style="font-family:system-ui,sans-serif;max-width:250px;line-height:1.35;color:#102a3a">' +
            '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#006BA3;margin-bottom:2px">' + escHtml(badge) + ' · ' + escHtml(p.status || 'Active') + '</div>' +
            '<div style="font-size:14px;font-weight:700;margin-bottom:4px">' + escHtml(p.title || p.name || 'Propiedad BCS') + '</div>' +
            '<div style="font-size:15px;font-weight:800;color:#b45309;margin-bottom:4px">' + escHtml(p.priceFormatted || (p.price ? '$' + Number(p.price).toLocaleString('en-US') + ' USD' : 'Consultar')) + '</div>' +
            (loc ? '<div style="font-size:12px;color:#476273;margin-bottom:4px">' + escHtml(loc) + '</div>' : '') +
            (specs.length ? '<div style="font-size:12px;color:#1e3a4c;background:#f0f7fb;padding:3px 6px;border-radius:6px;margin-bottom:4px">' + specs.join(' · ') + '</div>' : '') +
            '<div style="font-size:11px;color:#64748b">ID: ' + escHtml(p.mlsId || p.id || '') + ' · <a href="/inmobiliario/#catalogo-mls" style="color:#006BA3;font-weight:600">Ver en Inmobiliario</a></div>' +
            '</div>'
          );
        }
        var title = p.name_es || p.name || p.proyecto || p.NOMBRE || p.NOM_NUC || p.UGA_CLAVE || p.ref || '';
        if (!title) return '';
        var sub = p.sector || p.CLASIFICAC || p.CATEG_MANE || p.municipality || p.municipio || '';
        return (
          '<div style="font-family:system-ui,sans-serif;max-width:240px;line-height:1.35;color:#102a3a">' +
          '<div style="font-size:13px;font-weight:700">' + escHtml(title) + '</div>' +
          (sub ? '<div style="font-size:12px;color:#476273;margin-top:2px">' + escHtml(sub) + '</div>' : '') +
          '</div>'
        );
      }
      map.on('click', function (e) {
        var layers = featureLayers();
        var feats = layers.length ? map.queryRenderedFeatures(e.point, { layers: layers }) : [];
        if (opts.onFeature) {
          opts.onFeature(feats, { lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
          return;
        }
        var overlayHit = feats.filter(function (f) {
          var id = f.layer && f.layer.id;
          return id && id.indexOf('cdt-ly-') === 0;
        })[0];
        if (overlayHit && typeof maplibregl !== 'undefined' && maplibregl.Popup) {
          var html = buildFeaturePopupHtml(overlayHit);
          if (html) {
            if (activePopup) activePopup.remove();
            activePopup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
          }
          var hitMuni = overlayHit.properties && (overlayHit.properties.municipality || overlayHit.properties.municipio);
          if (hitMuni && opts.onMunicipality) opts.onMunicipality(hitMuni);
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
      var removed = false;
      return new Promise(function (resolve, reject) {
        var settled = false;
        map.on('load', function () {
          if (settled) return;
          settled = true;
          bindTools();
          if (exaggeration !== 1.35) map.setTerrain({ source: 'dem', exaggeration: exaggeration });
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
