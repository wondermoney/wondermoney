import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { budgetFixture } from './test-fixtures'
import { useBudgetMonth } from './use-budget-month'
import { useBudgets } from './use-budgets'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 5
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: mockEpochId, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('budget query hooks', () => {
  beforeEach(() => { mockEpochId = 5; mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('loads the full list in an epoch key and never writes', async () => {
    const value = { budgets: [budgetFixture] }
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgets(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/budget/full' }))
    expect(client.getQueryData(['budgets', 'list', 5])).toEqual(value)
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('makes no request for an invalid month route', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetMonth(7, 2026, 13), { wrapper })
    expect(hook.result.current.isInvalidRoute).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('uses the exact detail route and classifies 404', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetMonth(7, 2026, 12), { wrapper })
    await waitFor(() => expect(hook.result.current.isNotFound).toBe(true))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/budget/7/2026/12' }))
    expect(client.getQueryCache().find({ queryKey: ['budgets', 'month', 5, 7, 2026, 12] })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })

  it('keeps valid stale data for a network refresh failure', async () => {
    const value = { budget: budgetFixture, hasNextMonth: false, hasPreviousMonth: true }
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetMonth(7, 2026, 7), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(value)
    await hook.unmount(); client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)('suppresses cached values for %s and blocks access when required', async (code) => {
    const value = { budgets: [budgetFixture] }
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgets(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
    await hook.unmount(); client.clear()
  })
})
