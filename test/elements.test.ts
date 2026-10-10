import defaultCanvas from '@murkio/spec/canvas/default.json';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineElements } from '../src/elements/define';
import { init, reset } from '../src/murkio';
import { clearCookies, fakeFetch, tokens } from './helpers';

const bootstrap = {
  application_id: 'app-1',
  issuer: 'enterprise-auth',
  jwks_url: '/v1/applications/app-1/jwks.json',
  config: { methods: { password: true }, mfa: { mode: 'off' }, oauth_providers: [], signup: { login_on_verify: true } },
  canvas: { version: 0, document: defaultCanvas },
};

function start() {
  const { fetch, calls } = fakeFetch({
    'GET /v1/client': () => ({ status: 200, body: { data: bootstrap }, headers: { ETag: 'W/"client-1-d"' } }),
    'POST /v1/login': () => ({ status: 200, body: { data: tokens() } }),
  });
  const murkio = init({ publishableKey: 'pk_elements', apiUrl: 'https://api.example.com', locale: 'en', fetch });
  return { murkio, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await tick();
}

beforeEach(() => {
  defineElements();
  localStorage.clear();
  clearCookies();
  document.body.textContent = '';
});

afterEach(() => reset());

describe('<murkio-identity-canvas>', () => {
  it('draws the published canvas and signs in', async () => {
    const { murkio, calls } = start();
    const element = document.createElement('murkio-identity-canvas');
    const logins: unknown[] = [];
    element.addEventListener('murkio:login', () => logins.push(true));
    document.body.appendChild(element);

    const root = element.shadowRoot!;
    await until(() => root.querySelector('form') !== null);
    root.querySelector<HTMLInputElement>('input[type=email]')!.value = 'ana@example.com';
    root.querySelector<HTMLInputElement>('input[type=password]')!.value = 'S3nha!forte';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => logins.length > 0);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /v1/client', 'POST /v1/login']);
    expect(murkio.isSignedIn()).toBe(true);
    expect(logins).toHaveLength(1);
  });

  it('previews a document without an API', () => {
    const element = document.createElement('murkio-identity-canvas') as HTMLElement & { canvas: unknown };
    element.canvas = defaultCanvas;
    document.body.appendChild(element);
    return until(() => element.shadowRoot?.querySelector('input[type=email]') != null).then(() => {
      expect(element.shadowRoot?.querySelector('input[type=email]')).not.toBeNull();
    });
  });
});

describe('standalone components', () => {
  it('render real controls with the developer classes and sign in together', async () => {
    const { murkio, calls } = start();
    const email = document.createElement('murkio-identity-email-input');
    email.setAttribute('class', 'input input-bordered');
    email.setAttribute('placeholder', 'you@example.com');
    const password = document.createElement('murkio-identity-password-input');
    const keep = document.createElement('murkio-identity-keep-logged');
    keep.setAttribute('label', 'Keep me signed in');
    const login = document.createElement('murkio-identity-login-button');
    login.textContent = 'Sign in';
    document.body.append(email, password, keep, login);

    const emailInput = email.querySelector('input')!;
    expect(emailInput.className).toBe('input input-bordered');
    expect(emailInput.placeholder).toBe('you@example.com');
    expect(login.querySelector('button')?.textContent).toBe('Sign in');
    expect(keep.querySelector('span')?.textContent).toBe('Keep me signed in');

    emailInput.value = 'ana@example.com';
    emailInput.dispatchEvent(new Event('input'));
    const passwordInput = password.querySelector('input')!;
    passwordInput.value = 'S3nha!forte';
    passwordInput.dispatchEvent(new Event('input'));
    login.querySelector('button')!.click();

    await until(() => murkio.isSignedIn());
    expect(calls.find((call) => call.path === '/v1/login')?.body).toEqual({ email: 'ana@example.com', password: 'S3nha!forte' });
  });
});

describe('inline bootstrap', () => {
  function inline(generatedAt: number) {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'murkio-bootstrap';
    script.dataset.generatedAt = String(generatedAt);
    script.textContent = JSON.stringify({ ...bootstrap, canvas: { version: 9, document: defaultCanvas } });
    document.head.appendChild(script);
    return script;
  }

  it('uses a fresh inlined bootstrap without calling the API', async () => {
    const script = inline(Date.now());
    const { murkio, calls } = start();
    expect((await murkio.bootstrap()).canvas.version).toBe(9);
    expect(calls).toHaveLength(0);
    script.remove();
  });

  it('ignores an old inlined bootstrap (a static page) and asks the API', async () => {
    const script = inline(Date.now() - 10 * 60_000);
    const { murkio, calls } = start();
    expect((await murkio.bootstrap()).canvas.version).toBe(0);
    expect(calls.map((call) => call.path)).toEqual(['/v1/client']);
    script.remove();
  });
});
