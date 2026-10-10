/**
 * The element classes are declared when the module loads. On a server render
 * (Next, Remix, any SSR) there is no HTMLElement, and `class X extends
 * HTMLElement` would throw on import; this stand-in lets the module load there,
 * and defineElements() never registers anything without a browser.
 */
export const BaseElement: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;
