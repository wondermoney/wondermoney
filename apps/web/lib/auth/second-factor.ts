/**
 * The second step of a sign-in with two-factor authentication: an authenticator
 * code (`twoFactor.verifyTotp`) or one of the backup codes shown when two-factor
 * was turned on (`twoFactor.verifyBackupCode`).
 */
export type SecondFactorMethod = "totp" | "backup-code";

/** Translation keys (in `common.json`) for a failed second-factor verification. */
export type SecondFactorErrorMessageKey =
  | "invalid-code"
  | "mfa-backup-code-invalid"
  | "mfa-error-challenge-expired"
  | "mfa-error-too-many-attempts"
  | "mfa-error-rate-limited"
  | "toast-mfa-error";

function readField(error: unknown, field: string): unknown {
  return error && typeof error === "object" && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

/**
 * better-auth's two-factor error codes (`TWO_FACTOR_ERROR_CODES`). A used backup
 * code is removed from the account's list, so it answers the same
 * `INVALID_BACKUP_CODE` as a mistyped one. Five wrong codes in one sign-in end
 * the challenge (`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`, and the pending cookie is
 * gone, so the only way on is to sign in again); repeated failures across
 * sign-ins lock the account for a while (`ACCOUNT_TEMPORARILY_LOCKED`).
 */
const CODE_KEYS: Readonly<Record<string, SecondFactorErrorMessageKey>> = {
  INVALID_CODE: "invalid-code",
  INVALID_BACKUP_CODE: "mfa-backup-code-invalid",
  INVALID_TWO_FACTOR_COOKIE: "mfa-error-challenge-expired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "mfa-error-too-many-attempts",
  ACCOUNT_TEMPORARILY_LOCKED: "mfa-error-rate-limited",
};

/**
 * The message for the `error` from `authClient.twoFactor.verifyTotp` or
 * `verifyBackupCode` (`{ code?, status, message? }`). The server's `message` is
 * English prose, so the copy is chosen from the code and status alone. A 429
 * without a two-factor code is the API's own limiter on `/api/auth/two-factor`.
 */
export function getSecondFactorErrorKey(error: unknown): SecondFactorErrorMessageKey {
  const code = readField(error, "code");
  const known = typeof code === "string" ? CODE_KEYS[code] : undefined;
  if (known) return known;
  if (readField(error, "status") === 429) return "mfa-error-rate-limited";
  return "toast-mfa-error";
}

const UNSEPARATED_BACKUP_CODE = /^[A-Za-z0-9]{10}$/;

/**
 * better-auth issues backup codes as `abcde-12345` and compares them exactly
 * (case included). Spaces a password manager or a paste adds are dropped, and a
 * code typed without its hyphen gets it back; anything else is sent as typed.
 */
export function normalizeBackupCode(raw: string): string {
  const compact = raw.replace(/\s+/g, "");
  return UNSEPARATED_BACKUP_CODE.test(compact)
    ? `${compact.slice(0, 5)}-${compact.slice(5)}`
    : compact;
}
