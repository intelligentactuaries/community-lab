// Who may reach Community Lab's HTTP server.
//
// Host: the server answers to this machine's loopback names only. A page on
// a domain that resolves to 127.0.0.1 (DNS rebinding) is the server's own
// origin as far as its browser knows, so neither CORS nor the origin list in
// index.ts stops its requests; the Host they carry still names that domain,
// and it is not one of these.
//
// JSON: a POST or PUT must be application/json, so another site cannot send
// one without a CORS preflight, which only this machine's pages pass
// (index.ts). The check is on the media type itself: "text/plain;
// x=application/json" is still text/plain to a browser, which sends it
// cross-site unasked.

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/** Whether a Host header names this machine's loopback. */
export function allowedHost(host: string | null): boolean {
  return !!host && LOOPBACK_HOST.test(host);
}

/** A refusal for a request addressed to any other name, or null. */
export function hostRefusal(req: Request): Response | null {
  if (allowedHost(req.headers.get('host'))) return null;
  return new Response(JSON.stringify({ error: 'this server answers on localhost, 127.0.0.1 or [::1] only' }), { status: 421, headers: { 'content-type': 'application/json' } });
}

/** Whether a Content-Type header's media type is application/json. */
export function isJsonContentType(contentType: string | null): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}
