import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyDeleteAccountFailure, useDeleteAccount } from './use-delete-account'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 5, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useDeleteAccount', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('issues a single guarded DELETE without retry on success', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    mockWrite.mockImplementation(async (endpoint, options) => {
      expect(endpoint.method).toBe('DELETE')
      expect(endpoint.path).toBe('/v1/user/me')
      expect(endpoint.schema.parse(undefined)).toBeUndefined()
      options.commit(undefined)
      return undefined
    })
    const hook = await renderHook(() => useDeleteAccount(), { wrapper: wrap(client) })
    await act(async () => { await hook.result.current.mutateAsync() })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE', path: '/v1/user/me' }),
      expect.objectContaining({ commit: expect.any(Function) }),
    )
    await hook.unmount(); client.clear()
  })

  it('blocks repeated taps and permanently gates an ambiguous outcome', async () => {
    const client = new QueryClient()
    let reject!: (error: unknown) => void
    mockWrite.mockImplementation(() => new Promise((_resolve, rejectWrite) => { reject = rejectWrite }))
    const hook = await renderHook(() => useDeleteAccount(), { wrapper: wrap(client) })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync() })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync()).rejects.toThrow('already been requested') })
    // A post-dispatch/network failure is ambiguous: the latch stays closed so a second
    // deletion call can never be issued.
    await act(async () => { reject(new ApiError('network')); await expect(first).rejects.toMatchObject({ code: 'network' }) })
    await act(async () => { await expect(hook.result.current.mutateAsync()).rejects.toThrow('already been requested') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('re-enables deletion after a definitive intact-account failure', async () => {
    const client = new QueryClient()
    mockWrite
      .mockRejectedValueOnce(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))
      .mockImplementationOnce(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useDeleteAccount(), { wrapper: wrap(client) })
    await act(async () => { await expect(hook.result.current.mutateAsync()).rejects.toMatchObject({ code: 'cancelled' }) })
    await act(async () => { await expect(hook.result.current.mutateAsync()).resolves.toBeUndefined() })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })

  it('routes MFA failures through access blocking', async () => {
    const client = new QueryClient()
    mockWrite.mockRejectedValue(new ApiError('mfa-required', 401))
    const hook = await renderHook(() => useDeleteAccount(), { wrapper: wrap(client) })
    await act(async () => { await expect(hook.result.current.mutateAsync()).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies uncertainty conservatively and server restrictions as definitive', () => {
    expect(classifyDeleteAccountFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyDeleteAccountFailure(new ApiError('invalid-response'))).toBe('unknown')
    expect(classifyDeleteAccountFailure(new ApiError('http', 500))).toBe('unknown')
    expect(classifyDeleteAccountFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyDeleteAccountFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyDeleteAccountFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyDeleteAccountFailure(new ApiError('auth-session', 401))).toBe('access')
    expect(classifyDeleteAccountFailure(new ApiError('http', 401))).toBe('access')
    expect(classifyDeleteAccountFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyDeleteAccountFailure(new Error('boom'))).toBe('unknown')
  })
})
