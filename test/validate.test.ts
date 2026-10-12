import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSignIn, isSafeHref, sanitizeDocument } from '../src/canvas/validate';

const spec = join(__dirname, '../spec/canvas');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const fixtures = (kind: string) =>
  readdirSync(join(spec, 'fixtures', kind)).map((file) => ({ file, ...read(join(spec, 'fixtures', kind, file)) }) as { file: string; document: unknown });

/**
 * The SDK skips what the server would reject but cannot hurt the page (an
 * unknown field or prop): it ignores them instead of failing. Those invalid
 * fixtures only check the value is dropped from the drawn document.
 */
const IGNORED_BY_THE_SDK = new Set(['unknown-field.json', 'unknown-prop.json']);

describe('sanitizeDocument against the shared fixtures', () => {
  it('accepts the default canvas unchanged', () => {
    const raw = read(join(spec, 'default.json'));
    const { document, problems } = sanitizeDocument(raw);
    expect(problems).toEqual([]);
    expect(document).not.toBeNull();
    expect(canSignIn(document!.screens.sign_in)).toBe(true);
  });

  for (const kind of ['valid', 'unpublishable']) {
    for (const fixture of fixtures(kind)) {
      it(`${kind}/${fixture.file} has no structural problem`, () => {
        const { document, problems } = sanitizeDocument(fixture.document);
        expect(problems).toEqual([]);
        expect(document).not.toBeNull();
      });
    }
  }

  for (const fixture of fixtures('invalid')) {
    it(`invalid/${fixture.file} is caught`, () => {
      const { document, problems } = sanitizeDocument(fixture.document);
      if (IGNORED_BY_THE_SDK.has(fixture.file)) {
        const output = JSON.stringify(document);
        expect(output).not.toContain('colour');
        expect(output).not.toContain('onclick');
        return;
      }
      expect(document === null || problems.length > 0).toBe(true);
    });
  }
});

describe('isSafeHref', () => {
  it('allows https and site paths only', () => {
    expect(isSafeHref('https://example.com/terms')).toBe(true);
    expect(isSafeHref('/terms')).toBe(true);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('/\\evil.example')).toBe(false);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('http://example.com')).toBe(false);
  });
});
