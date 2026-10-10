// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('server render', () => {
  it('imports without a DOM and registers nothing', async () => {
    const sdk = await import('../src/index');
    expect(typeof sdk.init).toBe('function');
    expect(() => sdk.defineElements()).not.toThrow();
  });
});
