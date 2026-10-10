import en from '@murkio/spec/errors/en.json';
import ptBR from '@murkio/spec/errors/pt-BR.json';

export interface ErrorDetail {
  code: string;
  message: string;
  path?: string;
}

const catalogs: Record<string, Record<string, string>> = { en, 'pt-BR': ptBR, pt: ptBR };

/**
 * MurkioError is every failure the SDK reports. `code` is the stable API code
 * (`rsb-00`, `bss-10`...), `network` when the request never got an answer and
 * `unknown` for anything without a code. Show `translate(code)` to users and
 * use `code` in your own logic: the API `message` is English only.
 */
export class MurkioError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ErrorDetail[];

  constructor(code: string, status: number, details: ErrorDetail[] = [], message?: string) {
    super(message ?? details[0]?.message ?? code);
    this.name = 'MurkioError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  is(code: string): boolean {
    return this.code === code;
  }
}

export function catalog(locale: string): Record<string, string> {
  return catalogs[locale] ?? catalogs[locale.split('-')[0] ?? ''] ?? en;
}

/** Translates an error code (or `oauth.<error>` from a social sign-in return) for the user. */
export function translate(code: string, locale = 'en'): string {
  const messages = catalog(locale);
  return messages[code] ?? messages.unknown ?? en.unknown;
}

export function errorFromResponse(status: number, body: unknown): MurkioError {
  const details = Array.isArray((body as { details?: unknown })?.details)
    ? ((body as { details: ErrorDetail[] }).details.filter((d) => typeof d?.code === 'string'))
    : [];
  return new MurkioError(details[0]?.code ?? 'unknown', status, details);
}

export function asMurkioError(error: unknown): MurkioError {
  if (error instanceof MurkioError) return error;
  return new MurkioError('unknown', 0, [], error instanceof Error ? error.message : String(error));
}
