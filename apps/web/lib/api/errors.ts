/**
 * Machine-readable API error codes.
 *
 * ## Why this exists
 *
 * Every error the API returns carries `{ code, message }`. `message` is prose for
 * humans and logs; `code` is the stable contract. The distinction is not academic — a
 * 403 covers both "the demo account is read-only" and "only the household owner can do
 * that", and without a code the only way to tell them apart is to read the English
 * sentence.
 *
 * Match on `code`. Never on `message` — it is translated, reworded, and not a contract.
 */

/** Mirrors `ERROR_CODE` in the API's `utils/errors.ts`. */
export const API_ERROR_CODE = {
  /** The account's balances were recalculated less than a minute ago (429, with `Retry-After`). */
  ACCOUNT_RECALCULATION_TOO_SOON: "account_recalculation_too_soon",
  ACCOUNT_RECONNECT_EMAIL_UNVERIFIED: "account_reconnect_email_unverified",
  AI_ALLOWANCE_EXHAUSTED: "ai_allowance_exhausted",
  ASSISTANT_NOT_ENABLED: "assistant_not_enabled",
  BAD_REQUEST: "bad_request",
  BANK_CREDENTIAL_INVALID: "bank_credential_invalid",
  CONFLICT: "conflict",
  DEMO_READ_ONLY: "demo_read_only",
  EMAIL_VERIFICATION_REQUIRED: "email_verification_required",
  FORBIDDEN: "forbidden",
  HOUSEHOLD_FULL: "household_full",
  HOUSEHOLD_OWNER_REQUIRED: "household_owner_required",
  INTERNAL_ERROR: "internal_error",
  INVITE_ALREADY_USED: "invite_already_used",
  INVITE_EMAIL_MISMATCH: "invite_email_mismatch",
  INVITE_EXPIRED: "invite_expired",
  INVITE_INVALID: "invite_invalid",
  NOT_FOUND: "not_found",
  /** The portfolio is linked to an account only the other member can see; `details.linkedBy` names them (403). */
  PORTFOLIO_LINK_HELD_BY_MEMBER: "portfolio_link_held_by_member",
  /**
   * Grandfathered SCREAMING_CASE, deliberately unlike its neighbours.
   * `lib/api/rate-limit.ts` branches on this literal and the API keeps emitting
   * it for that reason; normalising it needs a coordinated release.
   */
  RATE_LIMITED: "RATE_LIMITED",
  RULE_ORDER_STALE: "rule_order_stale",
  /** The household already has rules being applied to its transactions (409). */
  RULE_APPLY_IN_PROGRESS: "rule_apply_in_progress",
  /** The split's lines do not add up, mix signs, include a zero or are fewer than two (400). */
  SPLIT_INVALID: "split_invalid",
  TAG_NAME_TAKEN: "tag_name_taken",
  /** A loan repayment already splits principal from interest, so it cannot be split (409). */
  TRANSACTION_HAS_LOAN_REPAYMENT: "transaction_has_loan_repayment",
  /** A split transaction cannot be linked as a loan repayment until its split is removed (409). */
  TRANSACTION_IS_SPLIT: "transaction_is_split",
  UNAUTHORIZED: "unauthorized",
  VALIDATION_FAILED: "validation_failed",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

interface ApiErrorResponse {
  response?: {
    status?: unknown;
    data?: {
      code?: unknown;
      details?: unknown;
      message?: unknown;
    };
  };
}

export function getApiErrorMessage(error: unknown): string | undefined {
  const message = (error as ApiErrorResponse | undefined)?.response?.data
    ?.message;

  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

/**
 * The error's `code`, or `undefined` when there isn't one.
 *
 * Returns the raw string rather than narrowing to {@link ApiErrorCode}: the API may
 * add a code before this file knows about it, and silently dropping it would be worse
 * than handing back a value the caller does not recognise.
 */
export function getApiErrorCode(error: unknown): string | undefined {
  const code = (error as ApiErrorResponse | undefined)?.response?.data?.code;

  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function hasCode(error: unknown, code: ApiErrorCode): boolean {
  return getApiErrorCode(error) === code;
}

export function isDemoReadOnlyError(error: unknown): boolean {
  const response = (error as ApiErrorResponse | undefined)?.response;

  return (
    response?.status === 403 && hasCode(error, API_ERROR_CODE.DEMO_READ_ONLY)
  );
}

/**
 * The code on an axios error, or on the plain `Error` the AI SDK's chat
 * transport throws, whose message is the response body.
 */
function aiRouteErrorCode(error: unknown): string | undefined {
  const code = getApiErrorCode(error);
  if (code || !(error instanceof Error)) return code;
  try {
    const body = JSON.parse(error.message) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An AI feature on a server that keeps AI to verified accounts, from an account
 * that has not followed its verification link yet. Offer to resend it.
 */
export function isEmailVerificationRequiredError(error: unknown): boolean {
  return aiRouteErrorCode(error) === API_ERROR_CODE.EMAIL_VERIFICATION_REQUIRED;
}

/**
 * The household used up today's allowance for an AI feature. It resets at
 * midnight UTC, so say when instead of offering a retry.
 */
export function isAiAllowanceExhaustedError(error: unknown): boolean {
  return aiRouteErrorCode(error) === API_ERROR_CODE.AI_ALLOWANCE_EXHAUSTED;
}

/**
 * The display name of the member who holds a portfolio's link to their private
 * account, when the error is that refusal; only that member can change the link.
 */
export function getPortfolioLinkHolderName(error: unknown): string | undefined {
  if (!hasCode(error, API_ERROR_CODE.PORTFOLIO_LINK_HELD_BY_MEMBER)) {
    return undefined;
  }
  const details = (error as ApiErrorResponse).response?.data?.details as
    | { linkedBy?: unknown }
    | undefined;
  const name = details?.linkedBy;
  return typeof name === "string" && name.trim().length > 0 ? name : undefined;
}

/**
 * Changing a portfolio's link was refused because the other member holds it:
 * the named refusal, or the plain 403 an older API sends for the same case.
 */
export function isPortfolioLinkRefusal(error: unknown): boolean {
  const code = getApiErrorCode(error);
  return (
    code === API_ERROR_CODE.PORTFOLIO_LINK_HELD_BY_MEMBER ||
    code === API_ERROR_CODE.FORBIDDEN
  );
}

/** A household route a member reached but only the owner may use. */
export function isHouseholdOwnerRequiredError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
}

/**
 * The bank connection's stored credentials no longer work — the user has to
 * reconnect. Distinct from a transient sync failure, which is worth retrying.
 */
export function isBankCredentialInvalidError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.BANK_CREDENTIAL_INVALID);
}
