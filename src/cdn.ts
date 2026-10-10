import { defineElements } from './elements/define';
import { init } from './murkio';

export * from './index';

/**
 * The script-tag build. With `data-murkio-key` on its <script>, it creates the
 * page client on load, so a plain HTML site only needs:
 *
 *   <script src=".../murkio.js" data-murkio-key="pk_..." defer></script>
 *   <murkio-identity-canvas></murkio-identity-canvas>
 *
 * Optional: data-murkio-api, data-murkio-locale, data-murkio-after-login and
 * data-murkio-oauth-redirect.
 */
const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
const key = script?.dataset.murkioKey;
if (key) {
  init({
    publishableKey: key,
    apiUrl: script?.dataset.murkioApi,
    locale: script?.dataset.murkioLocale,
    afterLogin: script?.dataset.murkioAfterLogin,
    oauthRedirectUrl: script?.dataset.murkioOauthRedirect,
  });
}
defineElements();
