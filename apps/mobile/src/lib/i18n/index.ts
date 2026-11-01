import { createInstance, type i18n } from 'i18next'

import en from './resources/en.json'
import es from './resources/es.json'
import ptPT from './resources/pt-PT.json'

const localeResources = {
  en,
  'pt-PT': ptPT,
  es,
} as const

export const foundationResources = Object.fromEntries(
  Object.entries(localeResources).map(([locale, translation]) => [locale, { translation }]),
) as { [Locale in keyof typeof localeResources]: { translation: (typeof localeResources)[Locale] } }

type Locale = keyof typeof localeResources
type LocaleResource = (typeof localeResources)[Locale]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const collectLeafKeys = (value: unknown, prefix = ''): string[] => {
  if (Array.isArray(value)) {
    throw new Error(`Invalid leaf at ${prefix || 'root'}: arrays are not supported.`)
  }

  if (!isRecord(value)) {
    if (typeof value === 'string' && value.trim().length > 0 && prefix) {
      return [prefix]
    }

    throw new Error(`Invalid leaf at ${prefix || 'root'}: expected a non-empty string.`)
  }

  if (Object.keys(value).length === 0) {
    throw new Error(`Invalid leaf at ${prefix || 'root'}: empty objects are not supported.`)
  }

  return Object.entries(value).flatMap(([key, child]) => collectLeafKeys(child, prefix ? `${prefix}.${key}` : key))
}

const sorted = (values: string[]) => [...new Set(values)].sort()

const requiredLocales = sorted(Object.keys(foundationResources))

const normalizeLocale = (locale: string): Locale => {
  const candidate = locale.trim().replace(/_/g, '-').toLowerCase()

  if (!candidate) {
    return 'en'
  }

  const [base] = candidate.split('-')

  if (base === 'pt') {
    return 'pt-PT'
  }

  if (base === 'es') {
    return 'es'
  }

  if (base === 'en') {
    return 'en'
  }

  return 'en'
}

export function validateFoundationResources(resources = localeResources): true {
  if (!isRecord(resources)) {
    throw new Error('Foundation locale resources must be objects.')
  }

  const locales = sorted(Object.keys(resources))

  if (
    locales.length !== requiredLocales.length ||
    requiredLocales.some((locale) => !(locale in resources)) ||
    locales.some((locale) => !requiredLocales.includes(locale as Locale))
  ) {
    throw new Error(`Expected locale set ${requiredLocales.join(', ')}.`)
  }

  const referenceLocale = requiredLocales[0] as Locale
  const referenceResource = resources[referenceLocale] as LocaleResource
  const referenceKeys = sorted(collectLeafKeys(referenceResource))

  for (const locale of requiredLocales.slice(1) as Locale[]) {
    const resource = resources[locale] as LocaleResource
    const currentKeys = sorted(collectLeafKeys(resource))
    const missing = referenceKeys.filter((key) => !currentKeys.includes(key))
    const extra = currentKeys.filter((key) => !referenceKeys.includes(key))

    if (missing.length || extra.length) {
      throw new Error(
        `Missing or extra keys for ${locale}; reference locale ${referenceLocale}. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`,
      )
    }
  }

  return true
}

export async function initMobileI18n(locale: string): Promise<i18n> {
  validateFoundationResources()

  const normalizedLocale = normalizeLocale(locale)
  const instance = createInstance()

  await instance.init({
    lng: normalizedLocale,
    fallbackLng: 'en',
    defaultNS: 'translation',
    ns: ['translation'],
    supportedLngs: requiredLocales,
    load: 'currentOnly',
    interpolation: {
      escapeValue: false,
    },
    resources: foundationResources,
    returnEmptyString: false,
    returnNull: false,
  })

  return instance
}
