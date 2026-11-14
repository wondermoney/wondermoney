import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useTransactionReviewSummary } from './use-transaction-review-summary'

const mockRead = jest.fn()
let mockEpochId = 9
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: mockEpochId, apiClient: { read: mockRead } }, blockAccess: jest.fn() }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useTransactionReviewSummary', () => {
  beforeEach(() => { mockRead.mockReset(); mockEpochId = 9 })

  it('reads the summary and caches it under the current epoch', async () => {
    mockRead.mockResolvedValue({ count: 3, currency: 'EUR', totalAbs: 1240 })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionReviewSummary(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ count: 3, currency: 'EUR', totalAbs: 1240 }))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/account/transaction/review-summary' }))
    expect(client.getQueryCache().findAll({ queryKey: ['transactions', 9, 'review-summary'] })).toHaveLength(1)
    await hook.unmount()
    client.clear()
  })
})
