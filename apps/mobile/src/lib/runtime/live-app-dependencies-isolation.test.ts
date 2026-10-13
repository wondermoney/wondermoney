import { createApiAuthClient } from '@/lib/auth/auth-client'

import { createLiveAppDependencies } from './live-app-dependencies'

jest.mock('@/lib/auth/auth-client', () => ({
  createApiAuthClient: jest.fn(() => ({ __client: 'shared' })),
}))

const appState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}

describe('createLiveAppDependencies — client sharing invariant', () => {
  it('constructs exactly one better-auth client and derives both adapters from it', () => {
    const result = createLiveAppDependencies({
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    }, appState)

    // better-auth's reset endpoints are stateless and issue no session, so the
    // old separate throwaway recovery client is gone: no second client, and so
    // no second source of session state.
    expect(createApiAuthClient).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('available')
    if (result.status !== 'available') return

    expect(result.dependencies.auth).not.toBe(result.dependencies.passwordRecovery)
    expect(typeof result.dependencies.auth.getSession).toBe('function')
    expect(typeof result.dependencies.passwordRecovery.requestReset).toBe('function')
  })
})
