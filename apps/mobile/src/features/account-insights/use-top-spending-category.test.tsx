import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useTopSpendingCategory } from './use-top-spending-category'

const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 6, apiClient: { read: mockRead } }, blockAccess: jest.fn() }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useTopSpendingCategory', () => {
  beforeEach(() => mockRead.mockReset())

  it('requests exactly the top-1 category for a month-to-date scope, not the full metrics/cashflow bundle', async () => {
    mockRead.mockResolvedValue({ categorySpending: [{ categoryKey: 1, name: 'Groceries', amount: 420, currency: 'EUR', numTransactions: 12 }] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTopSpendingCategory(new Date('2026-08-15T00:00:00.000Z')), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls[0]?.[0].path).toMatch(/^\/v1\/account\/transaction\/category-spending\?fromDate=\d+&toDate=\d+&limit=1$/)
    await hook.unmount(); client.clear()
  })

  it('returns undefined data (not an error) when nothing was spent this period', async () => {
    mockRead.mockResolvedValue({ categorySpending: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTopSpendingCategory(new Date('2026-08-15T00:00:00.000Z')), { wrapper })
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.data).toEqual({ categorySpending: [] })
    expect(hook.result.current.isError).toBe(false)
    await hook.unmount(); client.clear()
  })
})
