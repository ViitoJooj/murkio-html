import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client';
import { readCookie } from '../src/storage';
import { SessionManager } from '../src/session';
import { apiError, clearCookies, fakeFetch, tokens } from './helpers';

let clock = 1_000_000;
const now = () => clock;

function manager(routes: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(routes);
  const api = new ApiClient({ publishableKey: 'pk_test', apiUrl: 'https://api.example.com', fetch });
  const session = new SessionManager({ api, keyHash: 'cafebabe', now });
  return { session, calls };
}

beforeEach(() => {
  clock = 1_000_000;
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
});

afterEach(() => clearCookies());

describe('SessionManager', () => {
  it('stores the session, mirrors the access token in a cookie and notifies', () => {
    const { session } = manager({});
    const seen: unknown[] = [];
    session.onChange((value) => seen.push(value?.sessionId ?? null));

    const pair = tokens();
    session.setSession(pair, true);

    expect(session.isSignedIn()).toBe(true);
    expect(session.claims?.sub).toBe('user-1');
    expect(readCookie('murkio_session_cafebabe')).toBe(pair.access_token);
    expect(readCookie('murkio_uat_cafebabe')).toBe('1');
    expect(readCookie('murkio_alive_cafebabe')).toBeNull();
    expect(seen).toEqual(['session-1']);
    session.stop();
  });

  it('returns the current token while it is valid and refreshes once for concurrent callers', async () => {
    let refreshes = 0;
    const next = tokens({ refresh_token: 'rt_next' });
    const { session, calls } = manager({
      'POST /v1/token/refresh': () => {
        refreshes++;
        return { status: 200, body: { data: next } };
      },
    });
    const first = tokens();
    session.setSession(first, true);

    expect(await session.getToken()).toBe(first.access_token);
    expect(refreshes).toBe(0);

    clock += 890_000;
    const [a, b] = await Promise.all([session.getToken(), session.getToken()]);
    expect(refreshes).toBe(1);
    expect(a).toBe(next.access_token);
    expect(b).toBe(next.access_token);
    expect(calls[0]?.body).toEqual({ refresh_token: first.refresh_token });
    expect(session.current?.refreshToken).toBe('rt_next');
    session.stop();
  });

  it('signs out when the refresh token was reused or expired', async () => {
    const { session } = manager({ 'POST /v1/token/refresh': () => apiError(401, 'rsb-03') });
    session.setSession(tokens(), true);
    clock += 900_000;

    expect(await session.getToken()).toBeNull();
    expect(session.isSignedIn()).toBe(false);
    expect(readCookie('murkio_session_cafebabe')).toBeNull();
    expect(readCookie('murkio_uat_cafebabe')).toBeNull();
    session.stop();
  });

  it('keeps the session on a network error', async () => {
    const { session } = manager({});
    const api = (session as unknown as { api: ApiClient }).api;
    api.refresh = () => Promise.reject(Object.assign(new Error('offline'), { code: 'network' }));
    session.setSession(tokens(), true);
    clock += 900_000;

    await expect(session.getToken()).rejects.toThrow('offline');
    expect(session.isSignedIn()).toBe(true);
    session.stop();
  });

  it('ends an ephemeral session after the browser was closed', () => {
    const { session, calls } = manager({ 'POST /v1/logout': () => ({ status: 204 }) });
    session.setSession(tokens({ refresh_token: 'rt_ephemeral' }), false);
    expect(readCookie('murkio_alive_cafebabe')).toBe('1');
    session.stop();

    const reopened = manager({ 'POST /v1/logout': () => ({ status: 204 }) });
    reopened.session.start();
    expect(reopened.session.isSignedIn()).toBe(true);
    reopened.session.stop();

    clearCookies();
    const restarted = manager({ 'POST /v1/logout': () => ({ status: 204 }) });
    restarted.session.start();
    expect(restarted.session.isSignedIn()).toBe(false);
    expect(restarted.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /v1/logout']);
    expect(calls).toHaveLength(0);
    restarted.session.stop();
  });

  it('follows a sign-out made in another tab', () => {
    const { session } = manager({});
    session.setSession(tokens(), true);
    session.start();
    const seen: (string | null)[] = [];
    session.onChange((value) => seen.push(value?.sessionId ?? null));

    localStorage.removeItem('murkio.cafebabe.session');
    window.dispatchEvent(new StorageEvent('storage', { key: 'murkio.cafebabe.session' }));

    expect(seen).toEqual([null]);
    session.stop();
  });
});
