import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBudgetYear, useBudgetYearToDate } from './use-budget-year'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 6
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBudgetYear', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpoch = 6 })

  it('loads the full year with an epoch-isolated conservative GET', async () => {
    const { client, wrapper } = setup()
    mockRead.mockResolvedValue({ budget: { budgetKey: 7, name: 'Plan', year: 2026 } })
    const hook = await renderHook(() => useBudgetYear(7, 2026), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.budget.name).toBe('Plan'))
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/budget/7/2026' })
    expect(client.getQueryCache().find({ queryKey: ['budgets', 'year', 6, 7, 2026] })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })

  it('does not request an invalid budget id or year', async () => {
    const { client, wrapper } = setup()
    const invalid = await renderHook(() => useBudgetYear(null, 2026), { wrapper })
    expect(invalid.result.current.isInvalidRoute).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await invalid.unmount(); client.clear()
  })

  it('classifies not-found and access transitions', async () => {
    const { client, wrapper } = setup()
    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const missing = await renderHook(() => useBudgetYear(7, 2026), { wrapper })
    await waitFor(() => expect(missing.result.current.isNotFound).toBe(true))
    await missing.unmount(); client.clear()
  })
})

describe('useBudgetYearToDate', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpoch = 6 })

  it('loads year-to-date with an epoch-isolated conservative GET', async () => {
    const { client, wrapper } = setup()
    mockRead.mockResolvedValue({ budget: { budgetKey: 7, name: 'Plan', year: 2026 } })
    const hook = await renderHook(() => useBudgetYearToDate(7, 2026, 4), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.budget.name).toBe('Plan'))
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/budget/7/2026/until/4' })
    expect(client.getQueryCache().find({ queryKey: ['budgets', 'year-to-date', 6, 7, 2026, 4] })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })

  it('does not request an invalid budget id, year, or month', async () => {
    const { client, wrapper } = setup()
    const invalid = await renderHook(() => useBudgetYearToDate(7, 2026, 13), { wrapper })
    expect(invalid.result.current.isInvalidRoute).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await invalid.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required'))
    const access = await renderHook(() => useBudgetYearToDate(7, 2026, 4), { wrapper })
    await waitFor(() => expect(access.result.current.isAccessTransition).toBe(true))
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await access.unmount(); client.clear()
  })
})
