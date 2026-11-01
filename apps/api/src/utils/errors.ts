import { getReasonPhrase, StatusCodes } from 'http-status-codes';

import logger from './logger';

/**
 * Stable, machine-readable reasons a request failed.
 *
 * ## Why this exists
 *
 * With only `{ message: string }`, a client can see *that* a request failed but not *why* —
 * only an English sentence written for a human. An unlabelled 403 is easy to misread as a
 * session/token problem: the SSR layer redirects it to login, middleware bounces the
 * still-logged-in user back to the dashboard, which re-fetches and 403s again —
 * `ERR_TOO_MANY_REDIRECTS` — and the user is locked out of the app entirely. A stable code
 * is what lets a client tell those cases apart.
 *
 * ## Contract
 *
 * `code` is part of the public API. It is stable, `snake_case`, and safe to branch on. The
 * `message` is not: it is English prose for humans and logs, and clients must not match on
 * it (web currently renders it in preference to its own translated strings, which defeats
 * the en/pt/es UI — the code is what makes a translated message possible).
 *
 * Add a specific code when a client could reasonably do something different in response.
 * Otherwise the status-derived default is fine.
 */
export const ERROR_CODE = {
  // --- Generic, derived from status when nothing more specific applies ---
  BAD_GATEWAY: 'bad_gateway',
  BAD_REQUEST: 'bad_request',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
  GATEWAY_TIMEOUT: 'gateway_timeout',
  INTERNAL: 'internal_error',
  NOT_FOUND: 'not_found',
  NOT_IMPLEMENTED: 'not_implemented',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  /**
   * Grandfathered SCREAMING_CASE, deliberately. `web/lib/api/rate-limit.ts:18` branches on
   * this exact literal, so normalising it to `rate_limited` for consistency would break a
   * live consumer for the sake of tidiness. Changing it needs a coordinated client release;
   * it is not worth one on its own.
   */
  TOO_MANY_REQUESTS: 'RATE_LIMITED',
  UNAUTHORIZED: 'unauthorized',
  VALIDATION_FAILED: 'validation_failed',

  // --- Specific: a client can and should behave differently for each of these ---
  /** Account-level action reserved to the owner (privacy toggle), not the partner. */
  ACCOUNT_OWNER_REQUIRED: 'account_owner_required',
  /** The assistant is not enabled for this user. */
  ASSISTANT_NOT_ENABLED: 'assistant_not_enabled',
  /**
   * The feature needs an integration this server does not have configured (AI, market data,
   * file storage, ...). Self-hosted installs turn these off by leaving the settings unset; hide
   * the feature rather than reporting an outage. `GET /v1/configs` lists what is available.
   */
  FEATURE_DISABLED: 'feature_disabled',
  /** The demo account attempted a mutation. Show the read-only affordance. */
  DEMO_READ_ONLY: 'demo_read_only',
  /** A per-user Enable Banking credential is missing, invalid or undecryptable. */
  BANK_CREDENTIAL_INVALID: 'bank_credential_invalid',
  /** Route is household-owner-only and the caller is a member. */
  HOUSEHOLD_OWNER_REQUIRED: 'household_owner_required',
  /** Joining a household: it already has its two members (409). */
  HOUSEHOLD_FULL: 'household_full',
  /** Household invite (signup): accepted already, by this person or someone else (400/409). */
  INVITE_ALREADY_USED: 'invite_already_used',
  /** Household invite (signup): the invite went to a different email address (400). */
  INVITE_EMAIL_MISMATCH: 'invite_email_mismatch',
  /** Household invite (signup): past its 7-day lifetime (400). */
  INVITE_EXPIRED: 'invite_expired',
  /** Household invite (signup): unknown token or revoked by the owner (400). */
  INVITE_INVALID: 'invite_invalid',
  /** The transaction is EXPIRED (the bank retracted it): no money moved, so it cannot be funded. */
  TRANSACTION_EXPIRED: 'transaction_expired',
} as const;

export type ErrorCode = typeof ERROR_CODE[keyof typeof ERROR_CODE];

class ApplicationError extends Error {
  code: ErrorCode;
  status: StatusCodes;
  constructor(message?: string, status?: StatusCodes, code?: ErrorCode) {
    const errorMessage = message || (status ? getReasonPhrase(status) : 'Unknown error');
    super(errorMessage);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.status = status || StatusCodes.INTERNAL_SERVER_ERROR;
    this.code = code ?? ERROR_CODE.INTERNAL;
  }
}

export class BadGatewayError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.BAD_GATEWAY) {
    super(message, StatusCodes.BAD_GATEWAY, code);
    logger.warn({ error: this }, `BadGatewayError: ${message}`);
  }
}

