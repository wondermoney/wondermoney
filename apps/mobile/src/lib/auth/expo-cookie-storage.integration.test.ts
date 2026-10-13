import type { BetterAuthClientPort, BetterAuthSessionData } from './app-auth-adapter'
import { createAppAuthAdapter } from './app-auth-adapter'
import { createExpoAuthPlugin } from './auth-client'
import type { BetterAuthExpoStorage } from './secure-session-storage'

describe('production Expo cookie storage namespace', () => {
  it('keeps a legacy default cookie separate and returns the production session token', async () => {
    const legacyCookie = JSON.stringify({
      'better-auth.session_token': { value: 'legacy-staging-token', expires: null },
    })
    const values = new Map([['better-auth_cookie', legacyCookie]])
    const storage: BetterAuthExpoStorage = {
      getItem: (key) => values.get(key) ?? null,
      getItemAsync: async (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      setItemAsync: async (key, value) => { values.set(key, value) },
    }

    const plugin = createExpoAuthPlugin({
      baseUrl: 'https://api.wonder.money',
      scheme: 'wondermoney',
      storage,
    })
    const actions = plugin.getActions(undefined, { notify: jest.fn() } as never)
    await plugin.fetchPlugins[0].hooks.onSuccess({
      request: { url: 'https://api.wonder.money/api/auth/sign-in/email' },
      response: new Response(null, {
        headers: {
          'set-cookie': 'prod.better-auth.session_token=production-session-token; Path=/; HttpOnly',
        },
      }),
      data: { user: { id: 'user-1' } },
    } as never)

    const sessionData: BetterAuthSessionData = {
      session: { token: 'raw-session-token' },
      user: { id: 'user-1' },
    }
    const adapter = createAppAuthAdapter({
      getCookie: actions.getCookie,
      getSession: async () => ({ data: sessionData, error: null }),
    } as BetterAuthClientPort)

    await expect(adapter.getSession()).resolves.toEqual({
      data: {
        session: {
          user: { id: 'user-1' },
          accessToken: 'production-session-token',
        },
      },
      error: null,
    })
    expect(values.get('better-auth_cookie')).toBe(legacyCookie)
    expect(values.has('prod.better-auth_cookie')).toBe(true)
  })
})
