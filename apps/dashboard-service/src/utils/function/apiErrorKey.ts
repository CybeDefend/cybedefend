import i18n from 'i18next';
import { ROLE_REFUSAL_KEY } from '@/utils/organizationRoleRefusal';

/**
 * The translation key of a failed API call, never the server's text.
 *
 * The gateway answers `{ statusCode, error, message, code? }`. `message` is
 * written for developers (English, class-validator details, internal wording)
 * and axios's own `message` is « Request failed with status code N », so
 * neither is shown to a user. The sentence is chosen, in order, by:
 *  1. `body.code`, when the caller or this module knows it;
 *  2. the HTTP status;
 *  3. a request that got no answer (network failure, server down);
 *  4. the caller's own sentence, else a generic one.
 */
export const API_ERROR_KEYS = {
  badRequest: 'errors.api.badRequest',
  notAllowed: 'errors.api.notAllowed',
  notFound: 'errors.api.notFound',
  conflict: 'errors.api.conflict',
  tooManyRequests: 'errors.api.tooManyRequests',
  unavailable: 'errors.api.unavailable',
  generic: 'errors.api.generic',
} as const;

/** Refusal codes any screen may receive, with their fixed sentence. */
const KNOWN_CODES: Readonly<Record<string, string>> = Object.freeze({
  ROLE_NOT_AVAILABLE: ROLE_REFUSAL_KEY,
});

/**
 * An error the dashboard raises itself with a fixed sentence (a check made
 * before any request): `apiErrorKey` answers its key.
 */
export class LocalizedError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'LocalizedError';
  }
}

export interface ApiErrorKeyOptions {
  /** Codes of the screen's own refusals, read before the built-in ones. */
  codes?: Readonly<Record<string, string>>;
  /** The screen's sentence for an error that is neither a code nor a known status. */
  fallback?: string;
}

const own = (map: Readonly<Record<string, string>> | undefined, key: unknown): string | undefined =>
  map && typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

const byStatus = (status: number): string | undefined => {
  if (status === 400 || status === 422) return API_ERROR_KEYS.badRequest;
  if (status === 401 || status === 403) return API_ERROR_KEYS.notAllowed;
  if (status === 404) return API_ERROR_KEYS.notFound;
  if (status === 409) return API_ERROR_KEYS.conflict;
  if (status === 429) return API_ERROR_KEYS.tooManyRequests;
  if (status >= 500 && status <= 599) return API_ERROR_KEYS.unavailable;
  return undefined;
};

export function apiErrorKey(error: unknown, options: ApiErrorKeyOptions = {}): string {
  const fallback = options.fallback ?? API_ERROR_KEYS.generic;
  if (!error || typeof error !== 'object') return fallback;
  if (error instanceof LocalizedError) return error.key;

  const response = (error as { response?: unknown }).response;
  if (response && typeof response === 'object') {
    const { status, data } = response as { status?: unknown; data?: unknown };
    const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
    const known = own(options.codes, code) ?? own(KNOWN_CODES, code);
    if (known) return known;
    const fromStatus = typeof status === 'number' ? byStatus(status) : undefined;
    return fromStatus ?? fallback;
  }

  // An axios error without a response: the request left but nothing answered.
  const { request, isAxiosError } = error as { request?: unknown; isAxiosError?: unknown };
  if (request !== undefined || isAxiosError === true) return API_ERROR_KEYS.unavailable;
  return fallback;
}

/**
 * The translated sentence of `apiErrorKey`, for code outside a component
 * (hooks, thunks). Always a non-empty string, so a caller that treats the
 * error as truthy keeps working before the translations are loaded.
 */
export const apiErrorText = (error: unknown, options?: ApiErrorKeyOptions): string =>
  translateKey(apiErrorKey(error, options));

/** `i18n.t(key)`, or the key itself while the translations are not loaded. */
export const translateKey = (key: string): string => {
  const text: unknown = i18n.t(key);
  return typeof text === 'string' && text !== '' ? text : key;
};
