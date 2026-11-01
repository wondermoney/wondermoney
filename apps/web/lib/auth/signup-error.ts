import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";

/**
 * Translation keys (in `common.json`) for a failed email signup.
 *
 * Signup fails in two places: better-auth's `signUp.email` (the account), then
 * the API's `POST /v1/auth/callback` (provisioning the app user and, for a
 * household invite, joining the owner's tenant). Both return a machine code;
 * neither returns copy we can show — the API's `message` is English prose and,
 * for a 500, can be a raw exception message. So the toast is chosen from the
 * code and status alone, and anything unrecognised gets the generic message.
 */
export type SignupErrorMessageKey =
  | "toast-signup-error"
  | "toast-signup-error-email-taken"
  | "toast-signup-error-invalid-email"
  | "toast-signup-error-household-full"
  | "toast-signup-error-invite"
  | "toast-signup-error-invite-email-mismatch"
  | "toast-signup-error-invite-expired"
  | "toast-signup-error-invite-invalid"
  | "toast-signup-error-invite-used"
  | "toast-signup-error-password-length"
  | "toast-signup-error-rate-limited";

const GENERIC: SignupErrorMessageKey = "toast-signup-error";

function readField(error: unknown, field: string): unknown {
  return error && typeof error === "object" && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

/** better-auth error codes (`BASE_ERROR_CODES`) a signup can return. */
const PROVIDER_CODE_KEYS: Readonly<Record<string, SignupErrorMessageKey>> = {
  INVALID_EMAIL: "toast-signup-error-invalid-email",
  PASSWORD_TOO_LONG: "toast-signup-error-password-length",
  PASSWORD_TOO_SHORT: "toast-signup-error-password-length",
  USER_ALREADY_EXISTS: "toast-signup-error-email-taken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "toast-signup-error-email-taken",
};

/** The `error` from `authClient.signUp.email` (`{ code?, status, message? }`). */
export function getSignupProviderErrorKey(
  error: unknown,
): SignupErrorMessageKey {
  if (readField(error, "status") === 429) {
    return "toast-signup-error-rate-limited";
  }
  const code = readField(error, "code");
  return (typeof code === "string" && PROVIDER_CODE_KEYS[code]) || GENERIC;
}

/** The callback's specific invite refusals (API `validateInviteForSignup` / `consumeInvite`). */
const INVITE_CODE_KEYS: Readonly<Record<string, SignupErrorMessageKey>> = {
  [API_ERROR_CODE.HOUSEHOLD_FULL]: "toast-signup-error-household-full",
  [API_ERROR_CODE.INVITE_ALREADY_USED]: "toast-signup-error-invite-used",
  [API_ERROR_CODE.INVITE_EMAIL_MISMATCH]:
    "toast-signup-error-invite-email-mismatch",
  [API_ERROR_CODE.INVITE_EXPIRED]: "toast-signup-error-invite-expired",
  [API_ERROR_CODE.INVITE_INVALID]: "toast-signup-error-invite-invalid",
};

/**
 * The axios error from `POST /v1/auth/callback`.
 *
 * An invite refusal carries its own code (expired, already used, sent to another email,
 * revoked or unknown, household full), and each gets its own message. A server from before
 * those codes answers a refused invite with the generic `bad_request`/`conflict`, so for those
 * the request still decides: with an invite token, the invite is the only thing the user could
 * have got wrong. Without one, a 400 is the API refusing an email that already has an account
 * (signed up with another method, or a duplicate). A 5xx is ours, and stays generic.
 */
export function getSignupCallbackErrorKey(
  error: unknown,
  { hasInvite }: { hasInvite: boolean },
): SignupErrorMessageKey {
  const response = readField(error, "response");
  const status = readField(response, "status");
  const code = getApiErrorCode(error);

  if (status === 429 || code === API_ERROR_CODE.RATE_LIMITED) {
    return "toast-signup-error-rate-limited";
  }
  const inviteKey = code ? INVITE_CODE_KEYS[code] : undefined;
  if (inviteKey) return inviteKey;
  const refused =
    code === API_ERROR_CODE.BAD_REQUEST || code === API_ERROR_CODE.CONFLICT;
  if (hasInvite && refused) return "toast-signup-error-invite";
  if (!hasInvite && code === API_ERROR_CODE.BAD_REQUEST) {
    return "toast-signup-error-email-taken";
  }
  return GENERIC;
}
