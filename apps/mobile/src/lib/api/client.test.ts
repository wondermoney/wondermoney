import { z } from 'zod'

import { captureError } from '@/lib/telemetry/error-reporting'

import { createSessionOperationScope } from '../auth/session-operation-scope'
import { ApiError, isPostDispatchCancellation } from './errors'
import {
  createApiClient,
  type ApiClientDependencies,
  type AuthRecoveryCoordinatorPort,
  type HttpRequest,
} from './client'
import { readEndpoint, writeEndpoint } from './runtime-schema'

jest.mock('@/lib/telemetry/error-reporting', () => ({ captureError: jest.fn() }))
const mockCaptureError = jest.mocked(captureError)

const okEndpoint = readEndpoint({
  method: 'GET',
  path: '/safe-fixture',
  schema: z.object({ amount: z.string().regex(/^\d+$/) }).transform(({ amount }) => Number(amount)),
})

const token = (accessToken = 'token-0', tokenGeneration = 0) => ({
  status: 'available' as const,
  snapshot: { accessToken, tokenGeneration },
})

const recovery = (): jest.Mocked<AuthRecoveryCoordinatorPort> => ({
  getTokenSnapshot: jest.fn(async () => token()),
  refreshAfterUnauthorized: jest.fn(async (_failedSnapshot) => token('token-1', 1)),
  recoverTrustedUnauthorized: jest.fn(async () => ({ status: 'auth-session' as const })),
})

const setup = (
  request: ApiClientDependencies['transport']['request'],
  authRecovery = recovery(),
  operationScope = createSessionOperationScope(),
) => {
  const transport = { request: jest.fn(request) }
  const client = createApiClient({ transport, authRecovery, operationScope })
  return { client, transport, authRecovery, operationScope }
}

const expectCode = async (promise: Promise<unknown>, code: ApiError['code'], status?: number) => {
  await expect(promise).rejects.toMatchObject({
    name: 'ApiError',
    code,
    ...(status === undefined ? {} : { status }),
  })
}

