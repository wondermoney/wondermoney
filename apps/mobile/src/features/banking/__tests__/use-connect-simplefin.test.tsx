import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifySimplefinConnectFailure, useConnectSimplefin } from '../use-connect-simplefin'

/** A synthetic setup token: base64 of a made-up claim URL, built here so no token-shaped literal is committed. */
const SETUP_TOKEN = Buffer.from('https://bridge.simplefin.org/claim/demo').toString('base64')

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useConnectSimplefin', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('posts the trimmed setup token to the SimpleFIN route and invalidates connections and accounts', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => {
      const value = { connectionId: 3, incidentId: null }
      options.commit(value)
      return value
    })
    const hook = await renderHook(() => useConnectSimplefin(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(`  ${SETUP_TOKEN}  `) })

    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/banking/simplefin/connections' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ setupToken: SETUP_TOKEN })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['banking', 8, 'connections'], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 8] })
    await hook.unmount(); client.clear()
  })

  it('keeps the endpoint opted in to the API wording of its 400s', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockResolvedValue({ connectionId: 3, incidentId: 'inc-1' })
    const hook = await renderHook(() => useConnectSimplefin(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('token') })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ keepsBadRequestMessage: true })
    await hook.unmount(); client.clear()
  })

  it('sends nothing for a blank token', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useConnectSimplefin(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('   ')).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useConnectSimplefin(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('token')).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

describe('classifySimplefinConnectFailure', () => {
  it('keeps the server message of a 400, and reads a 400 without one as a plain rejection', () => {
    expect(classifySimplefinConnectFailure(new ApiError('http', 400, { serverMessage: 'This setup token was already used.' })))
      .toEqual({ reason: 'rejected', serverMessage: 'This setup token was already used.' })
    expect(classifySimplefinConnectFailure(new ApiError('http', 400))).toEqual({ reason: 'rejected', serverMessage: null })
  })

  it.each([
    ['simplefin_token_invalid', 'token-invalid'],
    ['simplefin_token_already_claimed', 'token-already-claimed'],
    ['simplefin_server_not_allowed', 'server-not-allowed'],
  ] as const)('reads the 400 code %s as %s, in the app\'s own words rather than the server message', (serverCode, reason) => {
    expect(classifySimplefinConnectFailure(new ApiError('http', 400, { serverCode, serverMessage: 'English text' })))
      .toEqual({ reason, serverMessage: null })
  })

  it('falls back to the server message for a 400 with any other code', () => {
    expect(classifySimplefinConnectFailure(new ApiError('http', 400, { serverCode: 'bad_request', serverMessage: 'Something specific.' })))
      .toEqual({ reason: 'rejected', serverMessage: 'Something specific.' })
  })

  it('never carries a server message for any other failure', () => {
    expect(classifySimplefinConnectFailure(new ApiError('http', 502, { serverMessage: 'Upstream detail' }))).toEqual({ reason: 'unreachable', serverMessage: null })
  })

  it.each([
    [new ApiError('http', 501), 'disabled'],
    [new ApiError('http', 502), 'unreachable'],
    [new ApiError('http', 429), 'rate-limited'],
    [new ApiError('demo-forbidden', 403), 'demo'],
    [new ApiError('mfa-required', 401), 'mfa'],
    [new ApiError('auth-session', 401), 'access'],
    [new ApiError('http', 403), 'access'],
    [new ApiError('network'), 'network'],
    [new ApiError('cancelled'), 'network'],
    [new ApiError('http', 500), 'general'],
    [new ApiError('invalid-response'), 'general'],
    [new Error('boom'), 'general'],
  ] as const)('classifies %p as %s', (error, reason) => {
    expect(classifySimplefinConnectFailure(error).reason).toBe(reason)
  })
})
