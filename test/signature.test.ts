import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Murkio } from '../src/murkio';
import { checkCanvas, type CanvasPin, type Jwk, type SignedCanvas } from '../src/signature';
import { sanitizeDocument } from '../src/canvas/validate';
import { fakeFetch } from './helpers';

const spec = join(__dirname, '../spec');
const read = (path: string) => JSON.parse(readFileSync(join(spec, path), 'utf8'));
const vectors = read('client/vectors.json').canvas_signature as {
  jwks: { keys: Jwk[] };
  cases: {
    name: string;
    application_id: string;
    jwks: { keys: Jwk[] };
    canvas: { version: number; document: string | object; signature?: string };
    pinned: CanvasPin | null;
    strict: boolean;
    expect: 'signed' | 'unsigned' | 'default';
    pin_after: CanvasPin | null;
  }[];
};
const signedDocument = read('canvas/default.json');

describe('canvas signature vectors', () => {
  for (const entry of vectors.cases) {
    it(entry.name, async () => {
      const canvas = { ...entry.canvas, document: typeof entry.canvas.document === 'string' ? read(entry.canvas.document) : entry.canvas.document } as SignedCanvas;
      const verdict = await checkCanvas({
        applicationId: entry.application_id,
        canvas,
        jwks: async () => entry.jwks.keys,
        pinned: entry.pinned,
        strict: entry.strict,
      });
      expect(verdict.use).toBe(entry.expect);
      if (verdict.use === 'signed') {
        expect(verdict.document).toEqual(signedDocument);
        expect(verdict.pin).toEqual(entry.pin_after);
      } else {
        // The pin only moves on a verified canvas.
        expect(entry.pin_after === null || entry.pinned !== null).toBe(true);
      }
    });
  }

  it('asks for a fresh JWKS once when the kid is not in the cached one', async () => {
    const entry = vectors.cases[0]!;
    const calls: boolean[] = [];
    const verdict = await checkCanvas({
      applicationId: entry.application_id,
      canvas: entry.canvas as SignedCanvas,
      jwks: async (refresh) => {
        calls.push(refresh);
        return refresh ? entry.jwks.keys : [];
      },
      pinned: null,
    });
    expect(verdict.use).toBe('signed');
    expect(calls).toEqual([false, true]);
  });

  it('draws the default canvas when the keys cannot be fetched', async () => {
    const entry = vectors.cases[0]!;
    const verdict = await checkCanvas({
      applicationId: entry.application_id,
      canvas: entry.canvas as SignedCanvas,
      jwks: async () => {
        throw new Error('offline');
      },
      pinned: null,
    });
    expect(verdict.use).toBe('default');
  });
});

describe('Murkio checks the canvas of the bootstrap', () => {
  const entry = vectors.cases[0]!;
  const tampered = vectors.cases.find((c) => c.name.startsWith('a payload edited'))!;
  const config = { methods: { password: true }, mfa: { mode: 'off' }, oauth_providers: [], signup: { login_on_verify: true } };

  const make = (canvas: object, routes: Record<string, () => { status: number; body?: unknown }> = {}) => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/client': () => ({
        status: 200,
        body: { data: { application_id: entry.application_id, issuer: 'enterprise-auth', jwks_url: '/v1/applications/app_1/jwks.json', config, canvas } },
      }),
      'GET /v1/applications/app_1/jwks.json': () => ({ status: 200, body: entry.jwks }),
      ...routes,
    });
    return { murkio: new Murkio({ publishableKey: 'pk_test', apiUrl: 'https://api.example.com', fetch }), calls };
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('draws the signed document, fetches the keys once and pins the application', async () => {
    const { murkio, calls } = make({ ...entry.canvas, document: { not: 'the signed one' } });
    const bootstrap = await murkio.bootstrap();
    expect(bootstrap.canvas.document).toEqual(signedDocument);
    expect(calls.filter((c) => c.path.endsWith('jwks.json'))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`murkio.${murkio.keyHash}.canvas`)!)).toEqual(entry.pin_after);
  });

  it('draws the default canvas for a canvas that does not verify', async () => {
    const { murkio } = make({ ...tampered.canvas, document: { not: 'the signed one' } });
    const bootstrap = await murkio.bootstrap();
    expect(bootstrap.canvas.version).toBe(0);
    expect(JSON.stringify(sanitizeDocument(bootstrap.canvas.document).document)).toBe(JSON.stringify(sanitizeDocument(signedDocument).document));
  });

  it('refuses an unsigned canvas once the application has signed', async () => {
    const first = make(entry.canvas);
    await first.murkio.bootstrap();
    localStorage.removeItem(`murkio.${first.murkio.keyHash}.bootstrap`);

    const stripped = make({ version: 3, document: { schema: 1, forged: true } });
    const bootstrap = await stripped.murkio.bootstrap();
    expect(bootstrap.canvas.version).toBe(0);
  });

  it('keeps working with a server that does not sign yet', async () => {
    const { murkio, calls } = make({ version: 3, document: signedDocument });
    const bootstrap = await murkio.bootstrap();
    expect(bootstrap.canvas.document).toEqual(signedDocument);
    expect(calls.some((c) => c.path.endsWith('jwks.json'))).toBe(false);
  });

  it('can be told to refuse a canvas without a signature from the start', async () => {
    const { fetch } = fakeFetch({
      'GET /v1/client': () => ({
        status: 200,
        body: { data: { application_id: entry.application_id, issuer: 'x', jwks_url: '/j', config, canvas: { version: 3, document: signedDocument } } },
      }),
    });
    const murkio = new Murkio({ publishableKey: 'pk_test', apiUrl: 'https://api.example.com', fetch, requireSignedCanvas: true });
    expect((await murkio.bootstrap()).canvas.version).toBe(0);
  });
});
