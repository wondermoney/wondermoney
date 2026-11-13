import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyAccountSharingFailure, useAccountShares, useAccountSharesMutation } from './use-account-shares'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const shares = {
  accountKey: 12,
  isPrivate: true,
  canManage: true,
  members: [
    { appuserKey: 3, firstName: 'Ana', lastName: null, role: 'owner', isAccountOwner: true, share: null, access: 'owner' },
    { appuserKey: 4, firstName: 'Rui', lastName: null, role: 'member', isAccountOwner: false, share: 'read', access: 'read' },
  ],
}

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('account shares', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('reads the account\'s sharing', async () => {
    const { client, wrapper } = setup()
    mockRead.mockResolvedValue(shares)
    const hook = await renderHook(() => useAccountShares(12), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(shares))
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/account/12/shares' })
    expect(hook.result.current.isUnsupported).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('reads a 404 as an older server without the route', async () => {
    const { client, wrapper } = setup()
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const hook = await renderHook(() => useAccountShares(12), { wrapper })
    await waitFor(() => expect(hook.result.current.isUnsupported).toBe(true))
    await hook.unmount(); client.clear()
  })

  it('does not read without a valid account', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountShares(null), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('puts the body, keeps the answer as the sharing and reads the accounts again', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    // The test client uses gcTime 0, so an unobserved cache entry can be collected before it is
    // read back; assert the write itself instead of reading the cache.
    const setData = jest.spyOn(client, 'setQueryData')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(shares); return shares })
    const hook = await renderHook(() => useAccountSharesMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ accountId: 12, value: { isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] } }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PUT', path: '/v1/account/12/shares' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] })
    expect(setData).toHaveBeenCalledWith(['account', 8, 12, 'shares'], shares)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8, 12], exact: true })
    await hook.unmount(); client.clear()
  })

  it('refuses a malformed body before sending it', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountSharesMutation(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.mutateAsync({ accountId: 12, value: { isPrivate: true, shares: [{ appuserKey: 4, access: 'hidden' as never }] } })).rejects.toBeTruthy()
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('classifies the sharing refusals', () => {
    expect(classifyAccountSharingFailure(new ApiError('account-share-manager-required', 403))).toBe('manager-required')
    expect(classifyAccountSharingFailure(new ApiError('account-read-only', 403))).toBe('account-read-only')
    expect(classifyAccountSharingFailure(new ApiError('household-read-only', 403))).toBe('read-only')
    expect(classifyAccountSharingFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyAccountSharingFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyAccountSharingFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyAccountSharingFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyAccountSharingFailure(new Error('boom'))).toBe('general')
  })
})
