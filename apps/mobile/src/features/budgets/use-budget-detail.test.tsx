import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBudgetDetail } from './use-budget-detail'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 6
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBudgetDetail', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpoch = 6 })

  it('loads authoritative metadata with an epoch-isolated conservative GET', async () => {
    const { client, wrapper } = setup()
    mockRead.mockResolvedValue({ budget: { budgetKey: 7, name: 'Plan', description: null } })
    const hook = await renderHook(() => useBudgetDetail(7), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.budget.name).toBe('Plan'))
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/budget/7' })
    expect(client.getQueryCache().find({ queryKey: ['budgets', 'detail', 6, 7] })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })

  it('does not request invalid ids and classifies 404, invalid response, stale data, and access', async () => {
    const { client, wrapper } = setup()
    const invalid = await renderHook(() => useBudgetDetail(null), { wrapper })
    expect(invalid.result.current.isInvalidRoute).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await invalid.unmount()

    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const missing = await renderHook(() => useBudgetDetail(7), { wrapper })
    await waitFor(() => expect(missing.result.current.isNotFound).toBe(true))
    await missing.unmount(); client.clear()

    const next = setup()
    mockRead.mockResolvedValueOnce({ budget: { budgetKey: 7, name: 'Plan' } }).mockRejectedValueOnce(new ApiError('network'))
    const stale = await renderHook(() => useBudgetDetail(7), { wrapper: next.wrapper })
    await waitFor(() => expect(stale.result.current.data).toBeDefined())
    await stale.result.current.refetch()
    await waitFor(() => expect(stale.result.current.isRefreshFailure).toBe(true))
    expect(stale.result.current.data?.budget.name).toBe('Plan')
    await stale.unmount(); next.client.clear()

    const accessSetup = setup()
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    const access = await renderHook(() => useBudgetDetail(7), { wrapper: accessSetup.wrapper })
    await waitFor(() => expect(access.result.current.isAccessTransition).toBe(true))
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await access.unmount(); accessSetup.client.clear()
  })
})
