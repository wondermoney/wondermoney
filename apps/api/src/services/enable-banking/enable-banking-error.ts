import { redactFreeText } from '@utils/error-sanitizer';

/**
 * What Enable Banking said about a failed call, from its `ErrorResponse` body
 * (https://enablebanking.com/docs/api/reference/#errorresponse): `error` is the text `ErrorCode`
 * (`WRONG_TRANSACTIONS_PERIOD`, `EXPIRED_SESSION`, ...) and `message` its prose. The message is
 * passed through `redactFreeText` and capped, so it can be logged. `detail` is never kept, as it can
 * echo the request, and neither is the message of an `ASPSP_ERROR`, which can carry the bank's own
 * text rather than Enable Banking's (see {@link loggableEnableBankingBody}).
 */
export interface EnableBankingErrorInfo {
  code?: string;
  message?: string;
  status?: number;
}

/** `ErrorCode` values are SCREAMING_SNAKE_CASE; anything else is not a code to branch on. */
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ERROR_MESSAGE_MAX_CHARS = 300;
/** The bank's own failure, relayed: its message is the bank's text, not Enable Banking's. */
const BANK_RELAYED_CODES = new Set(['ASPSP_ERROR']);

/** The Enable Banking error a failed call carried, when the client attached one. */
export function enableBankingErrorOf(error: unknown): EnableBankingErrorInfo | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const info = (error as { enableBankingError?: unknown }).enableBankingError;
  return info && typeof info === 'object' ? info : undefined;
}

export function readEnableBankingError(status: number | undefined, data: unknown): EnableBankingErrorInfo {
  const body = data && typeof data === 'object' ? data as { error?: unknown; message?: unknown } : {};
  const code = typeof body.error === 'string' && ERROR_CODE_PATTERN.test(body.error) ? body.error : undefined;
  const message = typeof body.message === 'string' && !(code && BANK_RELAYED_CODES.has(code)) ? redactFreeText(body.message).slice(0, ERROR_MESSAGE_MAX_CHARS) : undefined;
  return { ...(code ? { code } : {}), ...(message ? { message } : {}), ...(status === undefined ? {} : { status }) };
}

/**
 * A failed call's response body as it may be logged: without `detail`, and without the message of
 * a code that relays the bank's own text. What is left still goes through
 * `sanitizeProviderResponse`. A body that is not an object (an HTML gateway page) is kept as it is.
 */
export function loggableEnableBankingBody(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { detail: _detail, ...rest } = data as Record<string, unknown>;
  const code = rest['error'];
  if (typeof code === 'string' && BANK_RELAYED_CODES.has(code)) delete rest['message'];
  return rest;
}
