/**
 * Auth gate: unauthenticated users may only reach the blank landing and auth endpoints.
 * Blocks document navigations (302 → /) and data/asset fetches (401) without a valid cookie.
 * Cookie verified via HMAC using BCS_PORTAL_SESSION_SECRET.
 */
import type { Context } from "https://edge.netlify.com";

const COOKIE = "bcs_portal_auth";

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Paths reachable without a session cookie. No data JSON, no portal pages. */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  // Auth endpoints only (not /api/chat etc.)
  if (
    pathname === "/api/auth" ||
    pathname === "/api/auth/" ||
    pathname === "/api/logout" ||
    pathname === "/api/logout/"
  ) {
    return true;
  }
  // Netlify functions / edge internals (rewrites land here)
  if (pathname.startsWith("/.netlify/")) return true;
  // Client soft-gate script (safe; no secrets)
  if (pathname === "/auth-gate.js") return true;
  return false;
}

/** Prefer 302 for HTML/document navigations; 401 for data/asset requests. */
function wantsHtml(request: Request, pathname: string): boolean {
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "document") return true;
  // Explicit non-document fetches (script, image, empty XHR, etc.)
  if (dest && dest !== "document") return false;

  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (accept.includes("text/html")) return true;
  if (accept.includes("application/json") && !accept.includes("text/html")) return false;

  // GET/HEAD with */* or missing Accept (e.g. curl -I): treat extensionless paths as pages
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    if (pathname.endsWith(".html") || pathname.endsWith("/")) return true;
    if (!/\.[a-z0-9]{1,8}$/i.test(pathname)) return true;
  }
  return false;
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);

  // Always allow CORS preflight to public auth paths; others 403
  if (request.method === "OPTIONS") {
    if (isPublicPath(url.pathname)) return context.next();
    return new Response(null, { status: 403 });
  }

  if (isPublicPath(url.pathname)) {
    return context.next();
  }

  const secret = Deno.env.get("BCS_PORTAL_SESSION_SECRET") || "";
  if (!secret) {
    // Misconfigured: fall through to client soft gate for pages;
    // still block obvious data files from anonymous fetch
    if (/\.(json|geojson)$/i.test(url.pathname) && !wantsHtml(request, url.pathname)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return context.next();
  }

  const token = parseCookie(request.headers.get("cookie"), COOKIE);
  if (token) {
    const expected = `1.${await hmacHex(secret, "bcs-portal-ok")}`;
    if (token === expected) {
      return context.next();
    }
  }

  // Unauthenticated: HTML → landing; everything else → 401 (do not serve data)
  if (wantsHtml(request, url.pathname)) {
    const login = new URL("/", url);
    if (/^\/(inicio|consulta|catalogo)\/?$/.test(url.pathname)) login.searchParams.set("next", url.pathname + url.search);
    return new Response(null, {status: 302, headers: {Location: login.href, "Cache-Control": "no-store"}});
  }

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
