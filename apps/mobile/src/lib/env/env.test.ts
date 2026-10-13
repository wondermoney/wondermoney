import { parseEnv } from './env'

const posthogKey = 'phc_KlDfjBgreGCfTKJnwwP5W9I2PEGJsboIKFoedyTHGg4'

const valid = {
  EXPO_PUBLIC_APP_ENV: 'local',
  EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
  EXPO_PUBLIC_POSTHOG_KEY: posthogKey,
}

describe('parseEnv', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('accepts local public configuration', () => {
    expect(parseEnv(valid)).toEqual({
      appEnv: 'local',
      apiBaseUrl: 'http://localhost:3001',
      posthogKey,
    })
  })

  it('accepts the approved staging API', () => {
    expect(
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_BASE_URL: 'https://staging.api.wonder.money',
      }),
    ).toMatchObject({
      appEnv: 'staging',
      apiBaseUrl: 'https://staging.api.wonder.money',
    })
  })

  it('accepts the approved production API', () => {
    expect(
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money',
      }),
    ).toMatchObject({
      appEnv: 'production',
      apiBaseUrl: 'https://api.wonder.money',
    })
  })

  it('rejects production configuration paired with a non-production API', () => {
    expect(() =>
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'https://staging.api.wonder.money',
      }),
    ).toThrow()
    expect(() =>
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      }),
    ).toThrow()
  })

  it('rejects local configuration paired with a remote API', () => {
    expect(() =>
      parseEnv({ ...valid, EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money' }),
    ).toThrow()
    expect(() =>
      parseEnv({ ...valid, EXPO_PUBLIC_API_BASE_URL: 'https://attacker.example' }),
    ).toThrow()
  })

  it('rejects staging configuration paired with a non-staging API', () => {
    expect(() =>
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money',
      }),
    ).toThrow()
    expect(() =>
      parseEnv({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      }),
    ).toThrow()
  })

  it.each(['', 'phx_personal_api_key', 'sk_live_secret', 'KlDfjBgreGCfTKJnwwP5W9I2PEGJsboIKFoedyTHGg4'])(
    'rejects PostHog credential %p that is not a public project key',
    (EXPO_PUBLIC_POSTHOG_KEY) => {
      expect(() => parseEnv({ ...valid, EXPO_PUBLIC_POSTHOG_KEY })).toThrow()
    },
  )

  it('requires the PostHog key in staging as well as local', () => {
    const staging = {
      ...valid,
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://staging.api.wonder.money',
    }
    expect(parseEnv(staging)).toMatchObject({ posthogKey })
    const { EXPO_PUBLIC_POSTHOG_KEY: _omitted, ...withoutKey } = staging
    expect(() => parseEnv(withoutKey)).toThrow()
  })

  it('requires the PostHog key in production as well as local', () => {
    const production = {
      ...valid,
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money',
    }
    expect(parseEnv(production)).toMatchObject({ posthogKey })
    const { EXPO_PUBLIC_POSTHOG_KEY: _omitted, ...withoutKey } = production
    expect(() => parseEnv(withoutKey)).toThrow()
  })

  it('rejects missing or malformed public values', () => {
    expect(() => parseEnv({})).toThrow()
    expect(() => parseEnv({ ...valid, EXPO_PUBLIC_API_BASE_URL: 'not-a-url' })).toThrow()
  })

  it('reads only the EXPO_PUBLIC_* convention, never NEXT_PUBLIC_* or BETTER_AUTH_*', () => {
    // Expo inlines only EXPO_PUBLIC_* into the bundle, so a web-style variable
    // name must not satisfy the schema — a silent NEXT_PUBLIC_* rename would
    // otherwise ship an undefined API base URL.
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_APP_ENV: 'local',
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
        EXPO_PUBLIC_POSTHOG_KEY: posthogKey,
      }),
    ).toThrow()
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_APP_ENV: 'local',
        BETTER_AUTH_URL: 'http://localhost:3001',
        EXPO_PUBLIC_POSTHOG_KEY: posthogKey,
      }),
    ).toThrow()
  })

  it('does not read leftover Supabase variables', () => {
    // A stale EXPO_PUBLIC_SUPABASE_* pair must not affect parsing either way;
    // the schema no longer recognizes it.
    expect(parseEnv({
      ...valid,
      EXPO_PUBLIC_SUPABASE_URL: 'https://cnxkjplvlwphhbtrvzai.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
    })).toEqual({
      appEnv: 'local',
      apiBaseUrl: 'http://localhost:3001',
      posthogKey,
    })
  })

  it('does not log configuration values', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    parseEnv(valid)

    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
