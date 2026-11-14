import type { ExpoConfig } from 'expo/config'

/**
 * app.config.ts turns WONDERMONEY_PASSKEY_DOMAINS into the iOS entitlement and the list the app
 * gates on (`extra.passkeyDomains`), so both always agree. No domain is written into the source.
 */
function loadConfig(domains: string | undefined): ExpoConfig {
  const previous = process.env.WONDERMONEY_PASSKEY_DOMAINS
  if (domains === undefined) delete process.env.WONDERMONEY_PASSKEY_DOMAINS
  else process.env.WONDERMONEY_PASSKEY_DOMAINS = domains
  try {
    let config: ExpoConfig | undefined
    jest.isolateModules(() => {
      // Ignore a developer's gitignored .env.local, which app.config.ts would otherwise read.
      jest.doMock('node:fs', () => ({ ...jest.requireActual('node:fs'), existsSync: () => false }))
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config = (require('../../../app.config') as { default: ExpoConfig }).default
    })
    return config as ExpoConfig
  } finally {
    if (previous === undefined) delete process.env.WONDERMONEY_PASSKEY_DOMAINS
    else process.env.WONDERMONEY_PASSKEY_DOMAINS = previous
  }
}

describe('app.config.ts passkey domains', () => {
  it('adds a webcredentials entitlement per configured hostname and hands the same list to the app', () => {
    const config = loadConfig(' Money.Example.com, not a domain ,money.example.com,other.example.org')

    expect(config.ios?.associatedDomains).toEqual(['webcredentials:money.example.com', 'webcredentials:other.example.org'])
    expect(config.extra?.passkeyDomains).toEqual(['money.example.com', 'other.example.org'])
  })

  it('has no entitlement and no passkey domains when unset', () => {
    const config = loadConfig(undefined)

    expect(config.ios?.associatedDomains).toBeUndefined()
    expect(config.extra?.passkeyDomains).toEqual([])
  })
})
