import { errorFromResponse, MurkioError } from './errors';
import type { ClientBootstrap, LoginResult, Me, MFAChallenge, TokenPair } from './types';

export const DEFAULT_API_URL = 'https://api.mukio.com';

export interface ApiClientOptions {
  publishableKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

interface Response<T> {
  status: number;
  data: T | null;
  headers: Headers;
}

/**
 * ApiClient talks to the identity API with the publishable key. Every method
 * maps one route; errors come back as MurkioError with the API code. It holds
 * no state: tokens live in the SessionManager.
 */
export class ApiClient {
  readonly apiUrl: string;
  private readonly publishableKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.publishableKey = options.publishableKey;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response<T>> {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${this.publishableKey}`, ...headers },
      credentials: 'omit',
    };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: globalThis.Response;
    try {
      response = await this.fetcher(this.apiUrl + path, init);
    } catch (error) {
      throw new MurkioError('network', 0, [], error instanceof Error ? error.message : 'network error');
    }

    const text = response.status === 204 || response.status === 304 ? '' : await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok && response.status !== 304) throw errorFromResponse(response.status, json);

    const data = (json as { data?: T } | null)?.data ?? null;
    return { status: response.status, data, headers: response.headers };
  }

  async bootstrap(etag?: string): Promise<{ notModified: boolean; etag: string | null; data: ClientBootstrap | null }> {
    const response = await this.request<ClientBootstrap>('GET', '/v1/client', undefined, etag ? { 'If-None-Match': etag } : {});
    return { notModified: response.status === 304, etag: response.headers.get('ETag'), data: response.data };
  }

  async signup(input: { email: string; password: string; locale?: string }): Promise<void> {
    await this.request('POST', '/v1/signup', input);
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    return loginResult((await this.request<TokenPair | { mfa: MFAChallenge }>('POST', '/v1/login', input)).data);
  }

  async sendVerification(input: { email: string; locale?: string }): Promise<void> {
    await this.request('POST', '/v1/email/verification', input);
  }

  /** Confirms the email. Returns the session (or the 2FA challenge), or null when the application does not sign in on verify. */
  async confirmVerification(input: { email: string; code: string; password: string }): Promise<LoginResult | null> {
    const response = await this.request<TokenPair | { mfa: MFAChallenge }>('POST', '/v1/email/verification/confirm', input);
    return response.status === 204 ? null : loginResult(response.data);
  }

  async requestPasswordReset(input: { email: string; locale?: string }): Promise<void> {
    await this.request('POST', '/v1/password/reset', input);
  }

  async confirmPasswordReset(input: { email: string; code: string; password: string }): Promise<void> {
    await this.request('POST', '/v1/password/reset/confirm', input);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return required((await this.request<TokenPair>('POST', '/v1/token/refresh', { refresh_token: refreshToken })).data);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.request('POST', '/v1/logout', { refresh_token: refreshToken });
  }

  async me(accessToken: string): Promise<Me> {
    return required((await this.request<Me>('POST', '/v1/me', { access_token: accessToken })).data);
  }

  async verifyMfa(input: { mfa_token: string; code: string }): Promise<TokenPair> {
    return required((await this.request<TokenPair>('POST', '/v1/mfa/challenge/verify', input)).data);
  }

  async startMfaEnrollment(input: { mfa_token: string }): Promise<{ secret: string; otpauth_uri: string }> {
    return required((await this.request<{ secret: string; otpauth_uri: string }>('POST', '/v1/mfa/challenge/enroll', input)).data);
  }

  async confirmMfaEnrollment(input: { mfa_token: string; code: string }): Promise<{ recovery_codes: string[]; session: TokenPair }> {
    return required((await this.request<{ recovery_codes: string[]; session: TokenPair }>('POST', '/v1/mfa/challenge/enroll/confirm', input)).data);
  }

  async authorizeOAuth(provider: string, input: { redirect_url: string; state: string; code_challenge: string }): Promise<string> {
    const response = await this.request<{ authorization_url: string }>('POST', `/v1/oauth/${encodeURIComponent(provider)}/authorize`, {
      ...input,
      code_challenge_method: 'S256',
    });
    return required(response.data).authorization_url;
  }

  async exchangeOAuthCode(input: { code: string; code_verifier: string }): Promise<LoginResult> {
    return loginResult((await this.request<TokenPair | { mfa: MFAChallenge }>('POST', '/v1/oauth/token', input)).data);
  }
}

function required<T>(data: T | null): T {
  if (data === null) throw new MurkioError('unknown', 0, [], 'empty response');
  return data;
}

function loginResult(data: TokenPair | { mfa: MFAChallenge } | null): LoginResult {
  const value = required(data);
  if ('mfa' in value) return { kind: 'mfa', mfa: value.mfa };
  return { kind: 'session', tokens: value };
}
