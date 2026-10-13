import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { usePortfolioActivity } from './use-portfolio-activity'
import { usePortfolioAnalytics } from './use-portfolio-analytics'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const activity = { transactions: [] }
const allocation = { byType: [], byAssetClass: [], unclassifiedHoldings: [] }
const dividends = { byAsset: [], totalDividends: 0 }
const metrics = { metrics: { annualYield: null, assetAllocation: {}, currentValue: 0, maxDrawdown: null, readiness: { allocation: { status: 'ready' }, holdings: { status: 'ready' }, performance: { status: 'empty' }, riskMetrics: { status: 'insufficient_history' } }, riskLevel: null, sharpeRatio: null, totalReturn: 0, volatility: null } }

describe('portfolio activity and analytics queries', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('makes one route-driven activity request and disables all automatic refetch behavior', async () => {
    mockRead.mockResolvedValue(activity)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioActivity('aggregate', {}), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(activity))
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/portfolio/transactions?limit=50')
    expect(client.getQueryCache().getAll()[0]?.options).toMatchObject({ retry: false, refetchInterval: false, refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity })
    await act(async () => { hook.rerender({}) })
    expect(mockRead).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports 429 without cache and retains cached activity after a manual refresh 429', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('http', 429))
    const initial = setup()
    const noCache = await renderHook(() => usePortfolioActivity(3, {}), { wrapper: initial.wrapper })
    await waitFor(() => expect(noCache.result.current.isRateLimited).toBe(true))
    expect(noCache.result.current.data).toBeUndefined()
    await noCache.unmount(); initial.client.clear()

    mockRead.mockReset().mockResolvedValueOnce(activity).mockRejectedValueOnce(new ApiError('http', 429))
    const cachedSetup = setup()
    const cached = await renderHook(() => usePortfolioActivity(3, {}), { wrapper: cachedSetup.wrapper })
    await waitFor(() => expect(cached.result.current.data).toEqual(activity))
    await act(async () => { await cached.result.current.refetch() })
    expect(cached.result.current.data).toEqual(activity)
    await waitFor(() => expect(cached.result.current.isRateLimited).toBe(true))
    expect(cached.result.current.isRefreshFailure).toBe(true)
    await cached.unmount(); cachedSetup.client.clear()
  })

  it('blocks access once when rerendering with the same access error', async () => {
    const error = new ApiError('mfa-required')
    mockRead.mockRejectedValue(error)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioActivity(3, {}), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    await act(async () => { hook.rerender({}) })
    await act(async () => { hook.rerender({}) })
    expect(mockBlockAccess).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('keeps analytics dormant until enabled, then makes exactly the three approved reads', async () => {
    mockRead.mockImplementation((endpoint) => Promise.resolve(endpoint.path.endsWith('/allocation') ? allocation : endpoint.path.endsWith('/dividend-income') ? dividends : metrics))
    const { client, wrapper } = setup()
    const hook = await renderHook((props: { enabled: boolean }) => usePortfolioAnalytics(props.enabled), { initialProps: { enabled: false }, wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await act(async () => { hook.rerender({ enabled: true }) })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path).sort()).toEqual(['/v1/portfolio/allocation', '/v1/portfolio/dividend-income', '/v1/portfolio/metrics'])
    await act(async () => { hook.rerender({ enabled: true }) })
    expect(mockRead).toHaveBeenCalledTimes(3)
    for (const query of client.getQueryCache().getAll()) expect(query.options).toMatchObject({ retry: false, refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity })
    await hook.unmount(); client.clear()
  })

  it('retains complete analytics cache and exposes 429 after manual retry', async () => {
    mockRead.mockImplementation((endpoint) => Promise.resolve(endpoint.path.endsWith('/allocation') ? allocation : endpoint.path.endsWith('/dividend-income') ? dividends : metrics))
    const analyticsSetup = setup()
    const { wrapper } = analyticsSetup
    const hook = await renderHook(() => usePortfolioAnalytics(true), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    mockRead.mockImplementation((endpoint) => endpoint.path.endsWith('/allocation') ? Promise.reject(new ApiError('http', 429)) : Promise.resolve(endpoint.path.endsWith('/dividend-income') ? dividends : metrics))
    await act(async () => { await hook.result.current.refetch() })
    expect(hook.result.current.data).toBeDefined()
    await waitFor(() => expect(hook.result.current.isRateLimited).toBe(true))
    expect(hook.result.current.isRefreshFailure).toBe(true)
    await hook.unmount(); analyticsSetup.client.clear()
  })

  it('reports an initial analytics 429 without partial data or retries', async () => {
    mockRead.mockImplementation((endpoint) => endpoint.path.endsWith('/allocation') ? Promise.reject(new ApiError('http', 429)) : Promise.resolve(endpoint.path.endsWith('/dividend-income') ? dividends : metrics))
    const analyticsSetup = setup()
    const hook = await renderHook(() => usePortfolioAnalytics(true), { wrapper: analyticsSetup.wrapper })
    await waitFor(() => expect(hook.result.current.isRateLimited).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(mockRead).toHaveBeenCalledTimes(3)
    await hook.unmount(); analyticsSetup.client.clear()
  })
})
