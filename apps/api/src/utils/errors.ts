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
  /** Changing whether a manual asset is private, by the member who does not own it (403). */
  MANUAL_ASSET_OWNER_REQUIRED: 'manual_asset_owner_required',
  /** Deleting the only valuation of a manual asset (409). An asset keeps one; delete the asset instead. */
  MANUAL_ASSET_LAST_VALUATION: 'manual_asset_last_valuation',
  /** The assistant is not enabled for this user. */
  ASSISTANT_NOT_ENABLED: 'assistant_not_enabled',
  /** Applying an assistant proposal past its seven days (409). It is now `expired`; nothing changed. */
  ASSISTANT_PROPOSAL_EXPIRED: 'assistant_proposal_expired',
  /**
   * Applying an assistant proposal whose transaction or category is gone or no longer visible to
   * the member (409). It is now `failed`; nothing changed. Refetch the list.
   */
  ASSISTANT_PROPOSAL_FAILED: 'assistant_proposal_failed',
  /** Applying a proposal that was dismissed or failed, or dismissing one already applied or failed (409). */
  ASSISTANT_PROPOSAL_NOT_PENDING: 'assistant_proposal_not_pending',
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
  /** A personal API token lacks the scope this route needs (403). */
  API_TOKEN_SCOPE_REQUIRED: 'api_token_scope_required',
  /** Creating a personal API token from a session older than the freshness window (403). Sign in again. */
  SESSION_NOT_FRESH: 'session_not_fresh',
  /** Creating a personal API token for a user with TOTP enabled, without a code (403). */
  TOTP_REQUIRED: 'totp_required',
  /** The submitted TOTP code was wrong or expired (403). */
  INVALID_TOTP: 'invalid_totp',
  /**
   * QR pairing: the code is unknown, already used, or past its two-minute lifetime (404).
   * Deliberately one code for all three — the phone's only useful response is "scan a new QR".
   */
  PAIRING_CODE_INVALID: 'pairing_code_invalid',
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
  /**
   * Auth callback: the email belongs to an account from before better-auth, and this login has not
   * verified it yet. A verification link was emailed; after following it, signing in reconnects (400).
   */
  ACCOUNT_RECONNECT_EMAIL_UNVERIFIED: 'account_reconnect_email_unverified',
  /**
   * An AI feature on a server that requires a verified email (`AI_REQUIRES_VERIFIED_EMAIL`), from
   * an account that has not verified yet (403). Offer to resend the verification email.
   */
  EMAIL_VERIFICATION_REQUIRED: 'email_verification_required',
  /**
   * The household used up today's allowance for this AI feature (`AI_DAILY_LIMIT_<FEATURE>`, 403).
   * It resets at midnight UTC; say so rather than offering a retry.
   */
  AI_ALLOWANCE_EXHAUSTED: 'ai_allowance_exhausted',
  /** The transaction is EXPIRED (the bank retracted it): no money moved, so it cannot be funded. */
  TRANSACTION_EXPIRED: 'transaction_expired',
  /**
   * Deleting a transaction the bank sent (409). The next sync would send it again, so it cannot be
   * deleted; hide it instead. A bulk delete skips such rows and reports them, and answers this only
   * when every selected row is one.
   */
  TRANSACTION_BANK_SYNCED: 'transaction_bank_synced',
  /** A bulk change or delete whose filter or id list selects more than 5,000 transactions (400). Narrow the filter. */
  BULK_SELECTION_TOO_LARGE: 'bulk_selection_too_large',
  /** Creating or renaming a tag: the household already has a tag with this name, ignoring case (409). */
  TAG_NAME_TAKEN: 'tag_name_taken',
  /** Adding an exchange-rate override: the household already has one for this pair and day (409). Change that one instead. */
  EXCHANGE_RATE_OVERRIDE_EXISTS: 'exchange_rate_override_exists',
  /** An exchange-rate override names a currency WonderMoney does not offer (400). */
  UNKNOWN_CURRENCY: 'unknown_currency',
  /**
   * Reordering rules: the list is not exactly the household's live rules (one was added or
   * deleted meanwhile, or a key is not the household's) (409). Reload the rules and try again.
   */
  RULE_ORDER_STALE: 'rule_order_stale',
  /**
   * Applying rules to existing transactions: the household already has a run queued or going
   * (409). Wait for it to finish, then apply again.
   */
  RULE_APPLY_IN_PROGRESS: 'rule_apply_in_progress',
  /**
   * Recalculating an account's balances: the last recalculation of this account was started less
   * than a minute ago (429, with `Retry-After`).
   */
  ACCOUNT_RECALCULATION_TOO_SOON: 'account_recalculation_too_soon',
  /** Editing the opening balance of a bank-synced account, whose balance comes from the bank (400). */
  OPENING_BALANCE_MANUAL_ONLY: 'opening_balance_manual_only',
  /**
   * Splitting a transaction: the lines do not add up to its amount, mix signs, include a zero line,
   * are fewer than two, or carry more decimals than amounts are stored with (400).
   */
  SPLIT_INVALID: 'split_invalid',
  /** Splitting a transaction linked as a loan repayment, which already splits principal from interest (409). */
  TRANSACTION_HAS_LOAN_REPAYMENT: 'transaction_has_loan_repayment',
  /** A loan schedule needs a principal, an interest rate and a term (422). */
  LOAN_SCHEDULE_UNAVAILABLE: 'loan_schedule_unavailable',
  /** A loan payoff projection needs a principal, an interest rate and a term (422). */
  LOAN_PROJECTION_UNAVAILABLE: 'loan_projection_unavailable',
  /** Linking a split transaction as a loan repayment; remove the split first (409). */
  TRANSACTION_IS_SPLIT: 'transaction_is_split',
  /**
   * Starting a data export while one of the other kind (with or without a password) is still in
   * progress (409). Wait for it to finish, or download it, then start again.
   */
  DATA_EXPORT_IN_PROGRESS: 'data_export_in_progress',
  /**
   * Restoring an export: the household already has accounts, portfolios, budgets, goals, loans or manual assets
   * (409). Restore only fills an empty household; it never merges.
   */
  HOUSEHOLD_NOT_EMPTY: 'household_not_empty',
  /** Starting a restore while another is being checked or restored (409). Wait for it to finish. */
  DATA_RESTORE_IN_PROGRESS: 'data_restore_in_progress',
  /** Validating a restore whose file has not been uploaded yet (409). Upload it, then validate. */
  DATA_RESTORE_NOT_UPLOADED: 'data_restore_not_uploaded',
  /** Committing a restore that has not passed validation, or one past its window (409). */
  DATA_RESTORE_NOT_READY: 'data_restore_not_ready',
  /** A restore file over the size limit (400). */
  DATA_RESTORE_TOO_LARGE: 'data_restore_too_large',
  /**
   * Changing a portfolio's link to an account only the other household member can see (403).
   * `details.linkedBy` is that member's display name, so the viewer knows who to ask.
   */
  PORTFOLIO_LINK_HELD_BY_MEMBER: 'portfolio_link_held_by_member',
} as const;

