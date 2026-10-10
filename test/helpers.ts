import type { TokenPair } from '../src/types';

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers from a table of "METHOD /path" handlers and records the calls. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) return new Response(JSON.stringify({ error: 'Not Found', details: [{ code: 'test-404', message: call.path }] }), { status: 404 });
    const answer = handler(call);
    const body = answer.status === 204 || answer.status === 304 ? null : JSON.stringify(answer.body ?? {});
    return new Response(body, { status: answer.status, headers: answer.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(claims)}.signature`;
}

let counter = 0;
export function tokens(overrides: Partial<TokenPair> = {}): TokenPair {
  counter++;
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: jwt({ iss: 'enterprise-auth', sub: 'user-1', aud: 'app-1', aid: 'app-1', sid: 'session-1', roles: ['user'], iat: now, exp: now + 900, jti: `j${counter}` }),
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: `rt_${counter}`,
    session_id: 'session-1',
    ...overrides,
  };
}

export function apiError(status: number, code: string) {
  return { status, body: { error: 'error', details: [{ code, message: code }] } };
}

export function clearCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}
