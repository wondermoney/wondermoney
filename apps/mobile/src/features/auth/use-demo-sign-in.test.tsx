import { act, renderHook } from '@testing-library/react-native'

import { useDemoSignIn } from './use-demo-sign-in'

const mockServerSwitch = {
  apiBaseUrl: 'https://money.example.test',
  switchServer: jest.fn(),
  usesDefaultServer: true,
}

jest.mock('@/components/providers/server-switch-provider', () => ({
  useServerSwitch: () => mockServerSwitch,
}))

const session = { cookieName: 'better-auth.session_token', cookieValue: 'token.signature', expiresAt: '2026-01-08T02:00:00.000Z' }

const jsonResponse = (body: unknown, status: number) =>
  ({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status }) as Response

const answering = (status: number, body: unknown) =>
  jest.fn(() => Promise.resolve(jsonResponse(body, status))) as unknown as jest.MockedFunction<typeof fetch>

describe('useDemoSignIn', () => {
  beforeEach(() => {
    mockServerSwitch.apiBaseUrl = 'https://money.example.test'
    mockServerSwitch.usesDefaultServer = true
    mockServerSwitch.switchServer.mockReset()
    mockServerSwitch.switchServer.mockResolvedValue(undefined)
  })

  it('asks the connected server, stores the session, then rebuilds the runtime so it opens signed in', async () => {
    const calls: string[] = []
    const storage = {
      setItem: jest.fn(() => {
        calls.push('store')
        return Promise.resolve()
      }),
    }
    mockServerSwitch.switchServer.mockImplementation(() => {
      calls.push('switch')
      return Promise.resolve()
    })
    const fetchImpl = answering(201, { session })
    const { result } = await renderHook(() => useDemoSignIn({ appVersion: '1.0.2', fetchImpl, storage }))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.signIn()
    })

    expect(outcome).toBe('signed-in')
    expect(fetchImpl).toHaveBeenCalledWith('https://money.example.test/v1/auth/demo', expect.objectContaining({ method: 'POST' }))
    expect(calls).toEqual(['store', 'switch'])
    expect(storage.setItem).toHaveBeenCalledWith('better-auth_cookie', expect.stringContaining('token.signature'))
    // On the build's default server the choice stays unsaved.
    expect(mockServerSwitch.switchServer).toHaveBeenCalledWith(null)
  })

  it('keeps a server the person chose', async () => {
    mockServerSwitch.apiBaseUrl = 'https://self.example.test'
    mockServerSwitch.usesDefaultServer = false
    const storage = { setItem: jest.fn(() => Promise.resolve()) }
    const { result } = await renderHook(() => useDemoSignIn({ appVersion: '1.0.2', fetchImpl: answering(201, { session }), storage }))

    await act(async () => {
      await result.current.signIn()
    })

    expect(mockServerSwitch.switchServer).toHaveBeenCalledWith('https://self.example.test')
  })

  it.each([
    [404, 'disabled'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ])('stores nothing when the server answers %i', async (status, expected) => {
    const storage = { setItem: jest.fn(() => Promise.resolve()) }
    const { result } = await renderHook(() => useDemoSignIn({ appVersion: '1.0.2', fetchImpl: answering(status, {}), storage }))

    await act(async () => {
      expect(await result.current.signIn()).toBe(expected)
    })

    expect(result.current.status).toBe(expected)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(mockServerSwitch.switchServer).not.toHaveBeenCalled()
  })
})
