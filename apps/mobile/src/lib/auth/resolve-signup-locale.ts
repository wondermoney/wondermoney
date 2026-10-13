import { getLocales } from 'expo-localization'

export type SignupLocale = 'en' | 'pt' | 'es'

const SUPPORTED: readonly SignupLocale[] = ['en', 'pt', 'es']

export function resolveSignupLocale(
  read: () => { languageCode: string | null }[] = getLocales,
): SignupLocale {
  const code = read()[0]?.languageCode?.toLowerCase() ?? 'en'
  return (SUPPORTED as readonly string[]).includes(code) ? (code as SignupLocale) : 'en'
}
