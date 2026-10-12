import type { CanvasDocument, CanvasElement, CanvasLayout, CanvasScreen, CanvasStyle, ElementType, LocalizedText } from '../types';

/**
 * The server validates every canvas before it is stored, but the SDK checks it
 * again before drawing it on the customer's page (defense in depth: a bug or a
 * compromised dashboard must not become script, a fake link or an invisible
 * overlay on every login page). The rules mirror the server's structural ones
 * (spec/canvas); an element that breaks them is dropped, a style value out
 * of range is ignored, and a document without what a login needs is refused so
 * the caller falls back to the default canvas.
 */

export const ELEMENT_TYPES: readonly ElementType[] = [
  'email_input',
  'password_input',
  'keep_logged',
  'login_button',
  'register_button',
  'forgot_password_link',
  'oauth_button',
  'error_message',
  'text',
  'link',
  'image',
  'shape',
  'divider',
];
const PROVIDERS = ['google', 'github', 'apple', 'facebook', 'x'];
const FONTS = ['system-sans', 'system-serif', 'system-mono', 'inherit'];
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ELEMENT_ID = /^[a-z0-9_-]{1,32}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_ELEMENTS = 150;
const MAX_DATA_IMAGES = 4;
const MAX_DATA_IMAGE_CHARS = Math.ceil((64 * 1024) / 3) * 4;

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR.test(value);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

function cleanText(value: unknown, maxChars: number, multiline: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > maxChars) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n' && multiline) continue;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return false;
    }
  }
  return true;
}

function validText(value: unknown, maxChars = 120, multiline = false): value is LocalizedText {
  if (!isObject(value) || !cleanText(value.default, maxChars, multiline)) return false;
  if (value.i18n === undefined) return true;
  if (!isObject(value.i18n) || Object.keys(value.i18n).length > 20) return false;
  return Object.entries(value.i18n).every(([locale, text]) => LOCALE.test(locale) && cleanText(text, maxChars, multiline));
}

const optionalText = (value: unknown) => value === undefined || validText(value);

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export function isSafeHref(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/')) return value.length <= 2048 && !value.startsWith('//') && !/[\s\\]/.test(value);
  return isHttpsUrl(value);
}

function validProps(type: ElementType, props: Record<string, unknown>): boolean {
  switch (type) {
    case 'email_input':
    case 'password_input':
      return validText(props.label) && optionalText(props.placeholder);
    case 'keep_logged':
    case 'login_button':
    case 'register_button':
    case 'forgot_password_link':
      return validText(props.label);
    case 'oauth_button':
      return typeof props.provider === 'string' && PROVIDERS.includes(props.provider) && optionalText(props.label);
    case 'text':
      return validText(props.text, 500, true) && [undefined, '', 'body', 'h1', 'h2', 'h3'].includes(props.variant as string);
    case 'link':
      return validText(props.text) && isSafeHref(props.href);
    case 'image':
      return optionalText(props.alt) && (isHttpsUrl(props.src) || (typeof props.src === 'string' && props.src.length <= MAX_DATA_IMAGE_CHARS + 32 && DATA_IMAGE.test(props.src)));
    case 'divider':
      return optionalText(props.label);
    default:
      return true;
  }
}

const PROP_KEYS: Record<ElementType, readonly string[]> = {
  email_input: ['label', 'placeholder'],
  password_input: ['label', 'placeholder', 'show_toggle'],
  keep_logged: ['label', 'default_checked'],
  login_button: ['label'],
  register_button: ['label'],
  forgot_password_link: ['label'],
  oauth_button: ['provider', 'label'],
  error_message: [],
  text: ['text', 'variant'],
  link: ['text', 'href'],
  image: ['src', 'alt'],
  shape: [],
  divider: ['label'],
};

function cleanProps(type: ElementType, props: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of PROP_KEYS[type]) if (props[key] !== undefined) output[key] = props[key];
  return output;
}

const STYLE_KEYS = ['color', 'background', 'border_color', 'border_width', 'radius', 'font_size', 'font_weight', 'text_align', 'padding', 'opacity', 'shadow'];

function cleanStyle(style: unknown, problems: string[], path: string): CanvasStyle {
  const output = readStyle(style);
  if (isObject(style)) {
    for (const key of Object.keys(style)) {
      if (!STYLE_KEYS.includes(key) || !(key in output)) problems.push(`${path}.${key}: ignored style`);
    }
  }
  return output;
}

function readStyle(style: unknown): CanvasStyle {
  const output: CanvasStyle = {};
  if (!isObject(style)) return output;
  if (isColor(style.color)) output.color = style.color;
  if (isColor(style.background)) output.background = style.background;
  if (isColor(style.border_color)) output.border_color = style.border_color;
  if (isInt(style.border_width, 0, 8)) output.border_width = style.border_width;
  if (isInt(style.radius, 0, 999)) output.radius = style.radius;
  if (isInt(style.font_size, 12, 72)) output.font_size = style.font_size;
  if (isInt(style.font_weight, 100, 900) && style.font_weight % 100 === 0) output.font_weight = style.font_weight;
  if (style.text_align === 'left' || style.text_align === 'center' || style.text_align === 'right') output.text_align = style.text_align;
  if (isInt(style.padding, 0, 64)) output.padding = style.padding;
  if (typeof style.opacity === 'number' && style.opacity >= 0 && style.opacity <= 1) output.opacity = style.opacity;
  if (style.shadow === 'none' || style.shadow === 'sm' || style.shadow === 'md' || style.shadow === 'lg') output.shadow = style.shadow;
  return output;
}

