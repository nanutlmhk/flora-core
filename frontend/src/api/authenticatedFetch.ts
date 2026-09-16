import { BACKEND_BASE } from "./backendBase";

const SESSION_KEY = "flora_auth_token";

/** Install once before React mounts so every same-origin Flora API request carries the session. */
export function installAuthenticatedFetch(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    const apiOrigin = new URL(BACKEND_BASE, window.location.href).origin;
    const isFloraApi = (url.origin === window.location.origin || url.origin === apiOrigin) &&
      (url.pathname === "/health" || url.pathname.startsWith("/api/"));
    const token = window.localStorage.getItem(SESSION_KEY)?.trim();
    if (!isFloraApi || !token) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("X-FLORA-Session")) headers.set("X-FLORA-Session", token);
    return originalFetch(input, { ...init, headers });
  };
}
