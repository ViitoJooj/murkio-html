import { beforeEach, describe, expect, it } from 'vitest';
import { FlowController } from '../src/flows';
import { Murkio } from '../src/murkio';
import { apiError, clearCookies, fakeFetch, tokens } from './helpers';

type Routes = Parameters<typeof fakeFetch>[0];

function setup(routes: Routes) {
  const { fetch, calls } = fakeFetch(routes);
  const murkio = new Murkio({ publishableKey: 'pk_flow', apiUrl: 'https://api.example.com', locale: 'pt-BR', fetch });
  const logins: unknown[] = [];
  murkio.on('login', (claims) => logins.push(claims));
  const flow = new FlowController(murkio);
  return { murkio, flow, calls, logins };
}

const credentials = { email: '  Ana@Example.com ', password: 'S3nha!forte', keepLogged: true };
const session = () => ({ status: 200, body: { data: tokens() } });
const mfa = (enrollment = false) => ({ status: 200, body: { data: { mfa: { token: 'mfa_1', enrollment_required: enrollment, expires_in: 300 } } } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
});

describe('FlowController', () => {
  it('signs in with a password', async () => {
    const { murkio, flow, calls, logins } = setup({ 'POST /v1/login': session });
    await flow.login(credentials);

    expect(calls[0]?.body).toEqual({ email: 'ana@example.com', password: 'S3nha!forte' });
    expect(flow.state.step.name).toBe('done');
    expect(murkio.isSignedIn()).toBe(true);
    expect(murkio.session.current?.ephemeral).toBe(false);
    expect(logins).toHaveLength(1);
  });

  it('keeps an ephemeral session without keep me signed in', async () => {
    const { murkio, flow } = setup({ 'POST /v1/login': session });
    await flow.login({ ...credentials, keepLogged: false });
    expect(murkio.session.current?.ephemeral).toBe(true);
  });

  it('shows the API error and stays on the sign-in step', async () => {
    const { flow } = setup({ 'POST /v1/login': () => apiError(401, 'rsb-00') });
    await flow.login(credentials);
    expect(flow.state.step.name).toBe('sign_in');
    expect(flow.state.error?.code).toBe('rsb-00');
    expect(flow.state.busy).toBe(false);
  });

  it('goes through the 2FA challenge', async () => {
    const { flow, calls } = setup({ 'POST /v1/login': () => mfa(), 'POST /v1/mfa/challenge/verify': session });
    await flow.login(credentials);
    expect(flow.state.step).toEqual({ name: 'mfa', token: 'mfa_1' });

    await flow.verifyMfa('mfa_1', ' 123456 ');
    expect(calls[1]?.body).toEqual({ mfa_token: 'mfa_1', code: '123456' });
    expect(flow.state.step.name).toBe('done');
  });

  it('enrolls an authenticator when the application requires 2FA', async () => {
    const { murkio, flow } = setup({
      'POST /v1/login': () => mfa(true),
      'POST /v1/mfa/challenge/enroll': () => ({ status: 200, body: { data: { secret: 'JBSWY3DP', otpauth_uri: 'otpauth://totp/x' } } }),
      'POST /v1/mfa/challenge/enroll/confirm': () => ({ status: 200, body: { data: { recovery_codes: ['aaaa-bbbb'], session: tokens() } } }),
    });
    await flow.login(credentials);
    expect(flow.state.step).toMatchObject({ name: 'mfa_enroll', secret: 'JBSWY3DP' });

    await flow.confirmEnrollment('mfa_1', '123456');
    expect(flow.state.step).toEqual({ name: 'recovery_codes', codes: ['aaaa-bbbb'] });
    expect(murkio.isSignedIn()).toBe(false);

    flow.finishRecovery();
    expect(flow.state.step.name).toBe('done');
    expect(murkio.isSignedIn()).toBe(true);
  });

  it('sends the email code when the email is not verified and signs in after it', async () => {
    const { flow, calls } = setup({
      'POST /v1/login': () => apiError(403, 'rsb-07'),
      'POST /v1/email/verification': () => ({ status: 202 }),
      'POST /v1/email/verification/confirm': session,
    });
    await flow.login(credentials);
    expect(flow.state.step).toEqual({ name: 'verify_email', email: 'ana@example.com', needsPassword: false });
    expect(calls[1]?.body).toEqual({ email: 'ana@example.com', locale: 'pt-BR' });

    await flow.confirmEmail('654321');
    expect(calls[2]?.body).toEqual({ email: 'ana@example.com', code: '654321', password: 'S3nha!forte' });
    expect(flow.state.step.name).toBe('done');
  });

  it('signs up, confirms the code and goes back to sign in when the application does not log in on verify', async () => {
    const { murkio, flow } = setup({
      'POST /v1/signup': () => ({ status: 202, body: { data: { message: 'ok' } } }),
      'POST /v1/email/verification/confirm': () => ({ status: 204 }),
    });
    await flow.register(credentials);
    expect(flow.state.step.name).toBe('verify_email');

    await flow.confirmEmail('111111');
    expect(flow.state.step.name).toBe('sign_in');
    expect(flow.state.notice).toBe('E-mail confirmado. Entre para continuar.');
    expect(murkio.isSignedIn()).toBe(false);
  });

  it('asks for the password again when it is no longer in memory', async () => {
    const { flow } = setup({});
    await flow.confirmEmail('111111');
    expect(flow.state.step).toMatchObject({ name: 'verify_email', needsPassword: true });
  });

  it('resets the password', async () => {
    const { flow, calls } = setup({ 'POST /v1/password/reset': () => ({ status: 202 }), 'POST /v1/password/reset/confirm': () => ({ status: 204 }) });
    flow.forgot('ana@example.com');
    expect(flow.state.step.name).toBe('forgot');

    await flow.requestReset('Ana@Example.com');
    expect(flow.state.step).toEqual({ name: 'reset', email: 'ana@example.com' });

    await flow.resetPassword('222222', 'Nov@senha1');
    expect(calls[1]?.body).toEqual({ email: 'ana@example.com', code: '222222', password: 'Nov@senha1' });
    expect(flow.state.step.name).toBe('sign_in');
    expect(flow.state.notice).toBe('Senha alterada. Entre com a nova.');
  });
});
