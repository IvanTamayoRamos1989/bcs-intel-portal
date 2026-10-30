/* Fotos del territorio inside the 3D atlas: georeferenced aerial photos (public/stills) as a
   toggleable point layer with thumbnail popups, a link to /stills and Google Maps links. */
(() => {
  'use strict';
  const URL_PHOTOS = '/stills/stills.geojson';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let on = false, added = false, loading = null, popup = null;
  const api = () => window.BCSExplorar;
  const map = () => api()?.state?.map;
  function setBtn() {
    const b = document.getElementById('ex-photos-toggle'); if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    const row = document.getElementById('ex-photos-row'); if (row) row.classList.toggle('is-active', on);
    const sr = b.querySelector('.sr-only'); if (sr) sr.textContent = on ? 'Ocultar capa' : 'Mostrar capa';
  }
  async function ensure() {
    const m = map(); if (!m) return false;
    if (added) return true;
    if (!loading) loading = fetch(URL_PHOTOS).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const data = await loading;
    if (!m.getSource('fotos')) m.addSource('fotos', { type: 'geojson', data });
    if (!m.getLayer('fotos-pt')) m.addLayer({ id: 'fotos-pt', type: 'circle', source: 'fotos', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 11, 7],
      'circle-color': '#c45c26', 'circle-stroke-color': '#fbf8f1', 'circle-stroke-width': 1.4, 'circle-opacity': 0.92 } });
    added = true;
    m.on('mouseenter', 'fotos-pt', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'fotos-pt', () => { m.getCanvas().style.cursor = ''; });
    return true;
  }
  function popupHTML(p) {
    const lat = Number(p.lat), lon = Number(p.lon), q = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return `<div class="ex-photo-pop">
      ${p.thumb ? `<a href="${esc(p.image || p.thumb)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" /></a>` : ''}
      <strong>${esc(p.name)}</strong>${p.municipio ? `<span>${esc(p.municipio)}</span>` : ''}
      <div class="ex-photo-actions">
        <a href="/stills">Ver todas las fotos</a>
        <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Abrir en Google Maps</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener">Cómo llegar</a>
      </div></div>`;
  }
  window.__exPhotoHit = e => {
    const m = map(); if (!on || !m || !m.getLayer('fotos-pt')) return false;
    const r = innerWidth <= 760 ? 12 : 6;
    const f = m.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['fotos-pt'] })[0];
    if (!f) return false;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: '260px', offset: 10 }).setLngLat(f.geometry.coordinates).setHTML(popupHTML(f.properties)).addTo(m);
    return true;
  };
  async function toggle(want) {
    on = want; setBtn();
    try {
      if (on && !(await ensure())) { on = false; setBtn(); return; }
      const m = map(); if (m && m.getLayer('fotos-pt')) m.setLayoutProperty('fotos-pt', 'visibility', on ? 'visible' : 'none');
      if (!on && popup) popup.remove();
    } catch (_) { on = false; setBtn(); }
  }
  function boot() {
    const b = document.getElementById('ex-photos-toggle'); if (!b) return;
    b.addEventListener('click', () => toggle(!on));
    if (new URLSearchParams(location.search).get('fotos') === '1') {
      const t = setInterval(() => { if (api()?.state?.ready) { clearInterval(t); toggle(true); } }, 400);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
