import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/**
 * The canvas comes from the dashboard and is drawn on every customer's login
 * page. The SDK builds the DOM with createElement, textContent and the CSSOM
 * only; this test keeps HTML and script sinks out of the source for good.
 */
describe('no HTML or script sinks in the SDK', () => {
  for (const file of sources(join(__dirname, '../src'))) {
    it(file.split('/src/')[1] ?? file, () => {
      const code = readFileSync(file, 'utf8');
      expect(code).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setAttribute\(\s*['"]style['"]|cssText/);
    });
  }
});
