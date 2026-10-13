import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyAddBudgetCategoryFailure, useAddBudgetCategory } from './use-add-budget-category'
import { classifyCreateBudgetFailure, useCreateBudget } from './use-create-budget'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))
const setup = () => { const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> } }

describe('guarded budget creation mutations', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })
  it('freezes and writes the monthly-equivalent create payload once without retry', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (endpoint, options) => { expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/budget' }); expect(Object.isFrozen(options.body)).toBe(true); expect(Object.isFrozen(options.body.incomes)).toBe(true); options.commit({ budgetKey: 9 }); return { budgetKey: 9 } })
    const hook = await renderHook(() => useCreateBudget(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ houseHoldSize: 2, dependentsNum: 0, incomes: [{ name: 'Salary', amount: 1200, isRecurrent: true, recurrency: 'MONTHLY' }] }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(client.getMutationCache().getAll()[0].options.retry).toBe(false)
    await hook.unmount(); client.clear()
  })
  it('classifies cancellation, network, invalid response, and 5xx as unknown with no retry path', () => {
    expect(classifyCreateBudgetFailure(new ApiError('cancelled'))).toBe('unknown')
    expect(classifyCreateBudgetFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyCreateBudgetFailure(new ApiError('invalid-response'))).toBe('unknown')
    expect(classifyCreateBudgetFailure(new ApiError('http', 503))).toBe('unknown')
    expect(classifyCreateBudgetFailure(new ApiError('demo-forbidden'))).toBe('demo')
  })
  it('adds an existing category pessimistically and excludes catalog invalidation', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (endpoint, options) => { expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/budget/7/category' }); options.commit(undefined) })
    const hook = await renderHook(() => useAddBudgetCategory(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, value: { categoryKey: 12, amountBudgeted: 80, recurrency: 'MONTHLY' } }) })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'list', 8] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'month', 8, 7, 2026, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'inventory', 8] } as never)).toBe(false)
    expect(predicate?.({ queryKey: ['categories', 'read', 8] } as never)).toBe(false)
    expect(classifyAddBudgetCategoryFailure(new ApiError('http', 400))).toBe('duplicate')
    expect(classifyAddBudgetCategoryFailure(new ApiError('cancelled'))).toBe('unknown')
    expect(classifyAddBudgetCategoryFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyAddBudgetCategoryFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyAddBudgetCategoryFailure(new ApiError('mfa-required'))).toBe('access')
    await hook.unmount(); client.clear()
  })
})
