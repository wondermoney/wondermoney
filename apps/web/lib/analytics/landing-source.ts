import {
  ANALYTICS_REFERRER_CLASSES,
  type AnalyticsReferrerClass,
} from "@wondermoney/shared/analytics";

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

/**
 * The query parameter the website adds to every signup link, with its analytics consent: where
 * the visitor came to the website from, as a coarse class (`ai_assistant`, `search`, `social`,
 * `direct`, `other`), never the referrer or a campaign value.
 */
export const REFERRER_CLASS_PARAM = "referrer_class";

/**
 * The referrer class to send with a signup, or undefined: under the same consent as the landing
 * source, and only a class the catalogue lists.
 */
export function getConsentedReferrerClass(searchParams: {
  get(name: string): null | string;
}): AnalyticsReferrerClass | undefined {
  if (getAnalyticsConsent() !== "granted") return undefined;
  const value = searchParams.get(REFERRER_CLASS_PARAM);
  return (ANALYTICS_REFERRER_CLASSES as readonly (null | string)[]).includes(value)
    ? (value as AnalyticsReferrerClass)
    : undefined;
}
