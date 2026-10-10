import { translate } from '../errors';
import type { FlowController, FlowState, Step } from '../flows';
import { t, type StringKey } from '../i18n';
import type { CanvasDocument } from '../types';
import { themeVariables } from './styles';

let steps = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Field {
  input: HTMLInputElement;
  wrapper: HTMLElement;
}

function field(prefix: string, name: string, label: string, type: string, autocomplete: string): Field {
  const wrapper = el('div');
  const labelNode = el('label', 'mk-sr', label);
  const input = el('input', 'mk-input');
  input.id = `${prefix}-${name}`;
  input.name = name;
  input.type = type;
  input.required = true;
  input.placeholder = label;
  input.autocomplete = autocomplete as AutoFill;
  input.setAttribute('aria-describedby', `${prefix}-message`);
  if (autocomplete === 'one-time-code') {
    input.inputMode = 'text';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'none');
  }
  labelNode.htmlFor = input.id;
  wrapper.append(labelNode, input);
  return { input, wrapper };
}

function button(label: string, kind: 'primary' | 'secondary' | 'link', type: 'submit' | 'button' = 'button'): HTMLButtonElement {
  const node = el('button', kind === 'link' ? 'mk-link' : kind === 'secondary' ? 'mk-button mk-button--secondary' : 'mk-button', label);
  node.type = type;
  return node;
}

/**
 * Draws the built-in screen of a flow step (email code, 2FA, enrollment,
 * recovery codes, password reset) with the canvas theme. The customer only
 * designs the sign-in (and sign-up) screen; these follow its colors and font.
 * Returns null for the steps the canvas itself shows (sign_in, done).
 */
export interface StepView {
  readonly root: HTMLElement;
  readonly step: Step;
  update(state: FlowState): void;
}

export function renderStep(container: HTMLElement | ShadowRoot, canvas: CanvasDocument, state: FlowState, flow: FlowController, locale: string): StepView | null {
  const step: Step = state.step;
  if (step.name === 'sign_in' || step.name === 'done') return null;

  const prefix = `mks${++steps}`;
  const root = el('div', 'mk-root');
  for (const [name, value] of Object.entries(themeVariables(canvas.theme))) root.style.setProperty(name, value);

  const form = el('form', 'mk-step');
  form.noValidate = true;
  form.setAttribute('aria-busy', String(state.busy));
  root.appendChild(form);

  const say = (key: StringKey, params?: Record<string, string>) => t(locale, key, params);
  const heading = (title: StringKey, description: StringKey, params?: Record<string, string>) => {
    const h2 = el('h2', undefined, say(title));
    h2.tabIndex = -1;
    form.append(h2, el('p', undefined, say(description, params)));
    return h2;
  };

  let submit: () => void = () => undefined;
  let title: HTMLElement;
  const controls: HTMLButtonElement[] = [];

  switch (step.name) {
    case 'verify_email': {
      title = heading('verify.title', 'verify.description', { email: step.email });
      const code = field(prefix, 'code', say('verify.code'), 'text', 'one-time-code');
      form.appendChild(code.wrapper);
      let password: Field | null = null;
      if (step.needsPassword) {
        password = field(prefix, 'password', say('verify.password'), 'password', 'current-password');
        form.appendChild(password.wrapper);
      }
      const resend = button(say('verify.resend'), 'link');
      resend.addEventListener('click', () => void flow.resendEmail());
      controls.push(button(say('verify.submit'), 'primary', 'submit'), resend);
      submit = () => void flow.confirmEmail(code.input.value, password?.input.value);
      break;
    }
    case 'mfa': {
      title = heading('mfa.title', 'mfa.description');
      const code = field(prefix, 'code', say('mfa.code'), 'text', 'one-time-code');
      form.appendChild(code.wrapper);
      controls.push(button(say('mfa.submit'), 'primary', 'submit'));
      submit = () => void flow.verifyMfa(step.token, code.input.value);
      break;
    }
    case 'mfa_enroll': {
      title = heading('enroll.title', 'enroll.description');
      const secret = el('p');
      secret.append(el('span', undefined, `${say('enroll.secret')}: `), el('code', undefined, step.secret));
      const open = el('a', 'mk-link', say('enroll.open'));
      open.href = step.otpauthUri.startsWith('otpauth://') ? step.otpauthUri : '#';
      const code = field(prefix, 'code', say('enroll.code'), 'text', 'one-time-code');
      form.append(secret, open, code.wrapper);
      controls.push(button(say('enroll.submit'), 'primary', 'submit'));
      submit = () => void flow.confirmEnrollment(step.token, code.input.value);
      break;
    }
    case 'recovery_codes': {
      title = heading('recovery.title', 'recovery.description');
      const list = el('ol', 'mk-codes');
      for (const code of step.codes) list.appendChild(el('li', undefined, code));
      form.appendChild(list);
      controls.push(button(say('recovery.done'), 'primary', 'submit'));
      submit = () => flow.finishRecovery();
      break;
    }
    case 'forgot': {
      title = heading('forgot.title', 'forgot.description');
      const email = field(prefix, 'email', say('forgot.email'), 'email', 'username');
      email.input.value = flow.currentEmail;
      form.appendChild(email.wrapper);
      controls.push(button(say('forgot.submit'), 'primary', 'submit'));
      submit = () => void flow.requestReset(email.input.value);
      break;
    }
    case 'reset': {
      title = heading('reset.title', 'reset.description', { email: step.email });
      const code = field(prefix, 'code', say('reset.code'), 'text', 'one-time-code');
      const password = field(prefix, 'password', say('reset.password'), 'password', 'new-password');
      form.append(code.wrapper, password.wrapper);
      controls.push(button(say('reset.submit'), 'primary', 'submit'));
      submit = () => void flow.resetPassword(code.input.value, password.input.value);
      break;
    }
  }

  const message = el('div', 'mk-error');
  message.id = `${prefix}-message`;
  message.setAttribute('role', 'alert');
  message.setAttribute('aria-live', 'polite');
  form.appendChild(message);

  if (step.name !== 'recovery_codes') {
    const back = button(say('back'), 'link');
    back.addEventListener('click', () => flow.back());
    controls.push(back);
  }
  for (const control of controls) form.appendChild(control);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  const update = (next: FlowState) => {
    form.setAttribute('aria-busy', String(next.busy));
    for (const control of controls) control.disabled = next.busy;
    message.textContent = next.error ? translate(next.error.code, locale) : next.notice ?? '';
    message.style.color = !next.error && next.notice ? 'var(--mk-text)' : '';
    for (const input of form.querySelectorAll('input')) input.setAttribute('aria-invalid', String(next.error !== null));
  };
  update(state);

  container.appendChild(root);
  queueMicrotask(() => (form.querySelector('input') ?? title).focus());
  return { root, step, update };
}
