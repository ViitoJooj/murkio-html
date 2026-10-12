/**
 * Storage and cookies can throw (private windows, blocked site data, sandboxed
 * iframes). Every access goes through these helpers so a blocked storage only
 * means "no session to restore", never a broken login page.
 */
type Area = 'localStorage' | 'sessionStorage';

function area(name: Area): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[name];
  } catch {
    return null;
  }
}

export const store = {
  get(name: Area, key: string): string | null {
    try {
      return area(name)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(name: Area, key: string, value: string): void {
    try {
      area(name)?.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
  remove(name: Area, key: string): void {
    try {
      area(name)?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

export function readJSON<T>(name: Area, key: string): T | null {
  const raw = store.get(name, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface CookieAttributes {
  maxAge?: number;
  domain?: string;
  secure: boolean;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    for (const part of document.cookie.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return rest.join('=') === '' ? null : decodeURIComponent(rest.join('='));
    }
  } catch {
    /* cookies unavailable */
  }
  return null;
}

export function writeCookie(name: string, value: string, attributes: CookieAttributes): void {
  if (typeof document === 'undefined') return;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (attributes.maxAge !== undefined) cookie += `; Max-Age=${Math.max(0, Math.floor(attributes.maxAge))}`;
  if (attributes.domain) cookie += `; Domain=${attributes.domain}`;
  if (attributes.secure) cookie += '; Secure';
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is asynchronous and not in every browser, and the server must see this cookie on the very next navigation
    document.cookie = cookie;
  } catch {
    /* cookies unavailable */
  }
}

export function deleteCookie(name: string, attributes: Omit<CookieAttributes, 'maxAge'>): void {
  writeCookie(name, '', { ...attributes, maxAge: 0 });
}
