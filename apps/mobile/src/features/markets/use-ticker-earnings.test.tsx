import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useTickerEarnings } from './use-ticker-earnings'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const response = {
  earnings: [
    { date: '2025-07-31', eps: 1.64, epsEstimated: 1.6, revenue: 94_036_000_000, revenueEstimated: 89_500_000_000 },
  ],
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
  symbol: 'AAPL',
}

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useTickerEarnings', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('loads through the exact endpoint and isolated key, cached for the API\'s 3-day window', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerEarnings('AAPL'), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/earnings' }))
    expect(client.getQueryData(['markets', 7, 'earnings', 'AAPL'])).toEqual(response)
    expect(client.getQueryCache().find({ queryKey: ['markets', 7, 'earnings', 'AAPL'] })?.options).toMatchObject({
      staleTime: 3 * 24 * 60 * 60 * 1000,
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    await hook.unmount(); client.clear()
  })

  it('never dispatches a request for an invalid symbol', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerEarnings(null), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('suppresses data and blocks access on an MFA error', async () => {
    mockRead.mockRejectedValue(new ApiError('mfa-required'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerEarnings('AAPL'), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount(); client.clear()
  })

  it('surfaces the pending-tier 404 as a plain query error, not a crash', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerEarnings('AAPL'), { wrapper })
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount(); client.clear()
  })
})
