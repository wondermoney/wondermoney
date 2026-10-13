import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { usePortfolioDividendIncome } from './use-portfolio-dividend-income'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 5, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const response = { byAsset: [{ financialAssetKey: 1, symbol: 'AAPL', totalDividends: 12.5 }], totalDividends: 12.5 }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePortfolioDividendIncome', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reads the scoped per-portfolio endpoint once a valid id is given', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioDividendIncome(9), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/portfolio/9/dividend-income' }))
    await hook.unmount(); client.clear()
  })

  it('never fetches for a null or invalid portfolio id', async () => {
    const { client, wrapper } = setup()
    const nullId = await renderHook(() => usePortfolioDividendIncome(null), { wrapper })
    const invalidId = await renderHook(() => usePortfolioDividendIncome(0), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    expect(nullId.result.current.data).toBeUndefined()
    expect(invalidId.result.current.data).toBeUndefined()
    await nullId.unmount(); await invalidId.unmount(); client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses data for %s and transitions access when required',
    async (code) => {
      mockRead.mockRejectedValue(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => usePortfolioDividendIncome(9), { wrapper })
      await waitFor(() => expect(hook.result.current.isFetched).toBe(true))
      expect(hook.result.current.data).toBeUndefined()
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount(); client.clear()
    },
  )

  it('reports a rate-limited failure distinctly', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 429))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioDividendIncome(9), { wrapper })
    await waitFor(() => expect(hook.result.current.isRateLimited).toBe(true))
    await hook.unmount(); client.clear()
  })
})
