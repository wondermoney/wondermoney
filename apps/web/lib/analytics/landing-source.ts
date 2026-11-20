import { getAnalyticsConsent } from "./consent";

/**
 * The query parameter the wonder.money website adds to its signup links on a landing tool or
 * curated list page (`/auth/signup?landing_source=toolMortgage`), only with the website's
 * analytics consent. Its value is that page's route id.
 */
export const LANDING_SOURCE_PARAM = "landing_source";

// The API's `LANDING_SOURCE_PATTERN` (apps/api/src/validators/auth.ts): a camelCase route id.
const LANDING_SOURCE_PATTERN = /^[a-z][A-Za-z0-9]{1,63}$/u;

/**
 * The landing source to send with a signup, or undefined. The app's own analytics consent
 * must be granted too: the website's consent alone never records anything here.
 */
export function getConsentedLandingSource(searchParams: {
  get(name: string): null | string;
}): string | undefined {
  if (getAnalyticsConsent() !== "granted") return undefined;
  const value = searchParams.get(LANDING_SOURCE_PARAM);
  return value && LANDING_SOURCE_PATTERN.test(value) ? value : undefined;
}
