import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";

/**
 * The account-access refusals that have their own sentence, keyed by API error code.
 * The keys are also the message keys under `accountSharing.errors`.
 */
const ACCOUNT_ACCESS_ERROR_CODES = [
  API_ERROR_CODE.ACCOUNT_READ_ONLY,
  API_ERROR_CODE.ACCOUNT_SHARE_MANAGER_REQUIRED,
  API_ERROR_CODE.ACCOUNT_OWNERSHIP_MANAGER_REQUIRED,
] as const;

export type AccountAccessErrorKey = (typeof ACCOUNT_ACCESS_ERROR_CODES)[number];

/** The `accountSharing.errors` key for `error`, or `undefined` for any other failure. */
export function accountAccessErrorKey(
  error: unknown,
): AccountAccessErrorKey | undefined {
  const code = getApiErrorCode(error);
  return ACCOUNT_ACCESS_ERROR_CODES.find((known) => known === code);
}
