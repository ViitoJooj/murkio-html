import { MurkioIdentityCanvas } from './canvas-element';
import {
  MurkioIdentityEmailInput,
  MurkioIdentityError,
  MurkioIdentityKeepLogged,
  MurkioIdentityLoginButton,
  MurkioIdentityPasswordInput,
  MurkioIdentityRegisterButton,
} from './field-elements';

export const ELEMENTS = {
  'murkio-identity-canvas': MurkioIdentityCanvas,
  'murkio-identity-email-input': MurkioIdentityEmailInput,
  'murkio-identity-password-input': MurkioIdentityPasswordInput,
  'murkio-identity-keep-logged': MurkioIdentityKeepLogged,
  'murkio-identity-login-button': MurkioIdentityLoginButton,
  'murkio-identity-register-button': MurkioIdentityRegisterButton,
  'murkio-identity-error': MurkioIdentityError,
} as const;

/** Registers the custom elements (once; safe to call again or from several bundles). */
export function defineElements(): void {
  if (typeof customElements === 'undefined') return;
  for (const [name, element] of Object.entries(ELEMENTS)) {
    if (!customElements.get(name)) customElements.define(name, element);
  }
}
