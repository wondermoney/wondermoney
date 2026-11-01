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
  ASSISTANT_NOT_ENABLED: "assistant_not_enabled",
  BAD_REQUEST: "bad_request",
  BANK_CREDENTIAL_INVALID: "bank_credential_invalid",
  CONFLICT: "conflict",
  DEMO_READ_ONLY: "demo_read_only",
  FORBIDDEN: "forbidden",
  HOUSEHOLD_FULL: "household_full",
  HOUSEHOLD_OWNER_REQUIRED: "household_owner_required",
  INTERNAL_ERROR: "internal_error",
  INVITE_ALREADY_USED: "invite_already_used",
  INVITE_EMAIL_MISMATCH: "invite_email_mismatch",
  INVITE_EXPIRED: "invite_expired",
  INVITE_INVALID: "invite_invalid",
  NOT_FOUND: "not_found",
  /**
   * Grandfathered SCREAMING_CASE, deliberately unlike its neighbours.
   * `lib/api/rate-limit.ts` branches on this literal and the API keeps emitting
   * it for that reason; normalising it needs a coordinated release.
   */
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHORIZED: "unauthorized",
  VALIDATION_FAILED: "validation_failed",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

interface ApiErrorResponse {
  response?: {
    status?: unknown;
    data?: {
      code?: unknown;
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
