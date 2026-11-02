/* Source links are evidence; keyword matches are only suggestions. */
(function (root) {
  function safeLink(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var text = value.trim();
    if (text.indexOf('\\') !== -1) return null;
    if (/^\/(?!\/)/.test(text)) return text;
    try { var u = new URL(text); return /^https?:$/.test(u.protocol) ? u.href : null; }
    catch (_) { return null; }
  }
  function sources(items) {
    var seen = new Set();
    return (items || []).filter(Boolean).map(function (s) {
      var title = String(s.title || 'Documento fuente');
      var href = [s.drive_url, s.view_url, s.href, s.url, s.catalog_url].map(safeLink).find(Boolean);
      var direct = !!href;
      href = href || '/catalogo/?q=' + encodeURIComponent(title);
      if (seen.has(href)) return null;
      seen.add(href);
      return { title: title, href: href, direct: direct, row: [title, 'sources', '', href, 'd', ''] };
    }).filter(Boolean);
  }
  root.ShellEvidence = { safeLink: safeLink, sources: sources };
})(typeof window !== 'undefined' ? window : globalThis);
