import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client';
import { MurkioError, translate } from '../src/errors';
import { fnv1a32 } from '../src/hash';
import { decodeClaims } from '../src/jwt';
import { codeChallenge, randomString } from '../src/pkce';
import { cookieNames } from '../src/session';
import { apiError, fakeFetch, jwt } from './helpers';

describe('fnv1a32', () => {
  it('matches the reference vectors the backend SDKs use', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});

describe('pkce', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates verifiers from the unreserved alphabet', () => {
    const verifier = randomString(64);
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});

describe('decodeClaims', () => {
  it('reads the payload and refuses garbage', () => {
    expect(decodeClaims(jwt({ sub: 'u', exp: 10, sid: 's' }))?.sub).toBe('u');
    expect(decodeClaims('not-a-token')).toBeNull();
    expect(decodeClaims(jwt({ hello: 'world' }))).toBeNull();
  });
});

describe('translate', () => {
  it('uses the locale, then its language, then english, then the generic message', () => {
    expect(translate('rsb-00', 'pt-BR')).toBe('E-mail ou senha incorretos.');
    expect(translate('rsb-00', 'pt-PT')).toBe('E-mail ou senha incorretos.');
    expect(translate('rsb-00', 'fr')).toBe('Incorrect email or password.');
    expect(translate('zzz-99', 'pt-BR')).toBe(translate('unknown', 'pt-BR'));
    expect(translate('oauth.access_denied', 'en')).toBe('The sign-in was canceled.');
  });
});

describe('cookieNames', () => {
  it('pins the cookies to the host on https and drops the prefix on http', () => {
    expect(cookieNames('abcd1234', true).session).toBe('__Host-murkio_session_abcd1234');
    expect(cookieNames('abcd1234', true, '.example.com').session).toBe('__Secure-murkio_session_abcd1234');
    expect(cookieNames('abcd1234', false).uat).toBe('murkio_uat_abcd1234');
  });
});

describe('ApiClient', () => {
  it('sends the publishable key and maps API errors to MurkioError', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /v1/login': () => apiError(401, 'rsb-00') });
    const api = new ApiClient({ publishableKey: 'pk_test', apiUrl: 'https://api.example.com/', fetch });

    const error = await api.login({ email: 'a@b.com', password: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MurkioError);
    expect((error as MurkioError).code).toBe('rsb-00');
    expect((error as MurkioError).status).toBe(401);
    expect(calls[0]?.headers.Authorization).toBe('Bearer pk_test');
  });

  it('reports a failed request as a network error', async () => {
    const api = new ApiClient({ publishableKey: 'pk_test', fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch });
    await expect(api.logout('rt')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('tells a session from a 2FA challenge and a 204 confirmation', async () => {
    const { fetch } = fakeFetch({
      'POST /v1/login': () => ({ status: 200, body: { data: { mfa: { token: 'mfa_x', enrollment_required: false, expires_in: 300 } } } }),
      'POST /v1/email/verification/confirm': () => ({ status: 204 }),
    });
    const api = new ApiClient({ publishableKey: 'pk_test', fetch });
    expect(await api.login({ email: 'a@b.com', password: 'x' })).toEqual({ kind: 'mfa', mfa: { token: 'mfa_x', enrollment_required: false, expires_in: 300 } });
    expect(await api.confirmVerification({ email: 'a@b.com', code: '1', password: 'x' })).toBeNull();
  });

  it('revalidates the bootstrap with its etag', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /v1/client': (call) => (call.headers['If-None-Match'] === 'W/"client-1-1"' ? { status: 304 } : { status: 200, body: { data: {} } }) });
    const api = new ApiClient({ publishableKey: 'pk_test', fetch });
    expect((await api.bootstrap('W/"client-1-1"')).notModified).toBe(true);
    expect(calls[0]?.headers['If-None-Match']).toBe('W/"client-1-1"');
  });
});
