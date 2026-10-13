import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { profileKey } from './query-keys'
import { classifyProfileUpdateFailure, useUpdateProfile } from './use-update-profile'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, principalId: 'user-1', apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useUpdateProfile', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('PATCHes the principal route once and invalidates the epoch profile on success', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue()
    mockWrite.mockImplementation(async (endpoint, options) => {
      expect(endpoint.path).toBe('/v1/user/user-1')
      options.commit(undefined)
      return undefined
    })
    const hook = await renderHook(() => useUpdateProfile(), { wrapper: wrap(client) })
    await act(async () => { await hook.result.current.mutateAsync({ firstName: 'Ada' }) })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/user/user-1' }),
      expect.objectContaining({ body: { firstName: 'Ada' }, commit: expect.any(Function) }),
    )
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: profileKey(4), exact: true }))
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid payload before dispatching', async () => {
    const client = new QueryClient()
    const hook = await renderHook(() => useUpdateProfile(), { wrapper: wrap(client) })
    await act(async () => { await expect(hook.result.current.mutateAsync({} as never)).rejects.toBeInstanceOf(Error) })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks a concurrent update and routes MFA failures through access blocking', async () => {
    const client = new QueryClient()
    let reject!: (error: unknown) => void
    mockWrite.mockImplementation(() => new Promise((_resolve, rejectWrite) => { reject = rejectWrite }))
    const hook = await renderHook(() => useUpdateProfile(), { wrapper: wrap(client) })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync({ firstName: 'Ada' }) })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync({ firstName: 'Grace' })).rejects.toThrow('already pending') })
    await act(async () => { reject(new ApiError('mfa-required', 401)); await expect(first).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies failures conservatively', () => {
    expect(classifyProfileUpdateFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyProfileUpdateFailure(new ApiError('http', 400))).toBe('validation')
    expect(classifyProfileUpdateFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyProfileUpdateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyProfileUpdateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
  })
})
