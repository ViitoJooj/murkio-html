export interface LocalizedText {
  default: string;
  i18n?: Record<string, string>;
}

export type ElementType =
  | 'email_input'
  | 'password_input'
  | 'keep_logged'
  | 'login_button'
  | 'register_button'
  | 'forgot_password_link'
  | 'oauth_button'
  | 'error_message'
  | 'text'
  | 'link'
  | 'image'
  | 'shape'
  | 'divider';

export interface CanvasStyle {
  color?: string;
  background?: string;
  border_color?: string;
  border_width?: number;
  radius?: number;
  font_size?: number;
  font_weight?: number;
  text_align?: 'left' | 'center' | 'right';
  padding?: number;
  opacity?: number;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
}

export interface CanvasElement {
  id: string;
  type: ElementType;
  props: Record<string, unknown>;
  style: CanvasStyle;
}

export interface CanvasItem {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  hidden?: boolean;
}

export interface CanvasLayout {
  width: number;
  height: number;
  background?: { color?: string };
  items: Record<string, CanvasItem>;
}

export interface CanvasScreen {
  elements: CanvasElement[];
  layouts: { desktop: CanvasLayout; mobile?: CanvasLayout };
}

export interface CanvasTheme {
  font: 'system-sans' | 'system-serif' | 'system-mono' | 'inherit';
  radius: number;
  colors: {
    primary: string;
    on_primary: string;
    text: string;
    muted: string;
    background: string;
    surface: string;
    border: string;
    error: string;
  };
}

export interface CanvasDocument {
  schema: 1;
  theme: CanvasTheme;
  screens: { sign_in: CanvasScreen; sign_up?: CanvasScreen };
}

export interface PublicConfig {
  methods: { password: boolean };
  mfa: { mode: 'off' | 'optional' | 'required' };
  oauth_providers: string[];
  signup: { login_on_verify: boolean };
}

export interface ClientBootstrap {
  application_id: string;
  issuer: string;
  jwks_url: string;
  config: PublicConfig;
  canvas: { version: number; document: CanvasDocument };
}

export interface TokenPair {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  session_id: string;
}

export interface MFAChallenge {
  token: string;
  enrollment_required: boolean;
  expires_in: number;
}

export type LoginResult = { kind: 'session'; tokens: TokenPair } | { kind: 'mfa'; mfa: MFAChallenge };

export interface Me {
  id: string;
  session_id: string;
  email: string | null;
  email_verified: boolean;
  roles: string[];
  mfa_enabled: boolean;
  created_at: string;
}

export interface AccessClaims {
  iss: string;
  sub: string;
  aud: string;
  aid: string;
  sid: string;
  roles: string[];
  iat: number;
  exp: number;
  jti: string;
}
