// Who may reach Community Lab's HTTP server (src/server/httpGuard.ts): requests addressed to this machine's
// loopback (so a page on a domain that resolves to 127.0.0.1, DNS rebinding, is refused), and POST and PUT bodies
// that are JSON by their media type, which no other site can send without a preflight.

import { describe, expect, test } from 'bun:test';
import { allowedHost, hostRefusal, isJsonContentType } from '../src/server/httpGuard';

const at = (host: string) => new Request('http://127.0.0.1:3040/api/plans', { headers: { host } });

describe('the host rule', () => {
  test('loopback names, with or without a port, are served', () => {
    for (const h of ['localhost', 'localhost:3040', 'LocalHost:3040', '127.0.0.1:3040', '127.0.0.1', '[::1]:3040', '[::1]']) {
      expect(allowedHost(h)).toBe(true);
      expect(hostRefusal(at(h))).toBeNull();
    }
  });

  test('any other name, a look-alike, or none, is refused before any route', async () => {
    for (const h of ['evil.example:3040', 'localhost.evil.example:3040', '127.0.0.1.nip.io:3040', '192.168.1.10:3040', '0.0.0.0:3040', 'localhost:3040.evil']) {
      expect(allowedHost(h)).toBe(false);
      const r = hostRefusal(at(h));
      expect(r?.status).toBe(421);
      expect(((await r?.json()) as { error: string }).error).toContain('localhost');
    }
    expect(allowedHost(null)).toBe(false);
    expect(allowedHost('')).toBe(false);
  });
});

describe('the JSON rule', () => {
  test('application/json, with parameters or in any case, is JSON', () => {
    for (const ct of ['application/json', 'application/json; charset=utf-8', 'Application/JSON', ' application/json ;x=1']) {
      expect(isJsonContentType(ct)).toBe(true);
    }
  });

  test('what a browser sends cross-site unasked is not, even when it mentions JSON', () => {
    for (const ct of ['text/plain', 'text/plain; charset=application/json', 'text/plain;application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=application/json', 'application/jsonp', '']) {
      expect(isJsonContentType(ct)).toBe(false);
    }
    expect(isJsonContentType(null)).toBe(false);
  });
});
