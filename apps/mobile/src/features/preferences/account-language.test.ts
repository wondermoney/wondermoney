import { resolveLocale, type SupportedLocale } from '@/components/providers/session-preferences-provider'

import { accountLanguageEndpoint, toAccountLanguage } from './account-language'

describe('toAccountLanguage', () => {
  it('maps every app locale to the account language the API stores', () => {
    const locales: SupportedLocale[] = ['en', 'pt-PT', 'es']
    expect(locales.map((locale) => [locale, toAccountLanguage(locale)])).toEqual([
      ['en', 'EN'],
      ['pt-PT', 'PT'],
      ['es', 'ES'],
    ])
  })

  it('follows the device language when the person keeps "Device language"', () => {
    expect(toAccountLanguage(resolveLocale('device', 'es-MX'))).toBe('ES')
    expect(toAccountLanguage(resolveLocale('device', 'pt-BR'))).toBe('PT')
    expect(toAccountLanguage(resolveLocale('device', 'fr-FR'))).toBe('EN')
  })
})

describe('accountLanguageEndpoint', () => {
  it('patches the current user', () => {
    const endpoint = accountLanguageEndpoint('a/b c')
    expect(endpoint.method).toBe('PATCH')
    expect(endpoint.path).toBe('/v1/user/a%2Fb%20c')
  })
})
