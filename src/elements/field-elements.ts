import defaultCanvas from '../../spec/canvas/default.json';
import { renderStep, type StepView } from '../canvas/steps';
import { adoptStyles, BASE_CSS } from '../canvas/styles';
import { translate } from '../errors';
import { FlowController, type FlowState } from '../flows';
import { detectLocale } from '../i18n';
import { whenReady, type Murkio } from '../murkio';
import type { CanvasDocument } from '../types';
import { pickCanvas } from './canvas-element';
import { BaseElement } from './base';

type Listener = (state: FlowState | null) => void;

/**
 * FormStore joins the standalone components of one form: the inputs write the
 * values, the buttons run the flow with them. Components without a `form`
 * attribute share the page's default store; give them `form="x"` to have two
 * independent forms on one page.
 */
export class FormStore {
  email = '';
  password = '';
  keepLogged = false;
  private flow: FlowController | null = null;
  private murkio: Murkio | null = null;
  private readonly listeners = new Set<Listener>();
  private dialog: StepDialog | null = null;
  private source: HTMLElement | null = null;
  private lastError: unknown = null;
  private signedIn = false;

  get state(): FlowState | null {
    return this.flow?.state ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async run(action: 'login' | 'register', source: HTMLElement): Promise<void> {
    const flow = await this.ensureFlow();
    const credentials = { email: this.email, password: this.password, keepLogged: this.keepLogged };
    this.source = source;
    await (action === 'login' ? flow.login(credentials) : flow.register(credentials));
  }

  private async ensureFlow(): Promise<FlowController> {
    if (this.flow) return this.flow;
    this.murkio = await whenReady();
    this.flow = new FlowController(this.murkio);
    this.flow.subscribe((state) => this.changed(state));
    return this.flow;
  }

  private changed(state: FlowState): void {
    for (const listener of this.listeners) listener(state);
    const inStep = state.step.name !== 'sign_in' && state.step.name !== 'done';
    if (inStep && this.flow && this.murkio) {
      this.dialog ??= new StepDialog(this.flow, this.murkio);
      void this.dialog.show(state);
    } else {
      this.dialog?.close();
    }
    if (state.error && state.error !== this.lastError) this.emit('murkio-error', state.error);
    this.lastError = state.error;
    if (state.step.name === 'done' && !this.signedIn) {
      this.signedIn = true;
      this.emit('murkio-login', null);
    }
  }

  private emit(name: string, detail: unknown): void {
    (this.source ?? document).dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

const stores = new Map<string, FormStore>();

export function formStore(name = ''): FormStore {
  let store = stores.get(name);
  if (!store) {
    store = new FormStore();
    stores.set(name, store);
  }
  return store;
}

/**
 * The email code, 2FA and reset screens of the standalone components open in a
 * modal `<dialog>`, painted with the application's canvas theme: the page only
 * has the inputs and buttons the developer placed.
 */
class StepDialog {
  private dialog: HTMLDialogElement | null = null;
  private shadow: ShadowRoot | null = null;
  private view: StepView | null = null;
  private canvas: CanvasDocument | null = null;

  constructor(
    private readonly flow: FlowController,
    private readonly murkio: Murkio,
  ) {}

  async show(state: FlowState): Promise<void> {
    if (!this.canvas) {
      const bootstrap = await this.murkio.bootstrap().catch(() => null);
      this.canvas = bootstrap ? pickCanvas(bootstrap.canvas.document, bootstrap.config) : (pickCanvas(defaultCanvas, null) as CanvasDocument);
    }
    if (!this.dialog) {
      this.dialog = document.createElement('dialog');
      this.dialog.className = 'murkio-dialog';
      this.dialog.style.padding = '0';
      this.dialog.style.border = '0';
      this.dialog.style.borderRadius = '12px';
      this.dialog.addEventListener('cancel', () => this.flow.back());
      const host = document.createElement('div');
      this.shadow = host.attachShadow({ mode: 'open' });
      adoptStyles(this.shadow, BASE_CSS);
      this.dialog.appendChild(host);
      document.body.appendChild(this.dialog);
    }
    if (this.view?.step === state.step) {
      this.view.update(state);
    } else {
      this.view?.root.remove();
      this.view = renderStep(this.shadow as ShadowRoot, this.canvas, state, this.flow, this.murkio.locale);
    }
    if (!this.dialog.open) {
      if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
      else this.dialog.setAttribute('open', '');
    }
  }

  close(): void {
    if (!this.dialog) return;
    this.view?.root.remove();
    this.view = null;
    if (this.dialog.open) {
      if (typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
    }
  }
}

/**
 * Base of the standalone components. They render real form controls in the
 * light DOM (no shadow root), so the developer's CSS and utility classes reach
 * them: the element's `class` is copied to the control, and the element itself
 * uses `display: contents` so it adds no box to the layout.
 */
abstract class FieldElement<T extends HTMLElement> extends BaseElement {
  static observedAttributes = ['class', 'placeholder', 'label'];
  protected control: T | null = null;
  protected store: FormStore = formStore();
  private unsubscribe: (() => void) | null = null;

  protected abstract create(): T;

  connectedCallback(): void {
    this.store = formStore(this.getAttribute('form') ?? '');
    if (!this.control) {
      this.control = this.create();
      this.style.display = 'contents';
      this.appendChild(this.control);
    }
    this.sync();
    this.unsubscribe = this.store.subscribe((state) => this.stateChanged(state));
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  attributeChangedCallback(): void {
    this.sync();
  }

  protected sync(): void {
    if (!this.control) return;
    const className = this.getAttribute('class');
    if (className) this.control.setAttribute('class', className);
    else this.control.removeAttribute('class');
  }

  protected stateChanged(_state: FlowState | null): void {}

  protected locale(): string {
    return detectLocale(this.getAttribute('locale') ?? undefined);
  }
}

abstract class InputElement extends FieldElement<HTMLInputElement> {
  protected abstract readonly kind: 'email' | 'password';

  protected create(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = this.kind;
    input.name = this.kind;
    input.required = true;
    input.autocomplete = (this.getAttribute('autocomplete') ?? (this.kind === 'email' ? 'username' : 'current-password')) as AutoFill;
    if (this.kind === 'email') {
      input.inputMode = 'email';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'none');
    }
    input.addEventListener('input', () => {
      if (this.kind === 'email') this.store.email = input.value;
      else this.store.password = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.store.run('login', input);
      }
    });
    return input;
  }

  protected override sync(): void {
    super.sync();
    const input = this.control;
    if (!input) return;
    const placeholder = this.getAttribute('placeholder');
    if (placeholder !== null) input.placeholder = placeholder;
    const label = this.getAttribute('label') ?? placeholder;
    if (label) input.setAttribute('aria-label', label);
  }

  protected override stateChanged(state: FlowState | null): void {
    if (this.control) this.control.setAttribute('aria-invalid', String(Boolean(state?.error)));
  }
}

export class MurkioIdentityEmailInput extends InputElement {
  protected readonly kind = 'email';
}

export class MurkioIdentityPasswordInput extends InputElement {
  protected readonly kind = 'password';
}

/** `<murkio-identity-keep-logged label="...">`: the "keep me signed in" checkbox. */
export class MurkioIdentityKeepLogged extends FieldElement<HTMLLabelElement> {
  private input: HTMLInputElement | null = null;
  private text: HTMLSpanElement | null = null;

  protected create(): HTMLLabelElement {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'keep_logged';
    input.checked = this.hasAttribute('checked');
    this.store.keepLogged = input.checked;
    input.addEventListener('change', () => {
      this.store.keepLogged = input.checked;
    });
    const text = document.createElement('span');
    text.textContent = this.getAttribute('label') ?? this.textContent?.trim() ?? '';
    this.textContent = '';
    label.append(input, text);
    this.input = input;
    this.text = text;
    return label;
  }

  protected override sync(): void {
    super.sync();
    const label = this.getAttribute('label');
    if (label !== null && this.text) this.text.textContent = label;
    if (this.input) this.store.keepLogged = this.input.checked;
  }
}

abstract class ActionElement extends FieldElement<HTMLButtonElement> {
  protected abstract readonly action: 'login' | 'register';

  protected create(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this.getAttribute('label') ?? (this.textContent?.trim() || '');
    this.textContent = '';
    button.addEventListener('click', () => void this.store.run(this.action, this));
    return button;
  }

  protected override sync(): void {
    super.sync();
    const label = this.getAttribute('label');
    if (label !== null && this.control) this.control.textContent = label;
  }

  protected override stateChanged(state: FlowState | null): void {
    if (!this.control) return;
    this.control.disabled = state?.busy ?? false;
    this.control.setAttribute('aria-busy', String(state?.busy ?? false));
  }
}

export class MurkioIdentityLoginButton extends ActionElement {
  protected readonly action = 'login';
}

export class MurkioIdentityRegisterButton extends ActionElement {
  protected readonly action = 'register';
}

/** `<murkio-identity-error>`: shows the translated error of its form (role="alert"). */
export class MurkioIdentityError extends FieldElement<HTMLDivElement> {
  protected create(): HTMLDivElement {
    const node = document.createElement('div');
    node.setAttribute('role', 'alert');
    node.setAttribute('aria-live', 'polite');
    return node;
  }

  protected override stateChanged(state: FlowState | null): void {
    if (!this.control) return;
    const inForm = !state || state.step.name === 'sign_in';
    this.control.textContent = inForm && state?.error ? translate(state.error.code, this.locale()) : inForm ? (state?.notice ?? '') : '';
  }
}
