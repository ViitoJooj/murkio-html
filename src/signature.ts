/**
 * Checks the signature of the published canvas (libs/spec/canvas/SIGNATURE.md).
 * The API signs the canvas with the application's Ed25519 key, the one that
 * signs the access tokens, so what the page draws is known to have come from
 * the application's API and not from a cache or a proxy on the way.
 */
export const CANVAS_SIGNATURE_TYPE = 'murkio-canvas+jws';

export interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
}

/** What the SDK remembers per publishable key: the application signed once, and the highest version seen. */
export interface CanvasPin {
  signed: boolean;
  version: number;
}

export interface SignedCanvas {
  version: number;
  document: unknown;
  signature?: string;
}

export type CanvasVerdict =
  /** Signature checked: draw `document` (from the signed payload) and keep `pin`. */
  | { use: 'signed'; document: unknown; pin: CanvasPin }
  /** Nothing to check (no signature from an application that never signed, or no Ed25519 here): draw as received. */
  | { use: 'unsigned' }
  /** The canvas cannot be trusted: draw the default one. */
  | { use: 'default' };

export interface CheckOptions {
  applicationId: string;
  canvas: SignedCanvas;
  /** The application's keys. `refresh` asks for a fresh copy (a kid that is not in the cached one). */
  jwks: (refresh: boolean) => Promise<Jwk[]>;
  pinned: CanvasPin | null;
  /** Refuse a canvas without a signature even the first time. */
  strict?: boolean;
}

function bytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function json(value: string): Record<string, unknown> | null {
  const raw = bytes(value);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `undefined` when this browser has no Ed25519 in WebCrypto, so the check cannot run. */
async function verify(jwk: Jwk, message: string, signature: Uint8Array): Promise<boolean | undefined> {
  const subtle = typeof crypto === 'undefined' ? undefined : crypto.subtle;
  if (!subtle || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') return false;
  const raw = bytes(jwk.x);
  if (raw?.length !== 32) return false;

  try {
    const key = await subtle.importKey('raw', raw as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, new TextEncoder().encode(message));
  } catch (error) {
    if (error instanceof Error && error.name === 'NotSupportedError') return undefined;
    return false;
  }
}

async function keyFor(kid: string, jwks: CheckOptions['jwks']): Promise<Jwk | undefined> {
  const find = (keys: Jwk[]) => keys.find((key) => key.kid === kid);
  return find(await jwks(false)) ?? find(await jwks(true));
}

export async function checkCanvas(options: CheckOptions): Promise<CanvasVerdict> {
  const { canvas, pinned } = options;

  if (!canvas.signature) {
    return pinned?.signed || options.strict ? { use: 'default' } : { use: 'unsigned' };
  }

  const parts = canvas.signature.split('.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (parts.length !== 3 || !encodedHeader || !encodedPayload || !encodedSignature) return { use: 'default' };
  const header = json(encodedHeader);
  if (header?.alg !== 'EdDSA' || header.typ !== CANVAS_SIGNATURE_TYPE || typeof header.kid !== 'string') return { use: 'default' };
  const signature = bytes(encodedSignature);
  if (signature?.length !== 64) return { use: 'default' };

  let key: Jwk | undefined;
  try {
    key = await keyFor(header.kid, options.jwks);
  } catch {
    return { use: 'default' };
  }
  if (!key) return { use: 'default' };

  const valid = await verify(key, `${encodedHeader}.${encodedPayload}`, signature);
  if (valid === undefined) return options.strict ? { use: 'default' } : { use: 'unsigned' };
  if (!valid) return { use: 'default' };

  // Only now is the payload something the API wrote.
  const payload = json(encodedPayload);
  if (!payload || payload.app !== options.applicationId || payload.version !== canvas.version || typeof payload.version !== 'number') return { use: 'default' };
  if (pinned?.signed && payload.version < pinned.version) return { use: 'default' };

  return { use: 'signed', document: payload.document, pin: { signed: true, version: Math.max(payload.version, pinned?.version ?? 0) } };
}
