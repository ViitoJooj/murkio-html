import { pick, providerName, t } from '../i18n';
import type { CanvasDocument, CanvasElement, CanvasItem, CanvasLayout, CanvasScreen, PublicConfig } from '../types';
import { applyStyle, themeVariables } from './styles';

export type CanvasAction = { type: 'login' } | { type: 'register' } | { type: 'forgot' } | { type: 'oauth'; provider: string };

export interface FormValues {
  email: string;
  password: string;
  keepLogged: boolean;
}

export interface RenderOptions {
  locale: string;
  /** The public config; hides what the application turned off. Null shows everything (editor preview). */
  config?: PublicConfig | null;
  screen?: 'sign_in' | 'sign_up';
  onAction?: (action: CanvasAction, values: FormValues) => void;
}

export type LayoutName = 'desktop' | 'mobile' | 'stack';

export interface CanvasView {
  readonly root: HTMLElement;
  values(): FormValues;
  setMessage(message: string | null, kind?: 'error' | 'notice'): void;
  setBusy(busy: boolean): void;
  layout(width: number): LayoutName;
  focus(): void;
}

const DECORATIVE = new Set(['text', 'image', 'shape', 'divider']);
const PASSWORD_TYPES = new Set(['email_input', 'password_input', 'keep_logged', 'login_button', 'register_button', 'forgot_password_link']);
const MIN_SCALE = 0.75;
let instances = 0;

/**
 * Picks the layout for the width the canvas really has (its container, not the
 * viewport: it may sit in a modal or a sidebar). Layouts only shrink, never
 * grow, and never below 75%: under that the text would not fit the boxes, so
 * the mobile layout (or the stacked fallback) takes over.
 */
export function chooseLayout(screen: CanvasScreen, width: number): LayoutName {
  const { desktop, mobile } = screen.layouts;
  if (width >= desktop.width * MIN_SCALE) return 'desktop';
  if (mobile && width >= mobile.width * MIN_SCALE) return 'mobile';
  return 'stack';
}

function readingOrder(screen: CanvasScreen): CanvasElement[] {
  const items = screen.layouts.desktop.items;
  return [...screen.elements].sort((a, b) => {
    const ia = items[a.id] as CanvasItem;
    const ib = items[b.id] as CanvasItem;
    return ia.y - ib.y || ia.x - ib.x;
  });
}

function visible(element: CanvasElement, config: PublicConfig | null | undefined): boolean {
  if (!config) return true;
  if (!config.methods.password && PASSWORD_TYPES.has(element.type)) return false;
  if (element.type === 'oauth_button') return config.oauth_providers.includes(String(element.props.provider));
  return true;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eyeIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M12 5C6.5 5 2.7 9.1 1.5 12c1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.3 9.1 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  );
  svg.appendChild(path);
  return svg;
}

/**
 * Draws a canvas into `container` with DOM APIs only (textContent, attributes
 * and the CSSOM): nothing from the document is ever parsed as HTML or CSS.
 * Returns a handle the caller uses to read the fields, show errors and switch
 * layouts when the container resizes.
 */
