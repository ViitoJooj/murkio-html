import defaultCanvas from '@murkio/spec/canvas/default.json';
import { renderCanvas, type CanvasAction, type CanvasView, type FormValues } from '../canvas/render';
import { renderStep, type StepView } from '../canvas/steps';
import { adoptStyles, BASE_CSS } from '../canvas/styles';
import { canSignIn, sanitizeDocument } from '../canvas/validate';
import { translate } from '../errors';
import { FlowController, type FlowState } from '../flows';
import { detectLocale } from '../i18n';
import { whenReady } from '../murkio';
import type { CanvasDocument, CanvasScreen, PublicConfig } from '../types';

function usable(screen: CanvasScreen, config: PublicConfig | null): boolean {
  if (config && !config.methods.password) {
    return screen.elements.some((element) => element.type === 'oauth_button' && config.oauth_providers.includes(String(element.props.provider)));
  }
  return canSignIn(screen);
}

/**
 * The canvas to draw: the published one when it passes the SDK's own checks
 * and still has what the application's login needs, else the default canvas.
 */
export function pickCanvas(raw: unknown, config: PublicConfig | null): CanvasDocument {
  const { document, problems } = sanitizeDocument(raw);
  if (problems.length > 0 && raw !== undefined) console.warn('[murkio] the canvas has problems; affected elements were skipped:', problems);
  if (document && usable(document.screens.sign_in, config)) return document;
  return sanitizeDocument(defaultCanvas).document as CanvasDocument;
}

const documentStyles = new WeakSet<Document>();

/**
 * `<murkio-identity-canvas>` draws the application's published login canvas
 * and runs the whole sign-in on it (signup, email code, 2FA, password reset,
 * social sign-in). Attributes: `screen` (`sign_in` or `sign_up`), `locale`
 * and `light-dom` (render without a shadow root, for password managers that
 * do not look inside one). Set the `canvas` property to preview a document
 * without an API (the dashboard editor does this).
 */
export class MurkioIdentityCanvas extends HTMLElement {
  private container: HTMLElement | ShadowRoot | null = null;
  private view: CanvasView | null = null;
  private stepView: StepView | null = null;
  private flow: FlowController | null = null;
  private document: CanvasDocument | null = null;
  private config: PublicConfig | null = null;
  private locale = 'en';
  private observer: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private preview: unknown = undefined;
  private started = false;
  private lastError: unknown = null;
  private signedIn = false;

  /** Previews a canvas document (no API calls, actions do nothing). */
  set canvas(value: unknown) {
    this.preview = value;
    if (this.started) this.draw();
  }

  connectedCallback(): void {
    if (!this.container) {
      if (this.hasAttribute('light-dom')) {
        this.container = this;
        if (!documentStyles.has(document)) {
          documentStyles.add(document);
          adoptStyles(document, BASE_CSS.replace(':host { display: block; }', 'murkio-identity-canvas { display: block; }'));
        }
      } else {
        this.container = this.attachShadow({ mode: 'open' });
        adoptStyles(this.container, BASE_CSS);
      }
    }
    if (typeof ResizeObserver !== 'undefined' && !this.observer) {
      this.observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width) this.view?.layout(width);
      });
      this.observer.observe(this);
    }
    if (!this.started) {
      this.started = true;
      void this.start();
    }
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private async start(): Promise<void> {
    this.locale = detectLocale(this.getAttribute('locale') ?? undefined);
    if (this.preview !== undefined) {
      this.draw();
      return;
    }

    const murkio = await whenReady();
    this.locale = detectLocale(this.getAttribute('locale') ?? murkio.options.locale);
    let failed = false;
    try {
      const bootstrap = await murkio.bootstrap();
      this.config = bootstrap.config;
      this.document = pickCanvas(bootstrap.canvas.document, this.config);
    } catch {
      failed = true;
      this.document = pickCanvas(undefined, null);
    }

    this.flow = new FlowController(murkio);
    this.unsubscribe = this.flow.subscribe((state) => this.sync(state));
    this.draw();
    this.sync(this.flow.state);
    if (failed) this.view?.setMessage(translate('unknown', this.locale));
    await murkio.oauthReturn;
    const oauthError = murkio.takeOAuthError();
    if (oauthError) this.view?.setMessage(translate(oauthError.code, this.locale));
  }

  private draw(): void {
    if (!this.container) return;
    this.view?.root.remove();
    this.stepView?.root.remove();
    this.stepView = null;

    const canvas = this.preview !== undefined ? pickCanvas(this.preview, null) : (this.document as CanvasDocument);
    const screen = this.getAttribute('screen') === 'sign_up' ? 'sign_up' : 'sign_in';
    this.view = renderCanvas(this.container, canvas, {
      locale: this.locale,
      config: this.preview !== undefined ? null : this.config,
      screen,
      onAction: (action, values) => this.act(action, values),
    });
    this.view.layout(this.getBoundingClientRect().width || canvas.screens.sign_in.layouts.desktop.width);
  }

  private act(action: CanvasAction, values: FormValues): void {
    const flow = this.flow;
    if (!flow) return;
    switch (action.type) {
      case 'login':
        void flow.login(values);
        break;
      case 'register':
        void flow.register(values);
        break;
      case 'forgot':
        flow.forgot(values.email);
        break;
      case 'oauth':
        void flow.oauth(action.provider, values.keepLogged);
        break;
    }
  }

  private sync(state: FlowState): void {
    const view = this.view;
    if (!view || !this.container || !this.flow || !this.document) return;

    if (state.step.name === 'sign_in' || state.step.name === 'done') {
      this.stepView?.root.remove();
      this.stepView = null;
      view.root.hidden = false;
      view.setBusy(state.busy);
      if (state.error) view.setMessage(translate(state.error.code, this.locale));
      else view.setMessage(state.notice, 'notice');
    } else if (this.stepView?.step === state.step) {
      this.stepView.update(state);
    } else {
      this.stepView?.root.remove();
      view.root.hidden = true;
      this.stepView = renderStep(this.container, this.document, state, this.flow, this.locale);
      this.emit('murkio:step', { step: state.step.name });
    }

    if (state.error && state.error !== this.lastError) this.emit('murkio:error', state.error);
    this.lastError = state.error;
    if (state.step.name === 'done' && !this.signedIn) {
      this.signedIn = true;
      this.emit('murkio:login', null);
    }
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
