import {
  exchangePairingCode,
  pairedCookieJar,
  pairingCookieStorageKey,
  parsePairingUrl,
  storePairedSession,
} from './pairing'

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

describe('parsePairingUrl', () => {
  it('reads the server and code out of a pairing link', () => {
    expect(parsePairingUrl('wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop')).toEqual({
      code: 'abcdefghijklmnop',
      server: 'https://api.example.test',
    })
  })

  it('normalises a server address without a scheme', () => {
    expect(parsePairingUrl('wondermoney://pair?server=money.example.com&code=abcdefghijklmnop')?.server)
      .toBe('https://money.example.com')
  })

  it.each([
    ['another scheme', 'https://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop'],
    ['another host', 'wondermoney://join?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop'],
    ['no code', 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test'],
    ['a short code', 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=short'],
    ['no server', 'wondermoney://pair?code=abcdefghijklmnop'],
    ['not a url', 'not a url'],
    ['empty', ''],
  ])('rejects %s', (_label, url) => {
    expect(parsePairingUrl(url)).toBeNull()
  })
})

describe('exchangePairingCode', () => {
  const payload = { code: 'abcdefghijklmnop', server: 'https://api.example.test' }

  it('refuses a server that is not a WonderMoney server, without sending the code', async () => {
    const fetchImpl = jest.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse({}, 404))
      throw new Error(`unexpected request to ${url}`)
    })

    const outcome = await exchangePairingCode(payload, { appVersion: '1.0.2', fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(outcome).toEqual({ status: 'not-wondermoney' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable server', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error('offline')))

    const outcome = await exchangePairingCode(payload, { appVersion: '1.0.2', fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(outcome).toEqual({ status: 'unreachable' })
  })

  it('asks for an app update when the server requires a newer version', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(jsonResponse({ ...instance, minAppVersion: '9.0.0' })),
    )

    const outcome = await exchangePairingCode(payload, { appVersion: '1.0.2', fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(outcome).toEqual({ minAppVersion: '9.0.0', status: 'update-required' })
  })

  it('treats a refused code as expired or already used', async () => {
    const fetchImpl = jest.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse(instance))
      return Promise.resolve(jsonResponse({ code: 'pairing_code_invalid' }, 404))
    })

    const outcome = await exchangePairingCode(payload, { appVersion: '1.0.2', fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(outcome).toEqual({ status: 'invalid-code' })
  })

  it('sends the code and the app identity, and returns the session to store', async () => {
    const fetchImpl = jest.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse(instance))
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'abcdefghijklmnop' })
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe('WonderMoney/1.0.2 (ios)')
      return Promise.resolve(jsonResponse({
        session: {
          cookieName: 'better-auth.session_token',
          cookieValue: 'token.signature',
          expiresAt: '2026-01-08T00:00:00.000Z',
        },
      }, 201))
    })

    const outcome = await exchangePairingCode(payload, {
      appVersion: '1.0.2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      platform: 'ios',
    })

    expect(outcome).toEqual({
      session: {
        cookieName: 'better-auth.session_token',
        cookieValue: 'token.signature',
        expiresAt: '2026-01-08T00:00:00.000Z',
      },
      status: 'paired',
    })
  })

  it('refuses a success response without a session', async () => {
    const fetchImpl = jest.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse(instance))
      return Promise.resolve(jsonResponse({}, 201))
    })

    const outcome = await exchangePairingCode(payload, { appVersion: '1.0.2', fetchImpl: fetchImpl as unknown as typeof fetch })

    expect(outcome).toEqual({ status: 'unavailable' })
  })
})

describe('storing the paired session', () => {
  const session = {
    cookieName: 'better-auth.session_token',
    cookieValue: 'token.signature',
    expiresAt: '2026-01-08T00:00:00.000Z',
  }

  it('writes the cookie jar the Expo client reads', async () => {
    const setItem = jest.fn(() => Promise.resolve())

    await storePairedSession('https://api.example.test', session, { setItem })

    expect(setItem).toHaveBeenCalledWith('better-auth_cookie', pairedCookieJar(session))
    expect(JSON.parse(pairedCookieJar(session))).toEqual({
      'better-auth.session_token': { expires: '2026-01-08T00:00:00.000Z', value: 'token.signature' },
    })
  })

  it('keeps production sessions in their own namespace', () => {
    expect(pairingCookieStorageKey('https://api.wonder.money')).toBe('prod.better-auth_cookie')
    expect(pairingCookieStorageKey('https://api.example.test')).toBe('better-auth_cookie')
  })
})
