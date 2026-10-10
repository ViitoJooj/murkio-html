import type { AccessClaims } from './types';

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Reads the claims of an access token without checking its signature. The
 * browser only uses them for display and timing (exp, sid); every decision
 * that matters is taken by the API or by a backend that verifies the token.
 */
export function decodeClaims(token: string): AccessClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as AccessClaims;
    return typeof claims.exp === 'number' && typeof claims.sub === 'string' ? claims : null;
  } catch {
    return null;
  }
}
