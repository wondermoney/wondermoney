import { z } from 'zod';

import { SupportedLanguages } from '@entity/Appuser';

/** The web locales a signup can start from. */
const SIGNUP_ROUTE_LOCALES = ['en', 'pt', 'es'] as const;
type SignupRouteLocale = (typeof SIGNUP_ROUTE_LOCALES)[number];

export const authCallbackRequestSchema = z.object({
  body: z.object({
    inviteToken: z.string().max(200).optional(),
    locale: z.enum(SIGNUP_ROUTE_LOCALES).default('en'),
  }),
});

const EMAIL_LANGUAGE_BY_ROUTE_LOCALE: Readonly<Record<SignupRouteLocale, SupportedLanguages>> = {
  en: SupportedLanguages.EN,
  es: SupportedLanguages.EN,
  pt: SupportedLanguages.PT,
};

export function mapRouteLocaleToEmailLanguage(locale: SignupRouteLocale): SupportedLanguages {
  return EMAIL_LANGUAGE_BY_ROUTE_LOCALE[locale];
}
