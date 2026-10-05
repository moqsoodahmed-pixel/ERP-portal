// Cloudflare Pages Function: proxies every /api/* request to the Railway backend.
// This keeps the app same-origin, so the httpOnly `sameSite: strict` refresh cookie keeps working.
//
// Required Pages env var (Settings -> Variables and Secrets):
//   BACKEND_URL = https://your-backend.up.railway.app   (no trailing slash)
export async function onRequest({ request, env }) {
  if (!env.BACKEND_URL) {
    return new Response('BACKEND_URL is not configured', { status: 500 });
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.BACKEND_URL);

  const proxied = new Request(target, request);
  // Pass the real visitor IP so rate limiting / login lockout / audit logs see users, not Cloudflare.
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) proxied.headers.set('X-Forwarded-For', clientIp);
  proxied.headers.set('X-Forwarded-Proto', 'https');

  // Return the backend response as-is (including Set-Cookie, which binds to the pages.dev domain).
  return fetch(proxied, { redirect: 'manual' });
}
