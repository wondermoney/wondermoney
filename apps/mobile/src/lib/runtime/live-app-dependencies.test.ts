import { createApiAuthClient } from '@/lib/auth/auth-client'

import { createLiveAppDependencies } from './live-app-dependencies'

// The vendor client construction is exercised by the real adapter/type checks;
// here it is stubbed so the dependency-assembly test never imports the ESM
// better-auth runtime. No OAuth/MFA flow is mocked — the constructors are real.
jest.mock('@/lib/auth/auth-client', () => ({
  createApiAuthClient: jest.fn(() => ({})),
}))

const appState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}

describe('createLiveAppDependencies', () => {
  beforeEach(() => {
    jest.mocked(createApiAuthClient).mockClear()
  })

  it('fails safely when public environment is unavailable', () => {
    expect(createLiveAppDependencies({}, appState)).toEqual({ status: 'unavailable' })
  })

  it('constructs local clients without fetching', () => {
    const fetchImpl = jest.fn() as never
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState, fetchImpl)

    expect(result.status).toBe('available')
    expect(fetchImpl).not.toHaveBeenCalled()
    if (result.status === 'available') {
      expect(createApiAuthClient).toHaveBeenCalledTimes(1)
      expect(createApiAuthClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3001',
        scheme: 'wondermoney',
      })
      expect(result.dependencies.createSessionLifecycle()).not.toBe(result.dependencies.createSessionLifecycle())
    }
  })

  it('hands the analytics boundary validated inputs rather than a constructed vendor client', () => {
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://staging.api.wonder.money',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState)

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.dependencies.analytics).toEqual({ environment: 'staging', apiKey: 'phc_test' })
  })

  it('hands the crash-reporting boundary the environment alone — the DSN is a constant, not config', () => {
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://staging.api.wonder.money',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState)

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.dependencies.errorReporting).toEqual({ environment: 'staging' })
  })

  it('talks to a server the user chose, and marks it as not the default', () => {
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState, jest.fn() as never, 'https://money.example.com')

    expect(createApiAuthClient).toHaveBeenCalledWith({ baseUrl: 'https://money.example.com', scheme: 'wondermoney' })
    expect(result).toMatchObject({ dependencies: { apiBaseUrl: 'https://money.example.com', usesDefaultServer: false }, status: 'available' })
  })

  it('marks the build default as the default server', () => {
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.wonder.money',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState)

    expect(result).toMatchObject({ dependencies: { usesDefaultServer: true }, status: 'available' })
  })

  it('fails safely when the PostHog key is not a public project key', () => {
    expect(createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      EXPO_PUBLIC_POSTHOG_KEY: 'phx_personal_api_key',
    }, appState)).toEqual({ status: 'unavailable' })
  })
})
