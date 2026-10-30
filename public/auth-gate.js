/**
 * Soft client gate for link-only privacy.
 * Password is never stored here — only checks session via /api/auth GET
 * (httpOnly cookie) and redirects unauthenticated users to /.
 * Landing (/) is always allowed.
 */
(function () {
  var path = location.pathname.replace(/\/$/, '') || '/';
  if (path === '/') return;

  // Avoid flashing gated content: hide until check completes
  try {
    document.documentElement.style.visibility = 'hidden';
  } catch (e) {}

  function show() {
    try {
      document.documentElement.style.visibility = '';
    } catch (e) {}
  }

  function goLanding() {
    location.replace('/');
  }

  fetch('/api/auth', { method: 'GET', credentials: 'same-origin' })
    .then(function (r) {
      return r.json().catch(function () {
        return { ok: false };
      });
    })
    .then(function (data) {
      if (data && data.ok) {
        show();
      } else {
        goLanding();
      }
    })
    .catch(function () {
      // If auth endpoint unreachable, still hide gated pages
      goLanding();
    });
})();
