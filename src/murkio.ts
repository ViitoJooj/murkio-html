import { ApiClient } from './client';
import { asMurkioError, MurkioError } from './errors';
import { fnv1a32 } from './hash';
import { detectLocale } from './i18n';
import { codeChallenge, randomString } from './pkce';
import { SessionManager } from './session';
import { readJSON, store } from './storage';
import type { AccessClaims, ClientBootstrap, LoginResult, Me, MFAChallenge } from './types';

export interface MurkioOptions {
  /** The application's publishable key (`pk_...`). The only required setting. */
  publishableKey: string;
  /** Base URL of the identity API. */
  apiUrl?: string;
  /** Language of the built-in screens and error messages. Defaults to the page `lang`, then the browser. */
  locale?: string;
  /** Where to send the user after signing in. Without it the page stays and `murkio-login` fires. */
  afterLogin?: string;
  /** Social sign-in comes back here. Must be in the application's redirect URLs. Defaults to the current page. */
  oauthRedirectUrl?: string;
  /** Shares the session cookie with subdomains (e.g. `.example.com`). Read the README first. */
  cookieDomain?: string;
  fetch?: typeof fetch;
}

export interface PendingMfa {
  mfa: MFAChallenge;
  keepLogged: boolean;
}

interface OAuthAttempt {
  verifier: string;
  state: string;
  keepLogged: boolean;
}

interface CachedBootstrap {
  etag: string | null;
  data: ClientBootstrap;
  at: number;
}

type EventName = 'login' | 'logout' | 'error' | 'mfa';
const BOOTSTRAP_TTL_MS = 60_000;
/**
 * A page can be rendered once and served for a long time (static generation,
 * CDN caches): its inlined bootstrap would freeze the canvas and the config.
 * It is only trusted for a short while after the server wrote it; an older one
 * is ignored and the SDK asks the API.
 */
const INLINE_TTL_MS = 120_000;
const USER_TTL_MS = 60_000;

/**
 * Murkio is the browser client of one application. Create it once with
 * `init()` (or the `data-murkio-key` script tag); the web components and the
 * framework packages all use that instance.
 */
export class Murkio {
  readonly options: MurkioOptions;
  readonly api: ApiClient;
  readonly session: SessionManager;
  readonly keyHash: string;
  readonly locale: string;
  /** Resolves with the result of a social sign-in return on this page, if any. */
  readonly oauthReturn: Promise<LoginResult | null>;
  private bootstrapping: Promise<ClientBootstrap> | null = null;
  private user: { sessionId: string; at: number; value: Promise<Me> } | null = null;
  private readonly events = new EventTarget();
  private pendingMfa: PendingMfa | null = null;
  private oauthError: MurkioError | null = null;

  constructor(options: MurkioOptions) {
    if (!options.publishableKey?.startsWith('pk_')) {
      throw new Error('[murkio] publishableKey must be a publishable key (pk_...). Never put a secret key (sk_) in a browser.');
    }
    this.options = options;
    this.keyHash = fnv1a32(options.publishableKey);
    this.locale = detectLocale(options.locale);
    this.api = new ApiClient({ publishableKey: options.publishableKey, apiUrl: options.apiUrl, fetch: options.fetch });
    this.session = new SessionManager({ api: this.api, keyHash: this.keyHash, cookieDomain: options.cookieDomain });
    this.session.start();

    let signedIn = this.session.isSignedIn();
    this.session.onChange((session) => {
      if (signedIn && !session) this.emit('logout', null);
      signedIn = session !== null;
    });
    this.oauthReturn = this.completeOAuth().catch((error) => {
      this.oauthError = asMurkioError(error);
      this.emit('error', this.oauthError);
      return null;
    });
  }

  get claims(): AccessClaims | null {
    return this.session.claims;
  }

  isSignedIn(): boolean {
    return this.session.isSignedIn();
  }

  /** A valid access token for calling your own API, or null. Refreshes it when needed. */
  getToken(): Promise<string | null> {
    return this.session.getToken();
  }