export function renderCanvas(container: HTMLElement | ShadowRoot, canvas: CanvasDocument, options: RenderOptions): CanvasView {
  const prefix = `mk${++instances}`;
  const locale = options.locale;
  const screenName = options.screen === 'sign_up' && canvas.screens.sign_up ? 'sign_up' : 'sign_in';
  const screen = canvas.screens[screenName] as CanvasScreen;

  const root = el('div', 'mk-root');
  for (const [name, value] of Object.entries(themeVariables(canvas.theme))) root.style.setProperty(name, value);

  const form = el('form', 'mk-frame');
  form.noValidate = true;
  root.appendChild(form);

  const nodes = new Map<string, HTMLElement>();
  const buttons: HTMLButtonElement[] = [];
  const inputs: { email?: HTMLInputElement; password?: HTMLInputElement; keepLogged?: HTMLInputElement } = {};
  let messageSlot: HTMLElement | null = null;
  const errorId = `${prefix}-message`;

  const types = new Set(screen.elements.filter((element) => visible(element, options.config)).map((element) => element.type));
  const submitAction: CanvasAction['type'] = types.has('login_button') && screenName === 'sign_in' ? 'login' : 'register';

  const values = (): FormValues => ({
    email: inputs.email?.value ?? '',
    password: inputs.password?.value ?? '',
    keepLogged: inputs.keepLogged?.checked ?? false,
  });
  const act = (action: CanvasAction) => options.onAction?.(action, values());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    act({ type: submitAction } as CanvasAction);
  });

  for (const element of readingOrder(screen)) {
    const wrapper = el('div', 'mk-el');
    wrapper.dataset.id = element.id;
    wrapper.dataset.type = element.type;
    if (DECORATIVE.has(element.type)) wrapper.dataset.decorative = '';
    if (!visible(element, options.config)) wrapper.classList.add('mk-hidden');

    const label = pick(element.props.label as never, locale);
    const id = `${prefix}-${element.id}`;
    let styled: HTMLElement = wrapper;

    switch (element.type) {
      case 'email_input':
      case 'password_input': {
        const isPassword = element.type === 'password_input';
        const labelNode = el('label', 'mk-sr', label);
        labelNode.htmlFor = id;
        const input = el('input', 'mk-input');
        input.id = id;
        input.type = isPassword ? 'password' : 'email';
        input.name = isPassword ? 'password' : 'email';
        input.required = true;
        input.autocomplete = isPassword ? (screenName === 'sign_up' ? 'new-password' : 'current-password') : 'username';
        input.placeholder = pick(element.props.placeholder as never, locale) || label;
        if (!isPassword) {
          input.inputMode = 'email';
          input.spellcheck = false;
          input.setAttribute('autocapitalize', 'none');
        }
        input.setAttribute('aria-describedby', errorId);
        wrapper.appendChild(labelNode);
        if (isPassword) {
          const box = el('div', 'mk-password');
          box.appendChild(input);
          if (element.props.show_toggle === true) {
            const toggle = el('button', 'mk-toggle');
            toggle.type = 'button';
            toggle.setAttribute('aria-label', t(locale, 'password.show'));
            toggle.setAttribute('aria-pressed', 'false');
            toggle.appendChild(eyeIcon());
            toggle.addEventListener('click', () => {
              const showing = input.type === 'text';
              input.type = showing ? 'password' : 'text';
              toggle.setAttribute('aria-pressed', String(!showing));
              toggle.setAttribute('aria-label', t(locale, showing ? 'password.show' : 'password.hide'));
            });
            box.appendChild(toggle);
          }
          wrapper.appendChild(box);
          inputs.password = input;
        } else {
          wrapper.appendChild(input);
          inputs.email = input;
        }
        styled = input;
        break;
      }
      case 'keep_logged': {
        const labelNode = el('label', 'mk-check');
        const input = el('input');
        input.type = 'checkbox';
        input.name = 'keep_logged';
        input.checked = element.props.default_checked === true;
        labelNode.append(input, el('span', undefined, label));
        wrapper.appendChild(labelNode);
        inputs.keepLogged = input;
        styled = labelNode;
        break;
      }
      case 'login_button':
      case 'register_button': {
        const action = element.type === 'login_button' ? 'login' : 'register';
        const button = el('button', 'mk-button', label);
        button.type = action === submitAction ? 'submit' : 'button';
        button.dataset.action = action;
        if (button.type === 'button') button.addEventListener('click', () => act({ type: action }));
        wrapper.appendChild(button);
        buttons.push(button);
        styled = button;
        break;
      }
      case 'forgot_password_link': {
        const button = el('button', 'mk-link', label);
        button.type = 'button';
        button.dataset.action = 'forgot';
        button.addEventListener('click', () => act({ type: 'forgot' }));
        wrapper.appendChild(button);
        buttons.push(button);
        styled = button;
        break;
      }
      case 'oauth_button': {
        const provider = String(element.props.provider);
        const button = el(
          'button',
          'mk-button mk-button--secondary',
          pick(element.props.label as never, locale) || t(locale, 'oauth.continue', { provider: providerName(provider) }),
        );
        button.type = 'button';
        button.dataset.provider = provider;
        button.addEventListener('click', () => act({ type: 'oauth', provider }));
        wrapper.appendChild(button);
        buttons.push(button);
        styled = button;
        break;
      }
      case 'error_message': {
        const slot = el('div', 'mk-error');
        slot.id = errorId;
        slot.setAttribute('role', 'alert');
        slot.setAttribute('aria-live', 'polite');
        wrapper.appendChild(slot);
        messageSlot ??= slot;
        styled = slot;
        break;
      }
      case 'text': {
        const variant = String(element.props.variant ?? '');
        const tag = variant === 'h1' || variant === 'h2' || variant === 'h3' ? variant : 'p';
        const text = el(tag, 'mk-text', pick(element.props.text as never, locale));
        wrapper.appendChild(text);
        styled = text;
        break;
      }
      case 'link': {
        const link = el('a', 'mk-link', pick(element.props.text as never, locale));
        link.href = String(element.props.href);
        link.rel = 'noopener noreferrer';
        wrapper.appendChild(link);
        styled = link;
        break;
      }
      case 'image': {
        const image = el('img', 'mk-image');
        image.src = String(element.props.src);
        image.alt = pick(element.props.alt as never, locale);
        image.referrerPolicy = 'no-referrer';
        image.loading = 'lazy';
        image.decoding = 'async';
        wrapper.appendChild(image);
        styled = image;
        break;
      }
      case 'shape': {
        const shape = el('div', 'mk-shape');
        shape.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(shape);
        styled = shape;
        break;
      }
      case 'divider': {
        const divider = el('div', 'mk-divider');
        divider.setAttribute('role', 'separator');
        const text = pick(element.props.label as never, locale);
        if (text) divider.appendChild(el('span', undefined, text));
        wrapper.appendChild(divider);
        styled = divider;
        break;
      }
    }

    applyStyle(styled, element.style);
    nodes.set(element.id, wrapper);
    form.appendChild(wrapper);
  }

  if (!messageSlot) {
    const slot = el('div', 'mk-error');
    slot.id = errorId;
    slot.setAttribute('role', 'alert');
    slot.setAttribute('aria-live', 'polite');
    slot.style.marginTop = '8px';
    root.appendChild(slot);
    messageSlot = slot;
  }

  const apply = (name: LayoutName) => {
    root.dataset.layout = name;
    const layout: CanvasLayout = name === 'mobile' && screen.layouts.mobile ? screen.layouts.mobile : screen.layouts.desktop;
    form.style.maxWidth = name === 'stack' ? `${screen.layouts.desktop.width}px` : `${layout.width}px`;
    form.style.aspectRatio = name === 'stack' ? '' : `${layout.width} / ${layout.height}`;
    if (layout.background?.color) form.style.setProperty('--mk-frame-bg', layout.background.color);

    for (const element of screen.elements) {
      const node = nodes.get(element.id);
      const item = layout.items[element.id];
      if (!node || !item) continue;
      node.style.display = item.hidden ? 'none' : '';
      if (name === 'stack') {
        node.style.left = node.style.top = node.style.width = '';
        node.style.height = `${item.h}px`;
        node.style.zIndex = '';
        continue;
      }
      node.style.left = `${(item.x / layout.width) * 100}%`;
      node.style.top = `${(item.y / layout.height) * 100}%`;
      node.style.width = `${(item.w / layout.width) * 100}%`;
      node.style.height = `${(item.h / layout.height) * 100}%`;
      node.style.zIndex = String(DECORATIVE.has(element.type) ? item.z : 2000 + item.z);
    }
  };
  let current: LayoutName | null = null;

  const view: CanvasView = {
    root,
    values,
    setMessage(message, kind = 'error') {
      const slot = messageSlot as HTMLElement;
      slot.textContent = message ?? '';
      slot.dataset.kind = kind;
      slot.style.color = kind === 'notice' ? 'var(--mk-text)' : '';
      for (const input of [inputs.email, inputs.password]) {
        if (input) input.setAttribute('aria-invalid', String(Boolean(message) && kind === 'error'));
      }
    },
    setBusy(busy) {
      form.setAttribute('aria-busy', String(busy));
      for (const button of buttons) button.disabled = busy;
    },
    layout(width) {
      const name = chooseLayout(screen, width);
      if (name !== current) {
        current = name;
        apply(name);
      }
      return name;
    },
    focus() {
      (inputs.email ?? inputs.password)?.focus();
    },
  };

  view.layout(screen.layouts.desktop.width);
  container.appendChild(root);
  return view;
}
