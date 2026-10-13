import { resolveSignupLocale } from './resolve-signup-locale'

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
