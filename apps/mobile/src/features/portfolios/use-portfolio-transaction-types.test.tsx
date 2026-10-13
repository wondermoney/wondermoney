import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { usePortfolioTransactionTypes } from './use-portfolio-transaction-types'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const response = { transactionTypes: [{ financialTransactionTypeKey: 1, name: 'BUY' }, { financialTransactionTypeKey: 2, name: 'SELL' }, { financialTransactionTypeKey: 3, name: 'DIVIDEND' }] }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePortfolioTransactionTypes', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('loads the full transaction-type list from the fixed endpoint', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioTransactionTypes(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/portfolio/transaction-types' }))
    await hook.unmount(); client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses data for %s and transitions access when required',
    async (code) => {
      mockRead.mockRejectedValue(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => usePortfolioTransactionTypes(), { wrapper })
      await waitFor(() => expect(hook.result.current.isFetched).toBe(true))
      expect(hook.result.current.data).toBeUndefined()
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount(); client.clear()
    },
  )
})
