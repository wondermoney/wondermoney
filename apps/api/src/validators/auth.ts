import { ANALYTICS_REFERRER_CLASSES } from '@wondermoney/shared';
import { z } from 'zod';

import { SupportedLanguages } from '@entity/Appuser';

/** The web locales a signup can start from. */
export const SIGNUP_ROUTE_LOCALES = ['en', 'pt', 'es'] as const;
export type SignupRouteLocale = (typeof SIGNUP_ROUTE_LOCALES)[number];

/**
 * The wonder.money page a signup came from: the route id of a landing tool or curated list
 * (`toolMortgage`, `curatedPodcasts`). The web app sends it only when the visitor allowed
 * analytics on both the website and the app. A value of any other shape is dropped rather than
 * failing the signup over analytics.
 */
export const LANDING_SOURCE_PATTERN = /^[a-z][A-Za-z0-9]{1,63}$/u;
const landingSourceSchema = z.string().regex(LANDING_SOURCE_PATTERN).optional().catch(undefined);

/**
 * Where the visitor came to the website from, as one of the catalogue's coarse classes
 * (`ai_assistant`, `search`, `social`, `direct`, `other`), never the referrer or a campaign value.
 * Sent under the same consent as the landing source; any other value is dropped.
 */
const referrerClassSchema = z.enum(ANALYTICS_REFERRER_CLASSES).optional().catch(undefined);

export const authCallbackRequestSchema = z.object({
  body: z.object({
    inviteToken: z.string().max(200).optional(),
    landingSource: landingSourceSchema,
    locale: z.enum(SIGNUP_ROUTE_LOCALES).default('en'),
    referrerClass: referrerClassSchema,
  }),
});

const EMAIL_LANGUAGE_BY_ROUTE_LOCALE: Readonly<Record<SignupRouteLocale, SupportedLanguages>> = {
  en: SupportedLanguages.EN,
  es: SupportedLanguages.ES,
  pt: SupportedLanguages.PT,
};

export function mapRouteLocaleToEmailLanguage(locale: SignupRouteLocale): SupportedLanguages {
  return EMAIL_LANGUAGE_BY_ROUTE_LOCALE[locale];
}
