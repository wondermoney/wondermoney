/**
 * The most people one household can hold, owner included: `HOUSEHOLD_MAX_MEMBERS`, 6 by default.
 * A pending invite holds a seat until it is accepted, revoked or expires. Boot validation
 * (`configuration.ts`) refuses anything but a positive whole number, so a value read here is
 * either unset or valid; a malformed one still falls back to the default.
 */
export const DEFAULT_HOUSEHOLD_MAX_MEMBERS = 6;

export function householdMaxMembers(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const trimmed = env['HOUSEHOLD_MAX_MEMBERS']?.trim();
  if (!trimmed || !/^\d+$/u.test(trimmed)) return DEFAULT_HOUSEHOLD_MAX_MEMBERS;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_HOUSEHOLD_MAX_MEMBERS;
}
