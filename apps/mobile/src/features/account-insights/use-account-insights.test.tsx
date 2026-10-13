import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAccountInsights } from './use-account-insights'
import { useAccountMetrics } from './use-account-metrics'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 6, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))
const scope = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-20T00:00:00.000Z' }
const setup = () => { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> } }

describe('useAccountInsights', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })
  it('loads separately keyed conservative resources', async () => {
    mockRead.mockImplementation(async (endpoint) => endpoint.path.includes('category-spending') ? { categorySpending: [] } : endpoint.path.includes('cashflow') ? { cashflow: [] } : { metrics: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountInsights(scope), { wrapper })
    await waitFor(() => expect(hook.result.current.categories.data).toEqual({ categorySpending: [] }))
    expect(client.getQueryCache().findAll({ queryKey: ['account-insights', 6] })).toHaveLength(3)
    for (const query of client.getQueryCache().findAll({ queryKey: ['account-insights', 6] })) expect(query.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })
  it('retains stale data on ordinary explicit refresh failure', async () => {
    mockRead.mockImplementation(async (endpoint) => endpoint.path.includes('category-spending') ? { categorySpending: [] } : endpoint.path.includes('cashflow') ? { cashflow: [] } : { metrics: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountInsights(scope), { wrapper })
    await waitFor(() => expect(hook.result.current.metrics.data).toEqual({ metrics: [] }))
    mockRead.mockRejectedValue(new ApiError('network'))
    await act(async () => { await hook.result.current.metrics.refetch() })
    await waitFor(() => expect(hook.result.current.metrics.isRefreshFailure).toBe(true))
    expect(hook.result.current.metrics.data).toEqual({ metrics: [] })
    await hook.unmount(); client.clear()
  })
  it.each(['invalid-response', 'mfa-required'] as const)('suppresses %s responses', async (code) => {
    mockRead.mockRejectedValue(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountInsights(scope), { wrapper })
    await waitFor(() => expect(hook.result.current.metrics.isError).toBe(true))
    expect(hook.result.current.metrics.data).toBeUndefined()
    expect(mockBlockAccess.mock.calls.length).toBe(code === 'invalid-response' ? 0 : 3)
    await hook.unmount(); client.clear()
  })
  it('loads per-account metrics from fromDate through server-now without a toDate', async () => {
    mockRead.mockResolvedValue({ metrics: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountMetrics(42, scope.fromDate), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ metrics: [] }))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^\/v1\/account\/42\/metrics\?fromDate=/) }))
    expect(mockRead.mock.calls[0]?.[0].path).not.toContain('toDate')
    await hook.unmount(); client.clear()
  })
})
