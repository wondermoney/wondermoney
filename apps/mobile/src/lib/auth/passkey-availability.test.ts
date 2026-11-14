import { appPasskeyDomains, isPasskeyAvailable } from './passkey-availability'

const available = (overrides: Partial<Parameters<typeof isPasskeyAvailable>[0]> = {}) => isPasskeyAvailable({
  serverPasskey: true,
  rpId: 'money.example.com',
  appDomains: ['money.example.com'],
  deviceSupported: true,
  ...overrides,
})

describe('isPasskeyAvailable', () => {
  it('offers passkeys when the server has them under a hostname the build is associated with', () => {
    expect(available()).toBe(true)
    expect(available({ rpId: 'Money.Example.com ', appDomains: ['other.example.org', 'money.example.com'] })).toBe(true)
  })

  it('hides them on a server whose passkey hostname is not in the build, such as a self-hosted one', () => {
    expect(available({ rpId: 'finances.example.net' })).toBe(false)
    // Only the exact hostname: a passkey for a parent or sibling domain is a different relying party.
    expect(available({ rpId: 'example.com' })).toBe(false)
    expect(available({ rpId: 'app.money.example.com' })).toBe(false)
  })

  it('hides them on a build with no associated domains', () => {
    expect(available({ appDomains: [] })).toBe(false)
  })

  it('hides them until the server has said it has passkeys, and on a server that predates the hostname', () => {
    expect(available({ serverPasskey: undefined })).toBe(false)
    expect(available({ serverPasskey: false })).toBe(false)
    expect(available({ rpId: undefined })).toBe(false)
    expect(available({ rpId: '' })).toBe(false)
  })

  it('hides them on a device that cannot use passkeys', () => {
    expect(available({ deviceSupported: false })).toBe(false)
  })
})

describe('appPasskeyDomains', () => {
  it('reads the hostnames app.config.ts wrote into extra', () => {
    expect(appPasskeyDomains({ passkeyDomains: ['Money.Example.com', 'other.example.org'] })).toEqual(['money.example.com', 'other.example.org'])
  })

  it('reads a missing or malformed value as none', () => {
    expect(appPasskeyDomains(undefined)).toEqual([])
    expect(appPasskeyDomains(null)).toEqual([])
    expect(appPasskeyDomains({})).toEqual([])
    expect(appPasskeyDomains({ passkeyDomains: 'money.example.com' })).toEqual([])
    expect(appPasskeyDomains({ passkeyDomains: [42, '', 'money.example.com'] })).toEqual(['money.example.com'])
  })

  it('has none in a build without WONDERMONEY_PASSKEY_DOMAINS', () => {
    expect(appPasskeyDomains()).toEqual([])
  })
})
