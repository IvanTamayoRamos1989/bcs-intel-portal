# BCS 2050 portal — deploy report

**Prod:** https://bcs-intel-portal.netlify.app  
**Deploy:** live (auth + edge gate + UX redesign)

## Landing URL behavior
- `/` is a public ungated landing: **BAJA CALIFORNIA SUR 2050** brief (ES/EN), sections What this is · Horizon · What the portal holds, password CTA.
- Framing from F+P Vision Outline Programme + GC1 / P20153 Regional Development Strategy BCS 2026–2056 (multi-scalar, carrying capacity; not a single-site destination masterplan). No fee tables on landing.
- Successful auth → `/explorar`. Already-authed visitors on `/` are sent to `/explorar`.
- Former hub cards live at `/explorar` (alias `/inicio` → `/explorar`).
- `noindex, nofollow` + `X-Robots-Tag` on all pages.

## Auth approach
- Password only in Netlify env `BCS_PORTAL_PASSWORD` (production / preview / branch). **Not** hardcoded in client JS.
- `POST /api/auth` → HMAC session cookie `bcs_portal_auth` (httpOnly, Secure, SameSite=Lax) via `BCS_PORTAL_SESSION_SECRET`.
- Edge function `auth-gate` redirects unauthenticated HTML navigations to `/` (static assets + `/` + `/api/*` allowed).
- Soft client gate `auth-gate.js` as backup (checks `GET /api/auth`).
- Chat `POST /api/chat` requires valid cookie (401 otherwise).
- Footer logout → `POST /api/logout` clears cookie.
- Note: static JSON under `/` remains fetchable (soft + edge HTML gate + noindex — link-only privacy, not a hard ACL on assets).

## UX changes
- Brand hierarchy: **BAJA CALIFORNIA SUR 2050** primary; subtitle “Portal de inteligencia territorial”; tiny draft badge.
- Compact sticky header; mobile hamburger → single drawer (Explore/Themes/Place/Evidence); desktop grouped nav + quick links (Catalog, Maps, GIS atlas, Files).
- Chat remains FAB; GIS `/gis-atlas` preserved; Drive-only catalog lead (no Desktop mention); paths normalized via `lakePath()` / word-break.
- `--fp-blue: #0080C0` kept.

## Smoke (prod)
- Wrong password → 401; correct password → cookie + hub; unauth `/catalogo` `/gis-atlas` → 302 `/`; chat without cookie → 401; chat with cookie → 200; password string absent from landing HTML.