describe('API client', () => {
  beforeEach(() => mockCaptureError.mockClear())

  it('parses and transforms successful unknown response bodies', async () => {
    const { client } = setup(async () => ({ status: 200, body: { amount: '42' } }))
    await expect(client.read(okEndpoint)).resolves.toBe(42)
  })

  it('sanitizes invalid responses without retaining Zod or payload details', async () => {
    const { client } = setup(async () => ({ status: 200, body: { amount: 'secret-value' } }))
    const error = await client.read(okEndpoint).catch((caught: unknown) => caught)

    expect(error).toEqual(expect.objectContaining({ code: 'invalid-response' }))
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw new Error('Expected ApiError')
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain('secret-value')
    expect(error.message).toBe('The server response was invalid.')
  })

  it('sanitizes exceptions thrown while an endpoint schema executes', async () => {
    const sensitivePayload = 'customer-secret-4821'
    const throwingEndpoint = readEndpoint({
      method: 'GET',
      path: '/throwing-schema',
      schema: z.string().transform((value) => {
        throw new Error(`transform rejected sensitive payload: ${value}`)
      }),
    })
    const { client } = setup(async () => ({ status: 200, body: sensitivePayload }))

    const error = await client.read(throwingEndpoint).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      code: 'invalid-response',
      message: 'The server response was invalid.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(error).not.toHaveProperty('issues')
    expect(error).not.toHaveProperty('status')
    expect(JSON.stringify(error)).not.toContain(sensitivePayload)
    expect(String(error)).not.toContain(sensitivePayload)
  })

  it('reports contract drift as the sanitized ApiError, never the error carrying the payload', async () => {
    const sensitivePayload = 'customer-secret-4821'
    const throwingEndpoint = readEndpoint({
      method: 'GET',
      path: '/throwing-schema',
      schema: z.string().transform((value) => {
        throw new Error(`transform rejected sensitive payload: ${value}`)
      }),
    })
    const { client } = setup(async () => ({ status: 200, body: sensitivePayload }))

    const thrown = await client.read(throwingEndpoint).catch((caught: unknown) => caught)

    expect(mockCaptureError).toHaveBeenCalledTimes(1)
    const reported = mockCaptureError.mock.calls[0]?.[0]
    // The same instance the caller sees: one classification, one fixed message,
    // and no `cause` chaining the original back into it.
    expect(reported).toBe(thrown)
    expect(reported).toBeInstanceOf(ApiError)
    if (!(reported instanceof ApiError)) throw new Error('Expected ApiError')
    expect(reported.message).toBe('The server response was invalid.')
    expect(reported).not.toHaveProperty('cause')
    expect(reported.stack ?? '').not.toContain(sensitivePayload)
  })

  it('reports nothing for responses that parse, or for ordinary transport and HTTP failures', async () => {
    const { client } = setup(async () => ({ status: 200, body: { amount: '42' } }))
    await expect(client.read(okEndpoint)).resolves.toBe(42)

    const failing = setup(async () => ({ status: 500, body: undefined }))
    await expectCode(failing.client.read(okEndpoint), 'http', 500)

    const offline = setup(async () => { throw new Error('Network request failed to https://api?token=abc') })
    await expectCode(offline.client.read(okEndpoint), 'network')

    expect(mockCaptureError).not.toHaveBeenCalled()
  })

  it('sends only client-owned bearer auth plus operation metadata and exact signal', async () => {
    const scope = createSessionOperationScope()
    const lease = scope.capture()
    const { client, transport } = setup(
      async () => ({ status: 200, body: { amount: '1' } }),
      recovery(),
      scope,
    )

    await client.read(okEndpoint)
    expect(transport.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/safe-fixture',
      headers: { Authorization: 'Bearer token-0' },
      signal: lease.signal,
      tokenGeneration: 0,
      authAttempt: 0,
    })
    expect(Object.keys(transport.request.mock.calls[0][0].headers)).toEqual(['Authorization'])
  })

  it.each([
    [{ code: 'demo_read_only', message: 'Demo account is read-only' }, 'demo-forbidden'],
    // The code decides, never the prose: an unlabelled or unknown 403 is a plain http error.
    [{ message: 'Demo account is read-only' }, 'http'],
    [{ code: 'household_owner_required', message: 'Only the household owner can manage the household.' }, 'http'],
    [{ code: 'anything', message: 'Forbidden' }, 'http'],
  ] as const)('maps 403 envelope %p to %s', async (body, expected) => {
    const { client } = setup(async () => ({ status: 403, body }))
    await expectCode(client.read(okEndpoint), expected, 403)
  })

  it('uses the coordinator shared refresh promise and replays each concurrent GET once', async () => {
    let resolveRefresh!: (value: ReturnType<typeof token>) => void
    const sharedRefresh = new Promise<ReturnType<typeof token>>((resolve) => { resolveRefresh = resolve })
    const authRecovery = recovery()
    authRecovery.refreshAfterUnauthorized.mockImplementation(() => sharedRefresh)
    const calls: HttpRequest[] = []
    const { client } = setup(async (request) => {
      calls.push(request)
      return request.authAttempt === 0
        ? { status: 401, body: { message: 'untrusted' } }
        : { status: 200, body: { amount: '7' } }
    }, authRecovery)

    const first = client.read(okEndpoint)
    const second = client.read(okEndpoint)
    await Promise.resolve()
    resolveRefresh(token('rotated', 1))

    await expect(Promise.all([first, second])).resolves.toEqual([7, 7])
    expect(authRecovery.refreshAfterUnauthorized).toHaveBeenCalledTimes(2)
    expect(calls.filter(({ authAttempt }) => authAttempt === 1)).toHaveLength(2)
    expect(calls.filter(({ authAttempt }) => authAttempt === 1)[0]).toMatchObject({
      headers: { Authorization: 'Bearer rotated' }, tokenGeneration: 1,
    })
  })

  it('replays HEAD once and parses undefined when the schema accepts it', async () => {
    const endpoint = readEndpoint({ method: 'HEAD', path: '/probe', schema: z.undefined() })
    const { client, transport } = setup(async (request) => (
      request.authAttempt === 0 ? { status: 401, body: 'ignored' } : { status: 204, body: 'ignored' }
    ))
    await expect(client.read(endpoint)).resolves.toBeUndefined()
    expect(transport.request).toHaveBeenCalledTimes(2)
  })

  it('does not loop after a replayed 401 and uses trusted recovery', async () => {
    const authRecovery = recovery()
    const { client, transport } = setup(async () => ({ status: 401, body: { message: 'mfa-required' } }), authRecovery)
    await expectCode(client.read(okEndpoint), 'auth-session', 401)
    expect(transport.request).toHaveBeenCalledTimes(2)
    expect(authRecovery.refreshAfterUnauthorized).toHaveBeenCalledTimes(1)
    expect(authRecovery.recoverTrustedUnauthorized).toHaveBeenCalledTimes(1)
  })

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)(
    'never replays unsafe %s and never commits after 401',
    async (method) => {
      const endpoint = writeEndpoint({ method, path: '/write', schema: z.object({ saved: z.boolean() }) })
      const commit = jest.fn()
      const { client, transport, authRecovery } = setup(async () => ({ status: 401, body: {} }))
      await expectCode(client.write(endpoint, { body: { value: 1 }, commit }), 'auth-session', 401)
      expect(transport.request).toHaveBeenCalledTimes(1)
      expect(authRecovery.refreshAfterUnauthorized).toHaveBeenCalledTimes(1)
      expect(authRecovery.recoverTrustedUnauthorized).toHaveBeenCalledTimes(1)
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it('parses a write before synchronously committing and passes the scope signal', async () => {
    const endpoint = writeEndpoint({
      method: 'POST',
      path: '/write',
      schema: z.object({ saved: z.literal('yes') }).transform(() => 'committed'),
    })
    const scope = createSessionOperationScope()
    const commit = jest.fn()
    const { client, transport } = setup(
      async () => ({ status: 201, body: { saved: 'yes' } }),
      recovery(),
      scope,
    )

    await expect(client.write(endpoint, { body: { input: true }, commit })).resolves.toBe('committed')
    expect(commit).toHaveBeenCalledWith('committed')
    expect(transport.request.mock.calls[0][0]).toMatchObject({
      method: 'POST', body: { input: true }, signal: scope.capture().signal,
    })
  })

  it('commits only an endpoint-declared success status', async () => {
    const endpoint = writeEndpoint({ method: 'POST', path: '/write', schema: z.undefined(), successStatuses: [201] })
    const commit201 = jest.fn()
    const accepted = setup(async () => ({ status: 201, body: undefined }))
    await expect(accepted.client.write(endpoint, { commit: commit201 })).resolves.toBeUndefined()
    expect(commit201).toHaveBeenCalledWith(undefined)

    const commit200 = jest.fn()
    const rejected = setup(async () => ({ status: 200, body: undefined }))
    await expectCode(rejected.client.write(endpoint, { commit: commit200 }), 'http', 200)
    expect(commit200).not.toHaveBeenCalled()
  })

  it('does not commit an invalid write response', async () => {
    const endpoint = writeEndpoint({ method: 'PUT', path: '/write', schema: z.object({ saved: z.boolean() }) })
    const commit = jest.fn()
    const { client } = setup(async () => ({ status: 200, body: { saved: 'private-invalid' } }))
    await expectCode(client.write(endpoint, { commit }), 'invalid-response')
    expect(commit).not.toHaveBeenCalled()
  })

  it('uses a coordinator-provided externally rotated snapshot without extra client behavior', async () => {
    const authRecovery = recovery()
    authRecovery.refreshAfterUnauthorized.mockResolvedValue(token('external-token', 9))
    const { client, transport } = setup(async (request) => request.authAttempt === 0
      ? { status: 401, body: undefined }
      : { status: 200, body: { amount: '9' } }, authRecovery)

    await expect(client.read(okEndpoint)).resolves.toBe(9)
    expect(authRecovery.getTokenSnapshot).toHaveBeenCalledTimes(1)
    expect(transport.request.mock.calls[1][0]).toMatchObject({
      headers: { Authorization: 'Bearer external-token' }, tokenGeneration: 9,
    })
  })

  it('sanitizes transport rejection as network while current', async () => {
    const { client } = setup(async () => { throw new Error('transport secret and URL /private') })
    const error = await client.read(okEndpoint).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'network', message: 'The network request failed.' })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain('transport secret')
  })

  it('prevents transport when the captured operation is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const scope = {
      capture: () => ({ generation: 0, signal: controller.signal }),
      isCurrent: () => false,
      invalidate: jest.fn(),
    }
    const { client, transport } = setup(async () => ({ status: 200, body: { amount: '1' } }), recovery(), scope)
    await expectCode(client.read(okEndpoint), 'cancelled')
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('marks an unsafe write cancelled before transport as pre-dispatch', async () => {
    const controller = new AbortController()
    controller.abort()
    const scope = {
      capture: () => ({ generation: 0, signal: controller.signal }),
      isCurrent: () => false,
      invalidate: jest.fn(),
    }
    const endpoint = writeEndpoint({ method: 'POST', path: '/write', schema: z.undefined() })
    const commit = jest.fn()
    const { client, transport } = setup(async () => ({ status: 201, body: undefined }), recovery(), scope)
    const error = await client.write(endpoint, { commit }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'cancelled', writeDispatchState: 'pre-dispatch' })
    expect(isPostDispatchCancellation(error)).toBe(false)
    expect(transport.request).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it.each(['resolution', 'rejection'] as const)(
    'maps ignored-abort late transport %s to cancelled',
    async (outcome) => {
      let settle!: () => void
      const pending = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        settle = () => outcome === 'resolution'
          ? resolve({ status: 200, body: { saved: true } })
          : reject(new Error('late secret'))
      })
      const endpoint = writeEndpoint({ method: 'POST', path: '/write', schema: z.object({ saved: z.boolean() }) })
      const commit = jest.fn()
      const { client, operationScope, transport } = setup(() => pending)
      const result = client.write(endpoint, { commit })
      await Promise.resolve()
      operationScope.invalidate()
      settle()
      const error = await result.catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'cancelled', writeDispatchState: 'post-dispatch' })
      expect(isPostDispatchCancellation(error)).toBe(true)
      expect(transport.request).toHaveBeenCalledTimes(1)
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it('cancellation during shared refresh prevents only that caller replay', async () => {
    let resolveRefresh!: (value: ReturnType<typeof token>) => void
    let markRefreshStarted!: () => void
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve })
    const authRecovery = recovery()
    authRecovery.refreshAfterUnauthorized.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve
      markRefreshStarted()
    }))
    const scope = createSessionOperationScope()
    const { client, transport } = setup(async (request) => request.authAttempt === 0
      ? { status: 401, body: undefined }
      : { status: 200, body: { amount: '1' } }, authRecovery, scope)

    const result = client.read(okEndpoint)
    const assertion = expectCode(result, 'cancelled')
    await refreshStarted
    scope.invalidate()
    resolveRefresh(token('rotated', 1))
    await assertion
    expect(transport.request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['auth-session', 'auth-session'],
    ['session-revoked', 'auth-session'],
    ['mfa-required', 'mfa-required'],
  ] as const)('maps trusted %s recovery and ignores an API MFA claim', async (trusted, expected) => {
    const authRecovery = recovery()
    authRecovery.refreshAfterUnauthorized.mockResolvedValue({ status: 'unavailable' })
    authRecovery.recoverTrustedUnauthorized.mockResolvedValue({ status: trusted })
    const { client } = setup(async () => ({
      status: 401,
      body: { code: 'mfa-required', message: 'MFA required' },
    }), authRecovery)
    await expectCode(client.read(okEndpoint), expected, 401)
  })

  it('parses 204 as undefined only when the endpoint explicitly accepts it', async () => {
    const endpoint = readEndpoint({ method: 'GET', path: '/empty', schema: z.undefined() })
    const { client } = setup(async () => ({ status: 204, body: { ignored: true } }))
    await expect(client.read(endpoint)).resolves.toBeUndefined()
  })

  describe('readRaw', () => {
    const csvEndpoint = { method: 'GET' as const, path: '/report.csv' }

    it('returns the raw response text unparsed, with no schema involved', async () => {
      const { client, transport } = setup(async () => ({ status: 200, body: 'month,net\n2026-08,500' }))
      await expect(client.readRaw(csvEndpoint)).resolves.toBe('month,net\n2026-08,500')
      expect(transport.request.mock.calls[0][0]).toMatchObject({ responseType: 'text' })
    })

    it('sends only client-owned bearer auth, same as read', async () => {
      const { client, transport } = setup(async () => ({ status: 200, body: 'a,b' }))
      await client.readRaw(csvEndpoint)
      expect(transport.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/report.csv',
        headers: { Authorization: 'Bearer token-0' },
        signal: expect.any(AbortSignal),
        tokenGeneration: 0,
        authAttempt: 0,
        responseType: 'text',
      })
    })

    it('refreshes once on 401 and replays with the rotated token', async () => {
      const authRecovery = recovery()
      const { client, transport } = setup(async (request) => (
        request.authAttempt === 0 ? { status: 401, body: 'ignored' } : { status: 200, body: 'csv-body' }
      ), authRecovery)

      await expect(client.readRaw(csvEndpoint)).resolves.toBe('csv-body')
      expect(transport.request).toHaveBeenCalledTimes(2)
      expect(authRecovery.refreshAfterUnauthorized).toHaveBeenCalledTimes(1)
      expect(transport.request.mock.calls[1][0]).toMatchObject({ headers: { Authorization: 'Bearer token-1' } })
    })

    it('does not loop after a replayed 401 and uses trusted recovery', async () => {
      const authRecovery = recovery()
      const { client, transport } = setup(async () => ({ status: 401, body: 'ignored' }), authRecovery)
      await expectCode(client.readRaw(csvEndpoint), 'auth-session', 401)
      expect(transport.request).toHaveBeenCalledTimes(2)
      expect(authRecovery.recoverTrustedUnauthorized).toHaveBeenCalledTimes(1)
    })

    it('maps a non-2xx response to an http error, matching read', async () => {
      const { client } = setup(async () => ({ status: 500, body: 'server error' }))
      await expectCode(client.readRaw(csvEndpoint), 'http', 500)
    })

    it('sanitizes a transport rejection as network', async () => {
      const { client } = setup(async () => { throw new Error('transport secret') })
      const error = await client.readRaw(csvEndpoint).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'network' })
      expect(JSON.stringify(error)).not.toContain('transport secret')
    })

    it('prevents transport when the captured operation is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const scope = {
        capture: () => ({ generation: 0, signal: controller.signal }),
        isCurrent: () => false,
        invalidate: jest.fn(),
      }
      const { client, transport } = setup(async () => ({ status: 200, body: 'csv' }), recovery(), scope)
      await expectCode(client.readRaw(csvEndpoint), 'cancelled')
      expect(transport.request).not.toHaveBeenCalled()
    })
  })
})
