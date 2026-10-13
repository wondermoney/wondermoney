import type { HttpRequest } from './client'
import { createFetchTransport } from './fetch-transport'

const signal = new AbortController().signal
const request = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET',
  path: '/v1/net-worth?period=current',
  headers: { Authorization: 'Bearer private-token' },
  signal,
  tokenGeneration: 41,
  authAttempt: 1,
  ...overrides,
})

const response = (body: string, status = 200): Response => ({
  status,
  text: jest.fn(async () => body),
} as unknown as Response)

const requestInit = (fetchImpl: jest.Mock): RequestInit => (
  fetchImpl.mock.calls[0]?.[1] as RequestInit
)

describe('createFetchTransport', () => {
  it('validates the base URL when the transport is created', () => {
    expect(() => createFetchTransport({ baseUrl: 'not a URL' })).toThrow('Invalid API base URL.')
    expect(() => createFetchTransport({ baseUrl: 'ftp://api.example.test' })).toThrow(
      'Invalid API base URL.',
    )
    expect(() => createFetchTransport({ baseUrl: 'https://api.example.test/root' })).toThrow(
      'Invalid API base URL.',
    )
  })

  it('preserves the query and sends the exact safe request init', async () => {
    const fetchImpl = jest.fn(async () => response('{"ok":true}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test/', fetchImpl })

    await expect(transport.request(request())).resolves.toEqual({ status: 200, body: { ok: true } })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/v1/net-worth?period=current', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer private-token',
        Accept: 'application/json',
      },
      signal,
      credentials: 'omit',
      redirect: 'error',
    })
    const init = requestInit(fetchImpl)
    expect(JSON.stringify(init)).not.toContain('tokenGeneration')
    expect(JSON.stringify(init)).not.toContain('authAttempt')
  })

  it('does not follow or retry a redirect response in the transport', async () => {
    const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return response('', 302)
    })
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request())).resolves.toEqual({ status: 302, body: undefined })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/v1/net-worth?period=current',
    )
  })

  it('does not retry a fetch implementation redirect error', async () => {
    const redirectError = new TypeError('Redirect blocked')
    const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(init?.redirect).toBe('error')
      throw redirectError
    })
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request())).rejects.toBe(redirectError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    'https://attacker.test/v1/net-worth',
    '//attacker.test/v1/net-worth',
    '/v2/net-worth',
    '/v1/../private',
    '/v1/%2e%2e/private',
    '/v1/..%2fprivate',
    '/v1/net-worth#private',
  ])('rejects unsafe endpoint path %s without fetching', async (path) => {
    const fetchImpl = jest.fn(async () => response('{}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request({ path }))).rejects.toThrow('Invalid API endpoint path.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a callback in place of an endpoint path', async () => {
    const fetchImpl = jest.fn(async () => response('{}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })
    const unsafeRequest = request({ path: (() => '/v1/net-worth') as unknown as string })

    await expect(transport.request(unsafeRequest)).rejects.toThrow('Invalid API endpoint path.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD'] as const)('never sends a body or Content-Type for %s', async (method) => {
    const fetchImpl = jest.fn(async () => response('{"ignored":true}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    const result = await transport.request(request({ method, body: { secret: true } }))
    expect(requestInit(fetchImpl)).not.toHaveProperty('body')
    expect(requestInit(fetchImpl).headers).not.toHaveProperty('Content-Type')
    if (method === 'HEAD') expect(result.body).toBeUndefined()
  })

  it('serializes a defined write body as JSON', async () => {
    const fetchImpl = jest.fn(async () => response('', 204))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request({ method: 'POST', body: { amount: 2 } }))).resolves.toEqual({
      status: 204,
      body: undefined,
    })
    expect(requestInit(fetchImpl)).toMatchObject({
      body: '{"amount":2}',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('sends a FormData write body as-is, without JSON serialization or an explicit Content-Type', async () => {
    const fetchImpl = jest.fn(async () => response('{"ok":true}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })
    const formData = new FormData()
    formData.append('file', 'file-content')

    await expect(transport.request(request({ method: 'POST', body: formData }))).resolves.toEqual({
      status: 200,
      body: { ok: true },
    })
    const init = requestInit(fetchImpl)
    expect(init.body).toBe(formData)
    expect(init.headers).not.toHaveProperty('Content-Type')
  })

  it('sanitizes serialization failures and does not fetch', async () => {
    const fetchImpl = jest.fn(async () => response('{}'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })
    const body: { self?: unknown } = {}
    body.self = body

    const error = await transport.request(request({ method: 'POST', body })).catch((caught) => caught)
    expect(error).toEqual(new Error('Request body could not be serialized.'))
    expect(JSON.stringify(error)).not.toContain('self')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['', 200],
    ['not-json-private-response', 200],
    ['{"ignored":true}', 204],
  ] as const)('returns undefined for empty, malformed, or 204 body %#', async (text, status) => {
    const fetchImpl = jest.fn(async () => response(text, status))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request())).resolves.toEqual({ status, body: undefined })
  })

  it('returns raw text unparsed for responseType "text", even when it looks like JSON', async () => {
    const fetchImpl = jest.fn(async () => response('month,income\n2026-08,1000'))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })

    await expect(transport.request(request({ responseType: 'text' }))).resolves.toEqual({
      status: 200, body: 'month,income\n2026-08,1000',
    })

    const jsonLooking = jest.fn(async () => response('{"not":"parsed"}'))
    const jsonTransport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl: jsonLooking })
    await expect(jsonTransport.request(request({ responseType: 'text' }))).resolves.toEqual({
      status: 200, body: '{"not":"parsed"}',
    })
  })

  it('still returns undefined for a "text" HEAD or 204 response', async () => {
    const fetchImpl = jest.fn(async () => response('ignored', 204))
    const transport = createFetchTransport({ baseUrl: 'https://api.example.test', fetchImpl })
    await expect(transport.request(request({ responseType: 'text', method: 'HEAD' }))).resolves.toEqual({
      status: 204, body: undefined,
    })
  })
})
