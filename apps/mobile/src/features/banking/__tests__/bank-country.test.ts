import { resolveBankCountryCode } from '../bank-country'

describe('resolveBankCountryCode', () => {
  it('uppercases a valid two-letter device region code', () => {
    expect(resolveBankCountryCode(() => [{ regionCode: 'pt' }])).toBe('PT')
  })

  it('returns undefined when the device has no region code', () => {
    expect(resolveBankCountryCode(() => [{ regionCode: null }])).toBeUndefined()
  })

  it('returns undefined when the locales list is empty', () => {
    expect(resolveBankCountryCode(() => [])).toBeUndefined()
  })

  it('rejects a malformed region code rather than forwarding it to the API', () => {
    expect(resolveBankCountryCode(() => [{ regionCode: 'GBR' }])).toBeUndefined()
    expect(resolveBankCountryCode(() => [{ regionCode: '1A' }])).toBeUndefined()
  })
})
