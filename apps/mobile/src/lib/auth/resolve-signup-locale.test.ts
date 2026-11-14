import { resolveSignupLocale, toSignupLocale } from './resolve-signup-locale'

describe('resolveSignupLocale', () => {
  it('maps device language to a supported route locale', () => {
    expect(resolveSignupLocale(() => [{ languageCode: 'pt' }])).toBe('pt')
    expect(resolveSignupLocale(() => [{ languageCode: 'es' }])).toBe('es')
    expect(resolveSignupLocale(() => [{ languageCode: 'en' }])).toBe('en')
  })

  it('defaults to en for unsupported or missing languages', () => {
    expect(resolveSignupLocale(() => [{ languageCode: 'fr' }])).toBe('en')
    expect(resolveSignupLocale(() => [{ languageCode: null }])).toBe('en')
    expect(resolveSignupLocale(() => [])).toBe('en')
  })
})

describe('toSignupLocale', () => {
  it.each([
    ['pt-PT', 'pt'],
    ['es', 'es'],
    ['en', 'en'],
    ['pt_BR', 'pt'],
    ['ES-419', 'es'],
  ])('maps the app language %s to %s', (tag, locale) => {
    expect(toSignupLocale(tag)).toBe(locale)
  })

  it.each([['fr'], [''], [null], [undefined]])('falls back to en for %s', (tag) => {
    expect(toSignupLocale(tag)).toBe('en')
  })
})
