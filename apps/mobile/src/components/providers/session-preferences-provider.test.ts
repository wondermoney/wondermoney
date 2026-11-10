import { resolveLocale, resolveTheme } from './session-preferences-provider'

describe('session preference resolution', () => {
  it.each([
    ['device', 'pt-BR', 'pt-PT'], ['device', 'es-MX', 'es'], ['device', 'fr-FR', 'en'], ['en', 'pt-PT', 'en'],
  ] as const)('resolves %s with device %s to %s', (preference, device, expected) => expect(resolveLocale(preference, device)).toBe(expected))

  it('resolves explicit and system themes', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark')
    expect(resolveTheme('system', null)).toBe('light')
    expect(resolveTheme('light', 'dark')).toBe('light')
  })
})
