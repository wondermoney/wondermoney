import { getLocales } from 'expo-localization'

/** The web locales the API maps to an account language: `en` → EN, `pt` → PT, `es` → ES. */
export type SignupLocale = 'en' | 'pt' | 'es'

const SUPPORTED: readonly SignupLocale[] = ['en', 'pt', 'es']

/**
 * The sign-up locale for a language tag: the app language (`pt-PT` → `pt`, `es` → `es`), or a
 * device language. English for any other.
 */
export function toSignupLocale(tag: string | null | undefined): SignupLocale {
  const code = tag?.trim().replace(/_/g, '-').toLowerCase().split('-')[0] ?? 'en'
  return (SUPPORTED as readonly string[]).includes(code) ? (code as SignupLocale) : 'en'
}

/** The device language's sign-up locale, for when no app language is known. */
export function resolveSignupLocale(
  read: () => { languageCode: string | null }[] = getLocales,
): SignupLocale {
  return toSignupLocale(read()[0]?.languageCode)
}
