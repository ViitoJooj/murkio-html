import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderCanvas } from '../src/canvas/render';
import { isColor, sanitizeDocument } from '../src/canvas/validate';
import { pickCanvas } from '../src/elements/canvas-element';
import { translate } from '../src/errors';
import { FlowController } from '../src/flows';
import { fnv1a32 } from '../src/hash';
import { pick, t, type StringKey } from '../src/i18n';
import { decodeClaims } from '../src/jwt';
import { Murkio } from '../src/murkio';
import { codeChallenge } from '../src/pkce';
import type { CanvasDocument, LocalizedText, PublicConfig } from '../src/types';
import { clearCookies } from './helpers';

/**
 * spec/client/vectors.json is what the native SDKs (Flutter, Android,
 * iOS) are tested against. Running the same cases on the browser code proves
 * the vectors describe what the web really does, so "native draws and behaves
 * like the web" is checked on both ends.
 */
const spec = join(__dirname, '../spec');
const read = (path: string) => JSON.parse(readFileSync(join(spec, path), 'utf8'));
const vectors = read('client/vectors.json');

function documentAt(ref: string): CanvasDocument {
  const [file, field] = ref.split('#') as [string, string | undefined];
  const value = read(file);
  const { document, problems } = sanitizeDocument(field ? value[field] : value);
  expect(problems).toEqual([]);
  return document as CanvasDocument;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

describe('client vectors: small helpers', () => {
  it('hashes the publishable key', () => {
    for (const [value, hash] of Object.entries(vectors.key_hash)) expect(fnv1a32(value)).toBe(hash);
  });

  it('derives the PKCE challenge', async () => {
    for (const { verifier, challenge } of vectors.pkce) expect(await codeChallenge(verifier)).toBe(challenge);
  });

  it('reads the claims of an access token', () => {
    expect(decodeClaims(vectors.claims.token)).toMatchObject(vectors.claims.expect);
  });

  it('accepts every color form', () => {
    for (const { color } of vectors.colors) expect(isColor(color)).toBe(true);
  });

  it('picks the text of a locale', () => {
    for (const { text, locale, expect: expected } of vectors.text) expect(pick(text as LocalizedText, locale)).toBe(expected);
  });

  it('speaks the same built-in strings', () => {
    for (const { locale, key, expect: expected } of vectors.strings) expect(t(locale, key as StringKey)).toBe(expected);
    for (const locale of ['en', 'pt-BR']) {
      const table = read(`client/strings/${locale}.json`) as Record<string, string>;
      const params = { email: '{email}', provider: '{provider}' };
      for (const [key, text] of Object.entries(table)) expect(t(locale, key as StringKey, params)).toBe(text);
    }
  });

  it('translates the error codes', () => {
    for (const { locale, code, expect: expected } of vectors.errors) expect(translate(code, locale)).toBe(expected);
  });
});

describe('client vectors: canvas', () => {
  for (const [index, entry] of (
    vectors.layout as {
      document: string;
      screen: 'sign_in' | 'sign_up';
      width: number;
      config: PublicConfig | null;
      oauth: boolean;
      expect: { layout: string; frame: { width: number; height: number }; order: string[]; paint: string[]; items: Record<string, Rect> };
    }[]
  ).entries()) {
    // Only the native SDKs can lack the social sign-in return URL; a browser always has one.
    if (!entry.oauth) continue;

    it(`layout #${index}: ${entry.document.split('/').pop()} at ${entry.width}px is ${entry.expect.layout}`, () => {
      const host = document.createElement('div');
      const canvas = documentAt(entry.document);
      const view = renderCanvas(host, canvas, { locale: 'en', config: entry.config, screen: entry.screen });
      expect(view.layout(entry.width)).toBe(entry.expect.layout);

      const form = view.root.querySelector('form') as HTMLFormElement;
      const frameWidth = Math.min(entry.width, parseFloat(form.style.maxWidth));
      expect(frameWidth).toBeCloseTo(entry.expect.frame.width, 2);

      const shown = [...form.querySelectorAll<HTMLElement>('.mk-el')].filter((node) => !node.classList.contains('mk-hidden') && node.style.display !== 'none');
      expect(shown.map((node) => node.dataset.id)).toEqual(entry.expect.order);

      if (entry.expect.layout === 'stack') {
        for (const node of shown) expect(parseFloat(node.style.height)).toBe(entry.expect.items[node.dataset.id as string]?.h);
        return;
      }

      const [ratioWidth, ratioHeight] = form.style.aspectRatio.split('/').map(Number) as [number, number];
      const frameHeight = (frameWidth * ratioHeight) / ratioWidth;
      expect(frameHeight).toBeCloseTo(entry.expect.frame.height, 2);
      for (const node of shown) {
        const rect = entry.expect.items[node.dataset.id as string] as Rect;
        expect((parseFloat(node.style.left) / 100) * frameWidth).toBeCloseTo(rect.x, 2);
        expect((parseFloat(node.style.top) / 100) * frameHeight).toBeCloseTo(rect.y, 2);
        expect((parseFloat(node.style.width) / 100) * frameWidth).toBeCloseTo(rect.w, 2);
        expect((parseFloat(node.style.height) / 100) * frameHeight).toBeCloseTo(rect.h, 2);
      }
      const paint = shown
        .map((node, position) => ({ node, position }))
        .sort((a, b) => Number(a.node.style.zIndex) - Number(b.node.style.zIndex) || a.position - b.position)
        .map((item) => item.node.dataset.id);
      expect(paint).toEqual(entry.expect.paint);
    });
  }

  for (const [index, entry] of (
    vectors.visibility as { document: string; screen: 'sign_in' | 'sign_up'; config: PublicConfig | null; oauth: boolean; expect: { visible: string[]; submit: string } }[]
  ).entries()) {
    if (!entry.oauth) continue;

    it(`visibility #${index}: ${entry.document.split('/').pop()} (${entry.screen})`, () => {
      const host = document.createElement('div');
      const view = renderCanvas(host, documentAt(entry.document), { locale: 'en', config: entry.config, screen: entry.screen });
      const shown = [...view.root.querySelectorAll<HTMLElement>('.mk-el')].filter((node) => !node.classList.contains('mk-hidden'));
      expect(shown.map((node) => node.dataset.id)).toEqual(entry.expect.visible);
      const submit = view.root.querySelector<HTMLButtonElement>('.mk-el:not(.mk-hidden) button[type=submit]');
      if (submit) expect(submit.dataset.action).toBe(entry.expect.submit);
    });
  }

  it('falls back to the default canvas when the published one cannot sign in', () => {
    const fallback = JSON.stringify(sanitizeDocument(read('canvas/default.json')).document);
    for (const entry of vectors.pick_canvas as { document: string; config: PublicConfig | null; expect: string }[]) {
      const [file, field] = entry.document.split('#') as [string, string | undefined];
      const raw = field ? read(file)[field] : read(file);
      const picked = JSON.stringify(pickCanvas(raw, entry.config));
      const own = JSON.stringify(sanitizeDocument(raw).document);
      // The default canvas picked for itself is both; every other case tells them apart.
      if (own === fallback) continue;
      expect(picked === fallback ? 'default' : 'document', `${entry.document} with ${JSON.stringify(entry.config)}`).toBe(entry.expect);
    }
  });
});

interface HttpStep {
  method: string;
  path: string;
  body: unknown;
  status: number;
  response: unknown;
}

interface FlowStep {
  call: string;
  args: Record<string, string | boolean>;
  http: HttpStep[];
  expect: Record<string, unknown>;
}

describe('client vectors: flows', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearCookies();
  });

  for (const scenario of vectors.flows.cases as { name: string; steps: FlowStep[] }[]) {
    it(scenario.name, async () => {
      const queue: HttpStep[] = [];
      const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const expected = queue.shift();
        expect(expected, `unexpected request ${init.method} ${String(input)}`).toBeDefined();
        const step = expected as HttpStep;
        expect(`${init.method} ${new URL(String(input)).pathname}`).toBe(`${step.method} ${step.path}`);
        expect(init.body ? JSON.parse(String(init.body)) : undefined).toEqual(step.body);
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pk_vectors');
        if (step.status === 0) throw new TypeError('network down');
        return new Response(step.status === 204 || step.response === null ? null : JSON.stringify(step.response), { status: step.status });
      }) as typeof globalThis.fetch;

      const murkio = new Murkio({ publishableKey: 'pk_vectors', apiUrl: 'https://api.example.com', locale: vectors.flows.locale, fetch });
      const flow = new FlowController(murkio);

      for (const step of scenario.steps) {
        queue.push(...step.http);
        const args = step.args;
        const credentials = { email: String(args.email ?? ''), password: String(args.password ?? ''), keepLogged: args.keep_logged === true };
        const current = flow.state.step;
        const token = 'token' in current ? current.token : '';
        switch (step.call) {
          case 'login':
            await flow.login(credentials);
            break;
          case 'register':
            await flow.register(credentials);
            break;
          case 'confirm_email':
            await flow.confirmEmail(String(args.code), args.password as string | undefined);
            break;
          case 'resend_email':
            await flow.resendEmail();
            break;
          case 'verify_mfa':
            await flow.verifyMfa(token, String(args.code));
            break;
          case 'confirm_enrollment':
            await flow.confirmEnrollment(token, String(args.code));
            break;
          case 'finish_recovery':
            flow.finishRecovery();
            break;
          case 'forgot':
            flow.forgot(String(args.email));
            break;
          case 'request_reset':
            await flow.requestReset(String(args.email));
            break;
          case 'reset_password':
            await flow.resetPassword(String(args.code), String(args.password));
            break;
          case 'back':
            flow.back();
            break;
          default:
            throw new Error(`unknown call ${step.call}`);
        }
        expect(queue, `${step.call} left requests unsent`).toEqual([]);

        const state = flow.state;
        const expected = step.expect;
        expect(state.busy).toBe(false);
        expect(state.step.name).toBe(expected.step);
        expect(state.error?.code ?? null).toBe(expected.error);
        expect(state.notice).toBe(expected.notice === null ? null : t(vectors.flows.locale, expected.notice as StringKey));
        expect(murkio.isSignedIn()).toBe(expected.signed_in);
        if (expected.signed_in) {
          expect(murkio.session.current?.ephemeral).toBe(expected.ephemeral);
          expect(murkio.session.current?.sessionId).toBe(expected.session_id);
          expect(murkio.session.current?.refreshToken).toBe(vectors.flows.tokens.refresh_token);
        }
        if ('email' in expected) expect(flow.currentEmail).toBe(expected.email);
        if ('needs_password' in expected && state.step.name === 'verify_email') expect(state.step.needsPassword).toBe(expected.needs_password);
        if ('secret' in expected && state.step.name === 'mfa_enroll') {
          expect(state.step.secret).toBe(expected.secret);
          expect(state.step.otpauthUri).toBe(expected.otpauth_uri);
        }
        if ('codes' in expected && state.step.name === 'recovery_codes') expect(state.step.codes).toEqual(expected.codes);
      }
      murkio.session.stop();
    });
  }
});
