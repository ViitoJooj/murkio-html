import type { ApiClient } from './client';
import { MurkioError } from './errors';
import { decodeClaims } from './jwt';
import { deleteCookie, readCookie, readJSON, store, writeCookie } from './storage';
import type { AccessClaims, TokenPair } from './types';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
  ephemeral: boolean;
}

export interface CookieNames {
  session: string;
  uat: string;
  alive: string;
}

export interface SessionOptions {
  api: ApiClient;
  /** Hash of the publishable key (fnv1a32): names the storage keys and cookies. */
  keyHash: string;
  /** Share the session cookie with subdomains. Off by default: see the README before turning it on. */
  cookieDomain?: string;
  now?: () => number;
}

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 90_000;
const SIGNED_IN_MAX_AGE = 30 * 24 * 60 * 60;
const REUSE_CODES = new Set(['rsb-02', 'rsb-03', 'rsb-05']);

/**
 * Cookie names for a publishable key. On https the `__Host-` prefix pins the
 * cookie to this exact host (no Domain, Path=/, Secure), so a sibling
 * subdomain cannot plant its own session for the backend to read. With a
 * cookie domain the prefix becomes `__Secure-`; on http (localhost) there is
 * no prefix. Backend SDKs look for the same three names.
 */
export function cookieNames(keyHash: string, secure: boolean, cookieDomain?: string): CookieNames {
  const prefix = !secure ? '' : cookieDomain ? '__Secure-' : '__Host-';
  return {
    session: `${prefix}murkio_session_${keyHash}`,
    uat: `${prefix}murkio_uat_${keyHash}`,
    alive: `${prefix}murkio_alive_${keyHash}`,
  };
}

type Listener = (session: StoredSession | null) => void;

/**
 * SessionManager keeps the user's tokens.
 *
 * - One record in localStorage, shared by every tab: each tab holding its own
 *   copy of a rotating refresh token would sooner or later present a used one,
 *   and the API revokes the whole session on reuse (rsb-03).
 * - Refreshes run one at a time across tabs (Web Locks) and re-read the record
 *   inside the lock: a tab that waited finds the token another tab renewed.
 * - "Keep me signed in" off marks the record ephemeral and sets a session
 *   cookie; when the browser closes the cookie goes away, and the next start
 *   logs the session out.
 * - The access token is mirrored in a cookie so a backend rendering pages
 *   (Next, Express, Go) sees who is signed in.
 */
export class SessionManager {
  private readonly api: ApiClient;
  private readonly key: string;
  private readonly lockName: string;
  private readonly names: CookieNames;
  private readonly secure: boolean;
  private readonly cookieDomain: string | undefined;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private inflight: Promise<StoredSession | null> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last: string | null = null;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === this.key) this.changed();
  };
  private readonly onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.refreshIfDue();
  };

  constructor(options: SessionOptions) {
    this.api = options.api;
    this.key = `murkio.${options.keyHash}.session`;
    this.lockName = `murkio.${options.keyHash}.refresh`;
    this.secure = typeof location !== 'undefined' && location.protocol === 'https:';
    this.cookieDomain = options.cookieDomain;
    this.names = cookieNames(options.keyHash, this.secure, options.cookieDomain);
    this.now = options.now ?? Date.now;
  }

  get cookies(): CookieNames {
    return this.names;
  }

  /** Restores the session of a previous visit and keeps it fresh. */
  start(): void {
    const current = this.current;
    if (current?.ephemeral && readCookie(this.names.alive) === null) {
      void this.api.logout(current.refreshToken).catch(() => undefined);
      this.clear();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.onStorage);
      window.addEventListener('pageshow', this.onVisible);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    this.changed();
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.onStorage);
      window.removeEventListener('pageshow', this.onVisible);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get current(): StoredSession | null {
    const session = readJSON<StoredSession>('localStorage', this.key);
    return session && typeof session.refreshToken === 'string' ? session : null;
  }

  get claims(): AccessClaims | null {
    const session = this.current;
    return session ? decodeClaims(session.accessToken) : null;
  }

  isSignedIn(): boolean {
    return this.current !== null;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSession(tokens: TokenPair, keepLogged: boolean): StoredSession {
    const session: StoredSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: this.now() + tokens.expires_in * 1000,
      sessionId: tokens.session_id,
      ephemeral: !keepLogged,
    };
    store.set('localStorage', this.key, JSON.stringify(session));
    if (session.ephemeral) writeCookie(this.names.alive, '1', { secure: this.secure, domain: this.cookieDomain });
    else deleteCookie(this.names.alive, { secure: this.secure, domain: this.cookieDomain });
    this.changed();
    return session;
  }

  /**
   * A valid access token, refreshed first when it expires within `minValidityMs`.
   * Null when nobody is signed in or the session was revoked.
   */
  async getToken(minValidityMs = 30_000): Promise<string | null> {
    const session = this.current;
    if (!session) return null;
    if (session.expiresAt - this.now() > minValidityMs) return session.accessToken;
    const refreshed = await this.refresh();
    return refreshed?.accessToken ?? null;
  }

  /** Renews the tokens, once across tabs. Network errors keep the session and throw. */
  refresh(): Promise<StoredSession | null> {
    if (!this.inflight) {
      this.inflight = this.withLock(async () => {
        const before = this.current;
        if (!before) return null;
        if (before.expiresAt - this.now() > REFRESH_MARGIN_MS) return before;
        try {
          const pair = await this.api.refresh(before.refreshToken);
          const latest = this.current;
          return this.setSession(pair, !(latest ?? before).ephemeral);
        } catch (error) {
          if (error instanceof MurkioError && REUSE_CODES.has(error.code)) {
            this.clear();
            return null;
          }
          throw error;
        }
      }).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  async signOut(): Promise<void> {
    const session = this.current;
    this.clear();
    if (session) await this.api.logout(session.refreshToken).catch(() => undefined);
  }

  clear(): void {
    store.remove('localStorage', this.key);
    for (const name of Object.values(this.names)) deleteCookie(name, { secure: this.secure, domain: this.cookieDomain });
    this.changed();
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) return locks.request(this.lockName, task) as Promise<T>;
    return task();
  }

  private async refreshIfDue(): Promise<void> {
    const session = this.current;
    if (!session || session.expiresAt - this.now() > REFRESH_MARGIN_MS) return;
    await this.refresh().catch(() => undefined);
  }

  private changed(): void {
    const session = this.current;
    this.syncCookies(session);
    this.schedule(session);

    const signature = session ? `${session.sessionId}:${session.accessToken}` : null;
    if (signature === this.last) return;
    this.last = signature;
    for (const listener of this.listeners) listener(session);
  }

  private syncCookies(session: StoredSession | null): void {
    const attributes = { secure: this.secure, domain: this.cookieDomain };
    if (!session) {
      deleteCookie(this.names.session, attributes);
      deleteCookie(this.names.uat, attributes);
      return;
    }
    const remaining = (session.expiresAt - this.now()) / 1000;
    if (remaining > 0) writeCookie(this.names.session, session.accessToken, { ...attributes, maxAge: remaining });
    else deleteCookie(this.names.session, attributes);
    writeCookie(this.names.uat, '1', session.ephemeral ? attributes : { ...attributes, maxAge: SIGNED_IN_MAX_AGE });
  }

  private schedule(session: StoredSession | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!session) return;
    const delay = Math.max(0, session.expiresAt - REFRESH_MARGIN_MS - this.now());
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refreshIfDue();
      },
      Math.min(delay, 2_147_483_647),
    );
  }
}
