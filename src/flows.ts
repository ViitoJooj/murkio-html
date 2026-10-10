import { asMurkioError, MurkioError } from './errors';
import { t } from './i18n';
import type { Murkio } from './murkio';
import type { LoginResult, MFAChallenge, TokenPair } from './types';

export type Step =
  | { name: 'sign_in' }
  | { name: 'verify_email'; email: string; needsPassword: boolean }
  | { name: 'mfa'; token: string }
  | { name: 'mfa_enroll'; token: string; secret: string; otpauthUri: string }
  | { name: 'recovery_codes'; codes: string[] }
  | { name: 'forgot' }
  | { name: 'reset'; email: string }
  | { name: 'done' };

export interface FlowState {
  step: Step;
  busy: boolean;
  error: MurkioError | null;
  notice: string | null;
}

export interface Credentials {
  email: string;
  password: string;
  keepLogged: boolean;
}

type Listener = (state: FlowState) => void;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * FlowController walks a user through signing in: the password login, the
 * signup and its email code, the 2FA challenge (and the forced enrollment),
 * the password reset and the social sign-in. The canvas and the standalone
 * components draw its state; it holds the password only in memory, between
 * the signup and the email code, because the confirmation needs it.
 */
export class FlowController {
  private current: FlowState = { step: { name: 'sign_in' }, busy: false, error: null, notice: null };
  private readonly listeners = new Set<Listener>();
  private email = '';
  private password = '';
  private keepLogged = false;
  private pendingSession: TokenPair | null = null;

  constructor(private readonly murkio: Murkio) {
    const pending = murkio.takePendingMfa();
    if (pending) {
      this.keepLogged = pending.keepLogged;
      void this.run(() => this.challenge(pending.mfa));
    }
  }

  get state(): FlowState {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  login(credentials: Credentials): Promise<void> {
    return this.run(async () => {
      this.remember(credentials);
      try {
        await this.handle(await this.murkio.api.login({ email: this.email, password: this.password }));
      } catch (error) {
        if (!(error instanceof MurkioError) || error.code !== 'rsb-07') throw error;
        await this.murkio.api.sendVerification({ email: this.email, locale: this.murkio.locale });
        this.go({ name: 'verify_email', email: this.email, needsPassword: false });
      }
    });
  }

  register(credentials: Credentials): Promise<void> {
    return this.run(async () => {
      this.remember(credentials);
      await this.murkio.api.signup({ email: this.email, password: this.password, locale: this.murkio.locale });
      this.go({ name: 'verify_email', email: this.email, needsPassword: false });
    });
  }

  confirmEmail(code: string, password?: string): Promise<void> {
    return this.run(async () => {
      if (password) this.password = password;
      if (!this.password) {
        this.go({ name: 'verify_email', email: this.email, needsPassword: true });
        return;
      }
      const result = await this.murkio.api.confirmVerification({ email: this.email, code: code.trim(), password: this.password });
      if (result) {
        await this.handle(result);
        return;
      }
      this.password = '';
      this.go({ name: 'sign_in' }, t(this.murkio.locale, 'verified.signin'));
    });
  }

  resendEmail(): Promise<void> {
    return this.run(async () => {
      await this.murkio.api.sendVerification({ email: this.email, locale: this.murkio.locale });
      this.set({ notice: t(this.murkio.locale, 'verify.resent') });
    });
  }

  verifyMfa(token: string, code: string): Promise<void> {
    return this.run(async () => this.complete(await this.murkio.api.verifyMfa({ mfa_token: token, code: code.trim() })));
  }

  confirmEnrollment(token: string, code: string): Promise<void> {
    return this.run(async () => {
      const result = await this.murkio.api.confirmMfaEnrollment({ mfa_token: token, code: code.trim() });
      this.pendingSession = result.session;
      this.go({ name: 'recovery_codes', codes: result.recovery_codes });
    });
  }

  finishRecovery(): void {
    if (this.pendingSession) this.complete(this.pendingSession);
  }

  forgot(email = ''): void {
    if (email) this.email = normalizeEmail(email);
    this.go({ name: 'forgot' });
  }

  requestReset(email: string): Promise<void> {
    return this.run(async () => {
      this.email = normalizeEmail(email);
      await this.murkio.api.requestPasswordReset({ email: this.email, locale: this.murkio.locale });
      this.go({ name: 'reset', email: this.email });
    });
  }

  resetPassword(code: string, password: string): Promise<void> {
    return this.run(async () => {
      await this.murkio.api.confirmPasswordReset({ email: this.email, code: code.trim(), password });
      this.go({ name: 'sign_in' }, t(this.murkio.locale, 'reset.done'));
    });
  }

  oauth(provider: string, keepLogged: boolean): Promise<void> {
    return this.run(() => this.murkio.startOAuth(provider, keepLogged));
  }

  back(): void {
    this.password = '';
    this.go({ name: 'sign_in' });
  }

  get currentEmail(): string {
    return this.email;
  }

  private remember(credentials: Credentials): void {
    this.email = normalizeEmail(credentials.email);
    this.password = credentials.password;
    this.keepLogged = credentials.keepLogged;
  }

  private async handle(result: LoginResult): Promise<void> {
    if (result.kind === 'session') this.complete(result.tokens);
    else await this.challenge(result.mfa);
  }

  private async challenge(mfa: MFAChallenge): Promise<void> {
    if (!mfa.enrollment_required) {
      this.go({ name: 'mfa', token: mfa.token });
      return;
    }
    const enrollment = await this.murkio.api.startMfaEnrollment({ mfa_token: mfa.token });
    this.go({ name: 'mfa_enroll', token: mfa.token, secret: enrollment.secret, otpauthUri: enrollment.otpauth_uri });
  }

  private complete(tokens: TokenPair): void {
    this.murkio.session.setSession(tokens, this.keepLogged);
    this.password = '';
    this.pendingSession = null;
    this.go({ name: 'done' });
    this.murkio.signedIn();
  }

  private go(step: Step, notice: string | null = null): void {
    this.set({ step, error: null, notice });
  }

  private set(patch: Partial<FlowState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    if (this.current.busy) return;
    this.set({ busy: true, error: null, notice: null });
    try {
      await task();
    } catch (error) {
      const failure = asMurkioError(error);
      this.set({ error: failure });
      this.murkio.emit('error', failure);
    } finally {
      this.set({ busy: false });
    }
  }
}
