import type { LocalizedText } from './types';

const strings = {
  en: {
    'verify.title': 'Confirm your email',
    'verify.description': 'We sent a 6-digit code to {email}.',
    'verify.code': 'Code',
    'verify.password': 'Password',
    'verify.submit': 'Confirm',
    'verify.resend': 'Send a new code',
    'verify.resent': 'If the address can be used, a new code is on its way.',
    'verified.signin': 'Email confirmed. Sign in to continue.',
    'mfa.title': 'Two-step verification',
    'mfa.description': 'Enter the code from your authenticator app, or a recovery code.',
    'mfa.code': 'Code',
    'mfa.submit': 'Verify',
    'enroll.title': 'Set up two-step verification',
    'enroll.description': 'Add this key to your authenticator app, then enter the code it shows.',
    'enroll.secret': 'Setup key',
    'enroll.open': 'Open in authenticator app',
    'enroll.code': 'Code',
    'enroll.submit': 'Activate',
    'recovery.title': 'Save your recovery codes',
    'recovery.description': 'Each code works once if you lose your authenticator. Keep them somewhere safe.',
    'recovery.done': 'I saved them',
    'forgot.title': 'Reset your password',
    'forgot.description': 'Enter your email and we will send you a code.',
    'forgot.email': 'Email',
    'forgot.submit': 'Send code',
    'reset.title': 'Choose a new password',
    'reset.description': 'Enter the code we sent to {email} and your new password.',
    'reset.code': 'Code',
    'reset.password': 'New password',
    'reset.submit': 'Save password',
    'reset.done': 'Password changed. Sign in with the new one.',
    back: 'Back',
    'password.show': 'Show password',
    'password.hide': 'Hide password',
    'oauth.continue': 'Continue with {provider}',
  },
  'pt-BR': {
    'verify.title': 'Confirme seu e-mail',
    'verify.description': 'Enviamos um código de 6 dígitos para {email}.',
    'verify.code': 'Código',
    'verify.password': 'Senha',
    'verify.submit': 'Confirmar',
    'verify.resend': 'Enviar outro código',
    'verify.resent': 'Se o endereço puder ser usado, um código novo está a caminho.',
    'verified.signin': 'E-mail confirmado. Entre para continuar.',
    'mfa.title': 'Verificação em duas etapas',
    'mfa.description': 'Digite o código do seu app autenticador ou um código de recuperação.',
    'mfa.code': 'Código',
    'mfa.submit': 'Verificar',
    'enroll.title': 'Ative a verificação em duas etapas',
    'enroll.description': 'Adicione esta chave ao seu app autenticador e digite o código que ele mostrar.',
    'enroll.secret': 'Chave de configuração',
    'enroll.open': 'Abrir no app autenticador',
    'enroll.code': 'Código',
    'enroll.submit': 'Ativar',
    'recovery.title': 'Guarde seus códigos de recuperação',
    'recovery.description': 'Cada código vale uma vez se você perder o autenticador. Guarde-os num lugar seguro.',
    'recovery.done': 'Já guardei',
    'forgot.title': 'Redefinir a senha',
    'forgot.description': 'Informe seu e-mail e enviaremos um código.',
    'forgot.email': 'E-mail',
    'forgot.submit': 'Enviar código',
    'reset.title': 'Escolha uma senha nova',
    'reset.description': 'Digite o código que enviamos para {email} e a senha nova.',
    'reset.code': 'Código',
    'reset.password': 'Senha nova',
    'reset.submit': 'Salvar senha',
    'reset.done': 'Senha alterada. Entre com a nova.',
    back: 'Voltar',
    'password.show': 'Mostrar senha',
    'password.hide': 'Esconder senha',
    'oauth.continue': 'Continuar com {provider}',
  },
} as const;

export type StringKey = keyof (typeof strings)['en'];

const providerNames: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  facebook: 'Facebook',
  x: 'X',
};

export function providerName(provider: string): string {
  return providerNames[provider] ?? provider;
}

/** The locale the SDK speaks: the option, then the page `lang`, then the browser. */
export function detectLocale(preferred?: string): string {
  if (preferred) return preferred;
  if (typeof document !== 'undefined' && document.documentElement.lang) return document.documentElement.lang;
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

function language(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

export function t(locale: string, key: StringKey, params: Record<string, string> = {}): string {
  const table: Record<string, string> = locale in strings ? strings[locale as keyof typeof strings] : language(locale) === 'pt' ? strings['pt-BR'] : strings.en;
  const template = table[key] ?? strings.en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/** Picks the translation of a canvas text for the locale, falling back to its default. */
export function pick(text: LocalizedText | undefined, locale: string): string {
  if (!text) return '';
  return text.i18n?.[locale] ?? text.i18n?.[language(locale)] ?? text.default;
}