function cleanLayout(value: unknown, problems: string[], path: string): CanvasLayout | null {
  if (!isObject(value) || !isInt(value.width, 240, 1920) || !isInt(value.height, 240, 2400) || !isObject(value.items)) {
    problems.push(`${path}: invalid layout`);
    return null;
  }
  const items: CanvasLayout['items'] = {};
  for (const [id, item] of Object.entries(value.items)) {
    if (
      isObject(item) &&
      isInt(item.x, 0, value.width) &&
      isInt(item.y, 0, value.height) &&
      isInt(item.w, 1, value.width) &&
      isInt(item.h, 1, value.height) &&
      item.x + item.w <= value.width &&
      item.y + item.h <= value.height &&
      isInt(item.z, 0, 1000)
    ) {
      items[id] = { x: item.x, y: item.y, w: item.w, h: item.h, z: item.z, hidden: item.hidden === true };
    } else {
      problems.push(`${path}.items.${id}: invalid item`);
    }
  }
  const background = isObject(value.background) && isColor(value.background.color) ? { color: value.background.color } : {};
  return { width: value.width, height: value.height, background, items };
}

function cleanScreen(value: unknown, problems: string[], path: string, images: { count: number }): CanvasScreen | null {
  if (!isObject(value) || !Array.isArray(value.elements) || !isObject(value.layouts)) {
    problems.push(`${path}: invalid screen`);
    return null;
  }

  const desktop = cleanLayout(value.layouts.desktop, problems, `${path}.layouts.desktop`);
  if (!desktop) return null;
  const mobile = value.layouts.mobile === undefined ? undefined : (cleanLayout(value.layouts.mobile, problems, `${path}.layouts.mobile`) ?? undefined);

  if (value.elements.length > MAX_ELEMENTS) problems.push(`${path}.elements: more than ${MAX_ELEMENTS} elements`);

  const ids = new Set<string>();
  const elements: CanvasElement[] = [];
  value.elements.slice(0, MAX_ELEMENTS).forEach((raw, index) => {
    const at = `${path}.elements[${index}]`;
    if (!isObject(raw) || typeof raw.id !== 'string' || !ELEMENT_ID.test(raw.id) || ids.has(raw.id)) {
      problems.push(`${at}: invalid or duplicate id`);
      return;
    }
    ids.add(raw.id);
    const type = raw.type as ElementType;
    const props = isObject(raw.props) ? raw.props : raw.props == null ? {} : null;
    if (!ELEMENT_TYPES.includes(type) || !props || !validProps(type, props)) {
      problems.push(`${at}: invalid ${String(raw.type)}`);
      return;
    }
    if (type === 'image' && String(props.src).startsWith('data:') && ++images.count > MAX_DATA_IMAGES) {
      problems.push(`${at}: more than ${MAX_DATA_IMAGES} embedded images`);
      return;
    }
    const layouts = mobile ? [desktop, mobile] : [desktop];
    if (layouts.some((layout) => !layout.items[raw.id as string])) {
      problems.push(`${at}: missing from a layout`);
      return;
    }
    elements.push({ id: raw.id, type, props: cleanProps(type, props), style: cleanStyle(raw.style, problems, `${at}.style`) });
  });

  for (const layout of mobile ? [desktop, mobile] : [desktop]) {
    for (const id of Object.keys(layout.items)) {
      if (!ids.has(id)) {
        problems.push(`${path}: item ${id} has no element`);
        delete layout.items[id];
      }
    }
  }

  return { elements, layouts: mobile ? { desktop, mobile } : { desktop } };
}

export interface SanitizeResult {
  document: CanvasDocument | null;
  problems: string[];
}

/**
 * Checks a canvas document. `document` is the cleaned canvas, or null when it
 * cannot be drawn (wrong schema, no sign_in screen or desktop layout, a broken
 * theme); `problems` lists everything that was wrong, for logging and tests.
 */
export function sanitizeDocument(value: unknown): SanitizeResult {
  const problems: string[] = [];
  if (!isObject(value) || value.schema !== 1 || !isObject(value.theme) || !isObject(value.screens)) {
    return { document: null, problems: ['not a schema 1 canvas'] };
  }

  const theme = value.theme;
  const colors = isObject(theme.colors) ? theme.colors : {};
  const names = ['primary', 'on_primary', 'text', 'muted', 'background', 'surface', 'border', 'error'] as const;
  if (!FONTS.includes(theme.font as string) || !isInt(theme.radius, 0, 32) || !names.every((name) => isColor(colors[name]))) {
    return { document: null, problems: ['invalid theme'] };
  }
  const known = new Set(['sign_in', 'sign_up']);
  for (const name of Object.keys(value.screens)) if (!known.has(name)) problems.push(`screens.${name}: unknown screen`);

  const images = { count: 0 };
  const signIn = cleanScreen(value.screens.sign_in, problems, 'screens.sign_in', images);
  if (!signIn) return { document: null, problems };
  const signUp = value.screens.sign_up === undefined ? undefined : (cleanScreen(value.screens.sign_up, problems, 'screens.sign_up', images) ?? undefined);

  const document: CanvasDocument = {
    schema: 1,
    theme: {
      font: theme.font as CanvasDocument['theme']['font'],
      radius: theme.radius as number,
      colors: Object.fromEntries(names.map((name) => [name, colors[name]])) as CanvasDocument['theme']['colors'],
    },
    screens: signUp ? { sign_in: signIn, sign_up: signUp } : { sign_in: signIn },
  };
  return { document, problems };
}

/** True when the screen still has what a password login needs (email, password and a submit action). */
export function canSignIn(screen: CanvasScreen): boolean {
  const types = new Set(screen.elements.map((element) => element.type));
  return types.has('email_input') && types.has('password_input') && (types.has('login_button') || types.has('register_button'));
}
