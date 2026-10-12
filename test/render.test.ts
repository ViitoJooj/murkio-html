import defaultCanvas from '../spec/canvas/default.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLayout, renderCanvas } from '../src/canvas/render';
import { sanitizeDocument } from '../src/canvas/validate';
import type { CanvasDocument, PublicConfig } from '../src/types';

const canvas = () => sanitizeDocument(structuredClone(defaultCanvas)).document as CanvasDocument;
const config = (overrides: Partial<PublicConfig> = {}): PublicConfig => ({
  methods: { password: true },
  mfa: { mode: 'off' },
  oauth_providers: [],
  signup: { login_on_verify: true },
  ...overrides,
});

beforeEach(() => {
  document.body.textContent = '';
});

describe('renderCanvas', () => {
  it('draws accessible form controls in reading order', () => {
    const host = document.createElement('div');
    renderCanvas(host, canvas(), { locale: 'pt-BR', config: config() });

    const email = host.querySelector<HTMLInputElement>('input[type=email]');
    const password = host.querySelector<HTMLInputElement>('input[type=password]');
    expect(email?.autocomplete).toBe('username');
    expect(password?.autocomplete).toBe('current-password');
    expect(host.querySelector(`label[for="${email?.id}"]`)?.textContent).toBe('E-mail');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelector('button[type=submit]')?.textContent).toBe('Entrar');
    expect(host.querySelector('h1')?.textContent).toBe('Entrar');

    const order = [...host.querySelectorAll<HTMLElement>('.mk-el')].map((node) => node.dataset.id);
    expect(order).toEqual(['title', 'error', 'email', 'password', 'keep_logged', 'forgot', 'login', 'divider', 'register']);
  });

  it('uses the translations of the locale', () => {
    const host = document.createElement('div');
    renderCanvas(host, canvas(), { locale: 'en', config: config() });
    expect(host.querySelector('h1')?.textContent).toBe('Sign in');
  });

  it('never parses canvas text as HTML', () => {
    const doc = canvas();
    doc.screens.sign_in.elements[0]!.props.text = { default: '<img src=x onerror="alert(1)">' };
    const host = document.createElement('div');
    renderCanvas(host, doc, { locale: 'en', config: config() });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('hides what the application turned off', () => {
    const doc = canvas();
    doc.screens.sign_in.elements.push(
      { id: 'google', type: 'oauth_button', props: { provider: 'google' }, style: {} },
      { id: 'github', type: 'oauth_button', props: { provider: 'github' }, style: {} },
    );
    doc.screens.sign_in.layouts.desktop.items.google = { x: 32, y: 452, w: 160, h: 44, z: 1 };
    doc.screens.sign_in.layouts.desktop.items.github = { x: 208, y: 452, w: 160, h: 44, z: 1 };

    const host = document.createElement('div');
    renderCanvas(host, doc, { locale: 'en', config: config({ methods: { password: false }, oauth_providers: ['google'] }) });

    const hidden = (id: string) => host.querySelector(`[data-id="${id}"]`)?.classList.contains('mk-hidden');
    expect(hidden('email')).toBe(true);
    expect(hidden('login')).toBe(true);
    expect(hidden('google')).toBe(false);
    expect(hidden('github')).toBe(true);
    expect(host.querySelector('[data-provider=google]')?.textContent).toBe('Continue with Google');
  });

  it('reports the values with each action', () => {
    const onAction = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderCanvas(host, canvas(), { locale: 'en', config: config(), onAction });

    host.querySelector<HTMLInputElement>('input[type=email]')!.value = 'ana@example.com';
    host.querySelector<HTMLInputElement>('input[type=password]')!.value = 'secret';
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = true;
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    host.querySelector<HTMLButtonElement>('[data-action=register]')!.click();
    host.querySelector<HTMLButtonElement>('[data-action=forgot]')!.click();

    const values = { email: 'ana@example.com', password: 'secret', keepLogged: true };
    expect(onAction.mock.calls).toEqual([
      [{ type: 'login' }, values],
      [{ type: 'register' }, values],
      [{ type: 'forgot' }, values],
    ]);
  });

  it('keeps links on safe destinations and images without referrer', () => {
    const doc = canvas();
    doc.screens.sign_in.elements.push(
      { id: 'terms', type: 'link', props: { text: { default: 'Termos' }, href: '/terms' }, style: {} },
      { id: 'logo', type: 'image', props: { src: 'https://cdn.example.com/logo.png' }, style: {} },
    );
    doc.screens.sign_in.layouts.desktop.items.terms = { x: 0, y: 0, w: 44, h: 44, z: 0 };
    doc.screens.sign_in.layouts.desktop.items.logo = { x: 0, y: 0, w: 44, h: 44, z: 0 };
    const host = document.createElement('div');
    renderCanvas(host, doc, { locale: 'en', config: config() });

    expect(host.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(host.querySelector('img')?.referrerPolicy).toBe('no-referrer');
    expect(host.querySelector<HTMLElement>('[data-id=logo]')?.hasAttribute('data-decorative')).toBe(true);
  });

  it('switches layouts by the container width', () => {
    const doc = canvas();
    const host = document.createElement('div');
    const view = renderCanvas(host, doc, { locale: 'en', config: config() });
    const email = host.querySelector<HTMLElement>('[data-id=email]')!;

    expect(view.layout(400)).toBe('desktop');
    expect(email.style.left).toBe('8%');
    expect(view.layout(200)).toBe('stack');
    expect(email.style.left).toBe('');
    expect(email.style.height).toBe('48px');

    doc.screens.sign_in.layouts.mobile = {
      width: 320,
      height: 640,
      items: Object.fromEntries(doc.screens.sign_in.elements.map((e, i) => [e.id, { x: 0, y: i * 60, w: 320, h: 48, z: 1 }])),
    };
    expect(chooseLayout(doc.screens.sign_in, 280)).toBe('mobile');
    expect(chooseLayout(doc.screens.sign_in, 200)).toBe('stack');
    expect(chooseLayout(doc.screens.sign_in, 380)).toBe('desktop');
  });
});