  /** `fetch` with `Authorization: Bearer <access token>` for your own API. */
  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }

  /** The signed-in user's profile (email, roles, 2FA), cached for a minute per session. */
  async getUser(): Promise<Me | null> {
    const token = await this.getToken();
    const sessionId = this.session.current?.sessionId;
    if (!token || !sessionId) return null;
    if (!this.user || this.user.sessionId !== sessionId || Date.now() - this.user.at > USER_TTL_MS) {
      this.user = { sessionId, at: Date.now(), value: this.api.me(token) };
      this.user.value.catch(() => {
        this.user = null;
      });
    }
    return this.user.value;
  }

  async signOut(): Promise<void> {
    this.user = null;
    await this.session.signOut();
  }

  /** Calls `listener` now and whenever the user signs in or out, in this tab or another. */
  onAuthChange(listener: (claims: AccessClaims | null) => void): () => void {
    listener(this.claims);
    return this.session.onChange(() => listener(this.claims));
  }

  on<T = unknown>(name: EventName, listener: (detail: T) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<T>).detail);
    this.events.addEventListener(name, handler);
    return () => this.events.removeEventListener(name, handler);
  }

  emit(name: EventName, detail: unknown): void {
    this.events.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Called by the flows once a session is stored: fires `login` and follows `afterLogin`. */
  signedIn(): void {
    this.emit('login', this.claims);
    if (this.options.afterLogin && typeof location !== 'undefined') location.assign(this.options.afterLogin);
  }

  /** The error of a social sign-in return on this page, for the canvas to show once. */
  takeOAuthError(): MurkioError | null {
    const error = this.oauthError;
    this.oauthError = null;
    return error;
  }

  /** The 2FA challenge left by a social sign-in return, for the canvas to pick up once. */
  takePendingMfa(): PendingMfa | null {
    const pending = this.pendingMfa;
    this.pendingMfa = null;
    return pending;
  }

  /**
   * The application id, its public config and the published canvas. The page
   * may inline it (`<script type="application/json" id="murkio-bootstrap"
   * data-generated-at="...">`, written by the backend SDKs); otherwise it is
   * fetched once and revalidated with its ETag, so most page loads cost a 304
   * at most.
   */
  bootstrap(): Promise<ClientBootstrap> {
    this.bootstrapping ??= this.loadBootstrap();
    return this.bootstrapping;
  }

  private async loadBootstrap(): Promise<ClientBootstrap> {
    const inline = typeof document !== 'undefined' ? document.getElementById('murkio-bootstrap') : null;
    const generatedAt = Number(inline?.dataset.generatedAt);
    if (inline?.textContent && Number.isFinite(generatedAt) && Math.abs(Date.now() - generatedAt) < INLINE_TTL_MS) {
      try {
        const data = JSON.parse(inline.textContent) as ClientBootstrap;
        if (data?.application_id && data.canvas) return data;
      } catch {
        /* fall back to the API */
      }
    }

    const key = `murkio.${this.keyHash}.bootstrap`;
    const cached = readJSON<CachedBootstrap>('localStorage', key);
    if (cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) return cached.data;

    try {
      const response = await this.api.bootstrap(cached?.etag ?? undefined);
      const data = response.notModified && cached ? cached.data : response.data;
      if (!data) throw new MurkioError('unknown', 0, [], 'empty bootstrap');
      store.set('localStorage', key, JSON.stringify({ etag: response.etag ?? cached?.etag ?? null, data, at: Date.now() }));
      return data;
    } catch (error) {
      this.reportSetupError(asMurkioError(error));
      if (cached) return cached.data;
      throw error;
    }
  }

  private reportSetupError(error: MurkioError): void {
    const origin = typeof location !== 'undefined' ? location.origin : 'this page';
    const hints: Record<string, string> = {
      'bss-10': `${origin} is not an allowed origin for this publishable key. Add it to the application's allowed origins.`,
      'bss-01': 'the publishable key is invalid, revoked or expired.',
      network: `could not reach ${this.api.apiUrl}. Check apiUrl; a CORS error in the console usually means the origin is not allowed.`,
    };
    console.error(`[murkio] ${hints[error.code] ?? `could not load the application (${error.code}).`}`);
  }

  /** Starts a social sign-in: the browser leaves for the provider and comes back to `oauthRedirectUrl`. */
  async startOAuth(provider: string, keepLogged: boolean): Promise<void> {
    const verifier = randomString(64);
    const state = randomString(32);
    const redirect = this.options.oauthRedirectUrl ?? `${location.origin}${location.pathname}`;
    const url = await this.api.authorizeOAuth(provider, { redirect_url: redirect, state, code_challenge: await codeChallenge(verifier) });
    store.set('sessionStorage', `murkio.${this.keyHash}.oauth`, JSON.stringify({ verifier, state, keepLogged } satisfies OAuthAttempt));
    location.assign(url);
  }

  private async completeOAuth(): Promise<LoginResult | null> {
    if (typeof location === 'undefined') return null;
    const key = `murkio.${this.keyHash}.oauth`;
    const attempt = readJSON<OAuthAttempt>('sessionStorage', key);
    const params = new URLSearchParams(location.search);
    if (!attempt || !params.get('state') || params.get('state') !== attempt.state) return null;

    store.remove('sessionStorage', key);
    const code = params.get('code');
    const error = params.get('error');
    for (const name of ['code', 'state', 'error']) params.delete(name);
    const query = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);

    if (error || !code) throw new MurkioError(`oauth.${error ?? 'server_error'}`, 0);

    const result = await this.api.exchangeOAuthCode({ code, code_verifier: attempt.verifier });
    if (result.kind === 'session') {
      this.session.setSession(result.tokens, attempt.keepLogged);
      this.signedIn();
    } else {
      this.pendingMfa = { mfa: result.mfa, keepLogged: attempt.keepLogged };
      this.emit('mfa', result.mfa);
    }
    return result;
  }
}

let instance: Murkio | null = null;
const waiting: ((murkio: Murkio) => void)[] = [];

/** Creates the page's Murkio client. Calling it again with the same key returns the same client. */
export function init(options: MurkioOptions): Murkio {
  if (instance) {
    if (instance.options.publishableKey === options.publishableKey) return instance;
    instance.session.stop();
  }
  instance = new Murkio(options);
  for (const resolve of waiting.splice(0)) resolve(instance);
  return instance;
}

export function getMurkio(): Murkio | null {
  return instance;
}

/** Resolves once `init()` ran (the web components wait on this). */
export function whenReady(): Promise<Murkio> {
  return instance ? Promise.resolve(instance) : new Promise((resolve) => waiting.push(resolve));
}

/** For tests: forgets the page client. */
export function reset(): void {
  instance?.session.stop();
  instance = null;
}
