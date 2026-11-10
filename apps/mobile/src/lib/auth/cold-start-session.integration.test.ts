import type { AuthSession } from './app-auth'
import { createAppAuthAdapter, type BetterAuthClientPort } from './app-auth-adapter'
import { createApiAuthClient } from './auth-client'
import type { BetterAuthExpoStorage } from './secure-session-storage'
import { createSessionLifecycle, type AppStatePort, type SessionLifecycleState } from './session-lifecycle'

// expo-linking needs a native manifest to build the `expo-origin` header; only its
// URL builder is used by the better-auth Expo client.
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `wondermoney://${path.replace(/^\//, '')}`,
}))

/**
 * Reproduces the reported cold start: the build's default server is
 * http://localhost:3001, the user picked http://localhost:3011 on the sign-in
 * screen, signed in there, and the app process was killed and relaunched.
 *
 * Runs the real better-auth client and Expo plugin over an in-memory keychain
 * that survives the "relaunch" (a fresh client, adapter and lifecycle), with the
 * two servers faked at the fetch boundary.
 */

const CUSTOM_SERVER = 'http://localhost:3011'
const SIGNED_IN_SESSION = 'session-on-localhost-3011'
const USER = { id: 'user-sofia', email: 'sofia@wonder.money', name: 'Sofia', emailVerified: true }

const createKeychain = () => {
  const values = new Map<string, string>()
  const storage: BetterAuthExpoStorage = {
    getItem: (key) => values.get(key) ?? null,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    setItemAsync: async (key, value) => { values.set(key, value) },
  }
  return { values, storage }
}

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...headers },
})

const sessionBody = () => ({
  session: {
    id: 'session-1',
    token: SIGNED_IN_SESSION,
    userId: USER.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  },
  user: USER,
})

type ServerMode = 'up' | 'offline'

/** The custom server (sessions are DB-backed and stay valid) and the default one, which knows no session. */
const createServers = () => {
  let mode: ServerMode = 'up'
  const requests: string[] = []
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const cookie = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('cookie') ?? ''
    requests.push(`${method} ${url.origin}${url.pathname}`)

    if (mode === 'offline') throw new TypeError('Network request failed')

    if (url.origin !== CUSTOM_SERVER) {
      // The default server's API has never seen this session: it answers "no
      // session" and clears the cookie, as better-auth does for an unknown token.
      return json(null, { 'set-cookie': 'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly' })
    }
    if (url.pathname === '/api/auth/sign-in/email') {
      return json({ redirect: false, token: SIGNED_IN_SESSION, user: USER }, {
        'set-cookie': `better-auth.session_token=${encodeURIComponent(SIGNED_IN_SESSION)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`,
      })
    }
    if (url.pathname === '/api/auth/get-session') {
      return json(cookie.includes(`better-auth.session_token=${encodeURIComponent(SIGNED_IN_SESSION)}`) ? sessionBody() : null)
    }
    return new Response(null, { status: 404 })
  })
  return {
    fetchImpl,
    requests,
    setMode: (next: ServerMode) => { mode = next },
  }
}

const appState: AppStatePort = {
  currentState: 'inactive',
  addEventListener: () => ({ remove: () => undefined }),
}

/** One app process: the composition `createLiveAppDependencies` builds for a saved server. */
const launch = (storage: BetterAuthExpoStorage) => {
  const client = createApiAuthClient({ baseUrl: CUSTOM_SERVER, scheme: 'wondermoney', storage })
  const auth = createAppAuthAdapter(client as unknown as BetterAuthClientPort)
  const lifecycle = createSessionLifecycle({ auth, appState })
  return { auth, lifecycle }
}

const settled = async (lifecycle: ReturnType<typeof launch>['lifecycle']) => {
  await lifecycle.start()
  // Let the signal-driven lookups (better-auth toggles its signal on a timer) land.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return lifecycle.state as SessionLifecycleState<AuthSession>
}

describe('cold start on a custom server', () => {
  const originalFetch = globalThis.fetch
  let servers: ReturnType<typeof createServers>

  beforeEach(() => {
    servers = createServers()
    globalThis.fetch = servers.fetchImpl as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const signInThenKill = async (storage: BetterAuthExpoStorage) => {
    const first = launch(storage)
    await settled(first.lifecycle)
    await expect(first.auth.signInWithPassword(USER.email, 'password')).resolves.toEqual({ status: 'accepted' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(first.lifecycle.state).toEqual({
      status: 'ready',
      session: { user: { id: USER.id }, accessToken: SIGNED_IN_SESSION },
    })
    // The process is killed: nothing is disposed, only the keychain survives.
  }

  it('restores the signed-in session after the app is killed and relaunched', async () => {
    const keychain = createKeychain()
    await signInThenKill(keychain.storage)

    const relaunched = launch(keychain.storage)
    await expect(settled(relaunched.lifecycle)).resolves.toEqual({
      status: 'ready',
      session: { user: { id: USER.id }, accessToken: SIGNED_IN_SESSION },
    })
    // Nothing at boot talks to the build's default server.
    expect(servers.requests.every((request) => request.includes(CUSTOM_SERVER))).toBe(true)
  })

  it('shows a retryable error, and keeps the stored session, when the server is unreachable at boot', async () => {
    const keychain = createKeychain()
    await signInThenKill(keychain.storage)
    const storedCookie = keychain.values.get('better-auth_cookie')
    expect(storedCookie).toContain(encodeURIComponent(SIGNED_IN_SESSION))

    servers.setMode('offline')
    const offline = launch(keychain.storage)
    await expect(settled(offline.lifecycle)).resolves.toEqual({ status: 'recoverable-error' })
    expect(keychain.values.get('better-auth_cookie')).toBe(storedCookie)

    // Back online, the next launch (or the retry) restores the same session.
    servers.setMode('up')
    const online = launch(keychain.storage)
    await expect(settled(online.lifecycle)).resolves.toEqual({
      status: 'ready',
      session: { user: { id: USER.id }, accessToken: SIGNED_IN_SESSION },
    })
  })
})
