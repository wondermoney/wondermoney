import { act, renderHook } from '@testing-library/react-native'

import { usePairing } from './use-pairing'

const mockServerSwitch = {
  // The build's default; the QR points at another server.
  apiBaseUrl: 'https://default.example.test',
  switchServer: jest.fn(),
  usesDefaultServer: true,
}

jest.mock('@/components/providers/server-switch-provider', () => ({
  useServerSwitch: () => mockServerSwitch,
}))

const instance = {
  apiVersion: 1,
  features: {
    ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
    bankSync: false,
    contactForm: false,
    email: false,
    fileStorage: false,
    marketData: false,
  },
  minAppVersion: null,
  name: 'WonderMoney',
  signupMode: 'open',
}

const jsonResponse = (body: unknown, status = 200) =>
  ({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status }) as Response

const payload = { code: 'abcdefghijklmnop', server: 'https://api.example.test' }

function fetchFor(pairStatus: number, pairBody: unknown) {
  return jest.fn((input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse(instance))
    return Promise.resolve(jsonResponse(pairBody, pairStatus))
  }) as unknown as typeof fetch
}

describe('usePairing', () => {
  beforeEach(() => {
    mockServerSwitch.switchServer.mockReset()
    mockServerSwitch.switchServer.mockResolvedValue(undefined)
  })

  it('stores the session cookie before switching servers, so the new client finds it', async () => {
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
    const fetchImpl = fetchFor(201, {
      session: { cookieName: 'better-auth.session_token', cookieValue: 'token.signature', expiresAt: '2026-01-08T00:00:00.000Z' },
    })
    const { result } = await renderHook(() => usePairing({ appVersion: '1.0.2', fetchImpl, storage }))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.pair(payload)
    })

    expect(outcome).toBe('paired')
    expect(calls).toEqual(['store', 'switch'])
    expect(storage.setItem).toHaveBeenCalledWith('better-auth_cookie', expect.stringContaining('token.signature'))
    expect(mockServerSwitch.switchServer).toHaveBeenCalledWith('https://api.example.test')
  })

  it('does not switch servers when the code is refused', async () => {
    const storage = { setItem: jest.fn(() => Promise.resolve()) }
    const fetchImpl = fetchFor(404, { code: 'pairing_code_invalid' })
    const { result } = await renderHook(() => usePairing({ appVersion: '1.0.2', fetchImpl, storage }))

    await act(async () => {
      expect(await result.current.pair(payload)).toBe('invalid-code')
    })

    expect(storage.setItem).not.toHaveBeenCalled()
    expect(mockServerSwitch.switchServer).not.toHaveBeenCalled()
    expect(result.current.status).toBe('invalid-code')
  })

  it('reports an unreachable server without storing anything', async () => {
    const storage = { setItem: jest.fn(() => Promise.resolve()) }
    const fetchImpl = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    const { result } = await renderHook(() => usePairing({ appVersion: '1.0.2', fetchImpl, storage }))

    await act(async () => {
      expect(await result.current.pair(payload)).toBe('unreachable')
    })

    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
