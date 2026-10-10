import type { CanvasDocument, CanvasStyle } from '../types';
import { isColor } from './validate';

const FONT_STACKS: Record<CanvasDocument['theme']['font'], string> = {
  'system-sans': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'system-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  'system-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  inherit: 'inherit',
};

const SHADOWS: Record<NonNullable<CanvasStyle['shadow']>, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
  md: '0 4px 12px rgba(0, 0, 0, 0.12)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.18)',
};

/**
 * Base rules of the canvas. They only read the --mk-* variables set from the
 * validated theme, so no value coming from the document ever becomes CSS text.
 * The focus ring is not reachable from the style allowlist on purpose.
 */
export const BASE_CSS = `
:host { display: block; }
.mk-root { font-family: var(--mk-font); color: var(--mk-text); box-sizing: border-box; width: 100%; }
.mk-root *, .mk-root *::before, .mk-root *::after { box-sizing: border-box; }
.mk-frame { position: relative; width: 100%; margin: 0 auto; background: var(--mk-frame-bg, transparent); }
.mk-el { position: absolute; display: flex; align-items: stretch; min-width: 0; min-height: 0; }
.mk-el[data-decorative] { pointer-events: none; }
.mk-root[data-layout="stack"] .mk-frame { display: flex; flex-direction: column; gap: 12px; padding: 24px 16px; aspect-ratio: auto !important; }
.mk-root[data-layout="stack"] .mk-el { position: static; width: 100% !important; }
.mk-hidden { display: none !important; }
.mk-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.mk-input { flex: 1; width: 100%; min-width: 0; font: inherit; font-size: var(--mk-fs, 16px); color: inherit; background: var(--mk-surface);
  border: 1px solid var(--mk-border); border-radius: var(--mk-radius); padding: 0 12px; }
.mk-input::placeholder { color: var(--mk-muted); }
.mk-password { position: relative; display: flex; flex: 1; min-width: 0; }
.mk-password .mk-input { padding-right: 44px; }
.mk-toggle { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border: 0; background: transparent;
  color: var(--mk-muted); cursor: pointer; border-radius: var(--mk-radius); font: inherit; font-size: 12px; }
.mk-button { flex: 1; font: inherit; font-size: var(--mk-fs, 16px); font-weight: 600; cursor: pointer; border-radius: var(--mk-radius);
  border: 1px solid transparent; background: var(--mk-primary); color: var(--mk-on-primary); padding: 0 16px; }
.mk-button[disabled] { opacity: 0.6; cursor: progress; }
.mk-button--secondary { background: var(--mk-surface); color: var(--mk-text); border-color: var(--mk-border); }
.mk-link { flex: 1; font: inherit; font-size: var(--mk-fs, 14px); background: transparent; border: 0; padding: 0; color: var(--mk-primary);
  cursor: pointer; text-decoration: underline; text-align: inherit; }
.mk-check { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs, 14px); cursor: pointer; }
.mk-check input { width: 18px; height: 18px; accent-color: var(--mk-primary); margin: 0; }
.mk-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--mk-fs, 16px); width: 100%; }
.mk-error { width: 100%; color: var(--mk-error); font-size: var(--mk-fs, 14px); }
.mk-image { width: 100%; height: 100%; object-fit: contain; }
.mk-shape { width: 100%; height: 100%; }
.mk-divider { display: flex; align-items: center; gap: 12px; width: 100%; color: var(--mk-muted); font-size: var(--mk-fs, 14px); }
.mk-divider::before, .mk-divider::after { content: ""; flex: 1; border-top: 1px solid var(--mk-border); }
.mk-root :focus-visible { outline: 2px solid var(--mk-primary); outline-offset: 2px; }
.mk-step { display: flex; flex-direction: column; gap: 12px; max-width: 400px; margin: 0 auto; padding: 24px; background: var(--mk-bg); }
.mk-step h2 { margin: 0; font-size: 22px; }
.mk-step p { margin: 0; color: var(--mk-muted); }
.mk-step .mk-input, .mk-step .mk-button { min-height: 44px; }
.mk-step code { font-family: ${FONT_STACKS['system-mono']}; font-size: 15px; word-break: break-all; }
.mk-codes { margin: 0; padding-left: 20px; columns: 2; font-family: ${FONT_STACKS['system-mono']}; }
@media (max-width: 640px) { .mk-input { font-size: max(16px, var(--mk-fs, 16px)); } }
`;

export function themeVariables(theme: CanvasDocument['theme']): Record<string, string> {
  return {
    '--mk-font': FONT_STACKS[theme.font],
    '--mk-radius': `${theme.radius}px`,
    '--mk-primary': theme.colors.primary,
    '--mk-on-primary': theme.colors.on_primary,
    '--mk-text': theme.colors.text,
    '--mk-muted': theme.colors.muted,
    '--mk-bg': theme.colors.background,
    '--mk-surface': theme.colors.surface,
    '--mk-border': theme.colors.border,
    '--mk-error': theme.colors.error,
  };
}

/** Applies an element's style through the CSSOM, never as CSS text. */
export function applyStyle(target: HTMLElement, style: CanvasStyle): void {
  const css = target.style;
  if (isColor(style.color)) css.color = style.color;
  if (isColor(style.background)) css.backgroundColor = style.background;
  if (isColor(style.border_color) || style.border_width !== undefined) {
    css.borderStyle = 'solid';
    css.borderWidth = `${style.border_width ?? 1}px`;
    if (isColor(style.border_color)) css.borderColor = style.border_color;
  }
  if (style.radius !== undefined) css.borderRadius = `${style.radius}px`;
  if (style.font_size !== undefined) css.setProperty('--mk-fs', `${style.font_size}px`);
  if (style.font_weight !== undefined) css.fontWeight = String(style.font_weight);
  if (style.text_align) {
    css.textAlign = style.text_align;
    css.justifyContent = style.text_align === 'left' ? 'flex-start' : style.text_align === 'right' ? 'flex-end' : 'center';
  }
  if (style.padding !== undefined) css.padding = `${style.padding}px`;
  if (style.opacity !== undefined) css.opacity = String(style.opacity);
  if (style.shadow) css.boxShadow = SHADOWS[style.shadow];
}

export function adoptStyles(root: ShadowRoot | Document, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    (root instanceof Document ? root.head : root).appendChild(style);
  }
}