export type ErrorCode = typeof ERROR_CODE[keyof typeof ERROR_CODE];

class ApplicationError extends Error {
  code: ErrorCode;
  /** Values a client needs to word the error itself, sent beside `code`. Never anything the caller may not see. */
  details?: Record<string, string>;
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
 * The request is well formed but the resource cannot answer it (422): a loan
 * without the rate, term or principal a schedule needs, for example.
 */
export class UnprocessableEntityError extends ApplicationError {
  constructor(message?: string, code: ErrorCode = ERROR_CODE.VALIDATION_FAILED, details?: Record<string, string>) {
    super(message, StatusCodes.UNPROCESSABLE_ENTITY, code);
    if (details) this.details = details;
    logger.warn({ error: this }, `UnprocessableEntityError: ${message}`);
  }
}

/**
 * A portfolio is linked to an account private to the other household member, so only they can
 * change the link. Names that member (their display name, which the household already sees) and
 * nothing about the account. The name stays out of the message, which is logged.
 */
export class PortfolioLinkHeldByMemberError extends ForbiddenError {
  constructor(linkedBy: string) {
    super('This portfolio is linked to an account only the other household member can see.', ERROR_CODE.PORTFOLIO_LINK_HELD_BY_MEMBER);
    this.details = { linkedBy };
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