export class BadRequestError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.BAD_REQUEST) {
    super(message, StatusCodes.BAD_REQUEST, code);
    logger.warn({ error: this }, `BadRequestError: ${message}`);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.CONFLICT) {
    super(message, StatusCodes.CONFLICT, code);
    logger.warn({ error: this }, `ConflictError: ${message}`);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.FORBIDDEN) {
    super(message, StatusCodes.FORBIDDEN, code);
    logger.warn({ error: this }, `ForbiddenError: ${message}`);
  }
}

export class GatewayTimeoutError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.GATEWAY_TIMEOUT) {
    super(message, StatusCodes.GATEWAY_TIMEOUT, code);
    logger.warn({ error: this }, `GatewayTimeoutError: ${message}`);
  }
}

/**
 * The server is not configured for this feature (see `ERROR_CODE.FEATURE_DISABLED`). 501, and
 * deliberately not logged as an error or sent to Sentry: on a self-hosted install it is a
 * configuration choice, not a fault.
 */
export class FeatureDisabledError extends ApplicationError {
  constructor(feature: string) {
    super(`${feature} is not configured on this server`, StatusCodes.NOT_IMPLEMENTED, ERROR_CODE.FEATURE_DISABLED);
  }
}

export class InternalServerError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.INTERNAL) {
    super(message, StatusCodes.INTERNAL_SERVER_ERROR, code);
    logger.error({ error: this }, `InternalServerError: ${message}`);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.NOT_FOUND) {
    super(message, StatusCodes.NOT_FOUND, code);
    logger.warn({ error: this }, `NotFoundError: ${message}`);
  }
}

/**
 * A dependency this endpoint needs is not configured or not reachable. 503
 * rather than 500 because the request itself was fine — and, being 5xx, it
 * still reaches Sentry, which is where a missing environment variable belongs.
 */
export class ServiceUnavailableError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.SERVICE_UNAVAILABLE) {
    super(message, StatusCodes.SERVICE_UNAVAILABLE, code);
    logger.error({ error: this }, `ServiceUnavailableError: ${message}`);
  }
}

export class TooManyRequestsError extends ApplicationError {
  // Seconds the client should wait before retrying, surfaced as a Retry-After
  // header by the global error handler. Undefined when no hint is available.
  retryAfter?: number;
  constructor(message?: string, retryAfter?: number, code: ErrorCode = ERROR_CODE.TOO_MANY_REQUESTS) {
    super(message, StatusCodes.TOO_MANY_REQUESTS, code);
    this.retryAfter = retryAfter;
    logger.warn({ error: this, retryAfter }, `TooManyRequestsError: ${message}`);
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.UNAUTHORIZED) {
    super(message, StatusCodes.UNAUTHORIZED, code);
    logger.warn({ error: this }, `UnauthorizedError: ${message}`);
  }
}

/**
 * Raised by `account-auto-sync.worker.ts` when the appuser's own Enable Banking BYOK application
 * credential (`EnableBankingCredential`) is missing, inactive, or fails to decrypt when a
 * scheduled sync job goes to use it. This is a per-user secret only the user themselves can fix (re-paste Application ID/private key
 * in Settings) — retrying the same scheduled job on a backoff can never succeed on its own, so
 * `isPermanentBankSyncError` treats this as permanent rather than a transient provider outage.
 * Extends `UnauthorizedError` since a bad/expired credential is, semantically, an auth failure
 * against the provider — matching the existing `authentication` bank-sync error category/code in
 * `analytics/bank-sync-contract.ts` (no new category/code needed).
 */
export class EnableBankingCredentialInvalidError extends UnauthorizedError {}

/**
 * Fallback code for an error that reaches the handler without one — a raw `Error`, or a
 * third-party throw. Keeps every response shape uniform, so a client never has to handle
 * "sometimes there is a code".
 */
export function statusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400: return ERROR_CODE.BAD_REQUEST;
    case 401: return ERROR_CODE.UNAUTHORIZED;
    case 403: return ERROR_CODE.FORBIDDEN;
    case 404: return ERROR_CODE.NOT_FOUND;
    case 409: return ERROR_CODE.CONFLICT;
    case 422: return ERROR_CODE.VALIDATION_FAILED;
    case 429: return ERROR_CODE.TOO_MANY_REQUESTS;
    case 501: return ERROR_CODE.NOT_IMPLEMENTED;
    case 502: return ERROR_CODE.BAD_GATEWAY;
    case 503: return ERROR_CODE.SERVICE_UNAVAILABLE;
    case 504: return ERROR_CODE.GATEWAY_TIMEOUT;
    default: return ERROR_CODE.INTERNAL;
  }
}
