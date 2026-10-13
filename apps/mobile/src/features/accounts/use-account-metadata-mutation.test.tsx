import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyAccountWriteFailure, useAccountMetadataMutation } from './use-account-metadata-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useAccountMetadataMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes only the changed fields and invalidates the accounts list and detail after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useAccountMetadataMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ accountId: 12, value: { accountName: 'Everyday', isPrivate: true } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/account/12' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ accountName: 'Everyday', isPrivate: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8, 12], exact: true })
    await hook.unmount(); client.clear()
  })

  it('omits isPrivate entirely when the caller does not include it', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useAccountMetadataMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ accountId: 12, value: { accountName: 'Everyday' } }) })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ accountName: 'Everyday' })
    await hook.unmount(); client.clear()
  })

  it('locks pending and does not invalidate without commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useAccountMetadataMutation(), { wrapper })
    await act(() => { hook.result.current.mutate({ accountId: 12, value: { accountName: 'Everyday' } }) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('does not retry ambiguous failures and transitions classified access', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const hook = await renderHook(() => useAccountMetadataMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ accountId: 12, value: { accountName: 'Everyday' } })).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required'))
    await act(async () => { await expect(hook.result.current.mutateAsync({ accountId: 12, value: { accountName: 'Everyday' } })).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures and defaults unknown errors to general', () => {
    expect(classifyAccountWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyAccountWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyAccountWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyAccountWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyAccountWriteFailure(new ApiError('invalid-response'))).toBe('invalid')
    expect(classifyAccountWriteFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyAccountWriteFailure(new Error('boom'))).toBe('general')
  })
})
