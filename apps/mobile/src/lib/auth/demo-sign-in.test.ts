import { requestDemoSession } from './demo-sign-in'

const SERVER = 'https://money.example.test'
const session = { cookieName: 'better-auth.session_token', cookieValue: 'token.signature', expiresAt: '2026-01-08T02:00:00.000Z' }

const jsonResponse = (body: unknown, status: number) =>
  ({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status }) as Response

const answering = (response: Response) => jest.fn(() => Promise.resolve(response)) as unknown as jest.MockedFunction<typeof fetch>

describe('requestDemoSession', () => {
  it('posts to the demo sign-in and hands back the session', async () => {
    const fetchImpl = answering(jsonResponse({ session }, 201))

    const outcome = await requestDemoSession(SERVER, { appVersion: '1.0.2', fetchImpl })

    expect(outcome).toEqual({ session, status: 'signed-in' })
    expect(fetchImpl).toHaveBeenCalledWith(`${SERVER}/v1/auth/demo`, expect.objectContaining({ method: 'POST' }))
  })

  it.each([
    [404, { code: 'not_found' }, 'disabled'],
    [429, { code: 'RATE_LIMITED', retryAfter: 60 }, 'rate-limited'],
    [503, { code: 'demo_unavailable' }, 'unavailable'],
    [500, {}, 'unavailable'],
    [201, { session: { cookieName: 'x' } }, 'unavailable'],
  ])('reads a %i answer as %s', async (status, body, expected) => {
    const outcome = await requestDemoSession(SERVER, { appVersion: '1.0.2', fetchImpl: answering(jsonResponse(body, status)) })

    expect(outcome).toEqual({ status: expected })
  })

  it('reports a request that never reached the server', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch

    expect(await requestDemoSession(SERVER, { appVersion: '1.0.2', fetchImpl })).toEqual({ status: 'unreachable' })
  })
})
