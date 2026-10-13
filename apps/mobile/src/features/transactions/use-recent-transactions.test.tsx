import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useRecentTransactions } from './use-recent-transactions'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useRecentTransactions', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reads the dedicated endpoint once for a valid account id', async () => {
    const client = new QueryClient()
    const payload = { transactions: [{ entryType: 'persisted_transaction', occurredAt: null, displayName: 'X', amount: 1, currencyCode: 'EUR' }] }
    mockRead.mockResolvedValue(payload)
    const hook = await renderHook(() => useRecentTransactions(42), { wrapper: wrap(client) })
    await waitFor(() => expect(hook.result.current.data).toEqual(payload))
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/account/42/recent-transactions' }))
    await hook.unmount(); client.clear()
  })

  it('is disabled and never reads for an invalid account id', async () => {
    const client = new QueryClient()
    const hook = await renderHook(() => useRecentTransactions(null), { wrapper: wrap(client) })
    expect(hook.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('suppresses rows and routes MFA failures through access blocking', async () => {
    const client = new QueryClient()
    mockRead.mockRejectedValue(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useRecentTransactions(42), { wrapper: wrap(client) })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isAccessTransition).toBe(true)
    await hook.unmount(); client.clear()
  })
})
