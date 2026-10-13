import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useTransactions } from './use-transactions'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 9
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpochId, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))
const setup = () => { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> } }

describe('useTransactions', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpochId = 9 })
  it('uses filter/account-aware reads and caches under the current epoch', async () => {
    mockRead.mockResolvedValue({ transactions: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactions({ needsReview: true }, 7), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ transactions: [] }))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/account/7/transaction?unreviewedOnly=true&accountId=7' }))
    expect(client.getQueryCache().findAll({ queryKey: ['transactions', 9] })).toHaveLength(1)
    await hook.unmount(); client.clear()
  })
  it.each(['invalid-response', 'mfa-required'] as const)('suppresses invalid/access data for %s', async (code) => {
    mockRead.mockRejectedValue(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactions({}), { wrapper })
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
    expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
    await hook.unmount(); client.clear()
  })
  it('does not request an invalid account id', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactions({}, 0), { wrapper })
    expect(hook.result.current.isInvalidAccountId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })
})
