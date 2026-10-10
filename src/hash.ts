/**
 * fnv1a32 is the short, non-cryptographic hash that names the storage keys and
 * cookies of a publishable key. The backend SDKs compute the same hash to find
 * the session cookie, so it must stay FNV-1a (32 bits, lowercase hex).
 */
export function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
