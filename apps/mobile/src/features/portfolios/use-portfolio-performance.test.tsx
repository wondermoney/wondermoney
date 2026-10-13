import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { usePortfolioPerformance } from './use-portfolio-performance'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const response = { dataPoints: [{ date: '2026-07-01', value: 1000 }], minDataPointsForComparison: 2, period: 'YTD' }

describe('usePortfolioPerformance', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('requests the individual portfolio performance path for the given period', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioPerformance(7, '1Y'), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/portfolio/7/performance?period=1Y')
    await hook.unmount(); client.clear()
  })

  it('never dispatches a request for an invalid portfolio id', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioPerformance(null, 'YTD'), { wrapper })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('re-fetches when the period changes, using a distinct cache entry', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(({ period }: { period: '1M' | 'YTD' }) => usePortfolioPerformance(7, period), { wrapper, initialProps: { period: 'YTD' } })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledTimes(1)
    await hook.rerender({ period: '1M' })
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    expect(mockRead.mock.calls[1]?.[0].path).toBe('/v1/portfolio/7/performance?period=1M')
    await hook.unmount(); client.clear()
  })

  it('suppresses data and reports an access transition on MFA errors', async () => {
    mockRead.mockRejectedValue(new ApiError('mfa-required'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioPerformance(7, 'YTD'), { wrapper })
    await waitFor(() => expect(hook.result.current.isAccessTransition).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})
