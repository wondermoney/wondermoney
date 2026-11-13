import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";

/**
 * The household refusals that have their own sentence, keyed by API error code.
 * The keys are also the message keys under `household.errors`.
 */
const HOUSEHOLD_ERROR_CODES = [
  API_ERROR_CODE.ALREADY_HOUSEHOLD_MEMBER,
  API_ERROR_CODE.DEMO_READ_ONLY,
  API_ERROR_CODE.HOUSEHOLD_FULL,
  API_ERROR_CODE.HOUSEHOLD_HAS_DATA,
  API_ERROR_CODE.HOUSEHOLD_HAS_MEMBERS,
  API_ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED,
  API_ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED,
  API_ERROR_CODE.INVITE_ALREADY_USED,
  API_ERROR_CODE.INVITE_EMAIL_MISMATCH,
  API_ERROR_CODE.INVITE_EXPIRED,
  API_ERROR_CODE.INVITE_INVALID,
] as const;

export type HouseholdErrorKey = (typeof HOUSEHOLD_ERROR_CODES)[number];

/** The `household.errors` key for `error`, or `undefined` for any other failure. */
export function householdErrorKey(
  error: unknown,
): HouseholdErrorKey | undefined {
  const code = getApiErrorCode(error);
  return HOUSEHOLD_ERROR_CODES.find((known) => known === code);
}
