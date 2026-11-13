import { SupportedLanguages } from '@entity/Appuser';

/** An account language as the enum or as its string value (`'ES'`), which is how jobs carry it. */
export type AccountLanguage = `${SupportedLanguages}` | SupportedLanguages;

/** The web app's locale segment for an account language; links into the app carry it. */
export type AccountLocale = 'en' | 'es' | 'pt';

/** Keyed by every enum value (`satisfies`); read by any string, so an unknown one misses. */
const LOCALE_BY_LANGUAGE: Readonly<Partial<Record<string, AccountLocale>>> = {
  [SupportedLanguages.EN]: 'en',
  [SupportedLanguages.ES]: 'es',
  [SupportedLanguages.PT]: 'pt',
} satisfies Record<SupportedLanguages, AccountLocale>;

/** The `Intl` locale that formats dates and money beside copy in a locale. */
export const INTL_LOCALE: Readonly<Record<AccountLocale, string>> = { en: 'en-GB', es: 'es-ES', pt: 'pt-PT' };

/** The web locale of an account (`ES` → `es`). Anything unknown reads as English. */
export function accountLocale(language: AccountLanguage): AccountLocale {
  return LOCALE_BY_LANGUAGE[language] ?? 'en';
}

/**
 * The language a server-side text goes out in for this account: the account's own when the text
 * has copy in it, English otherwise. `available` lists the locales the text is written in, so a
 * text with English and Portuguese copy reaches a Spanish account in English, never Portuguese.
 */
export function copyLocale<const Available extends AccountLocale>(language: AccountLanguage, available: readonly Available[]): 'en' | Available {
  const locale = accountLocale(language);
  return (available as readonly AccountLocale[]).includes(locale) ? (locale as Available) : 'en';
}
