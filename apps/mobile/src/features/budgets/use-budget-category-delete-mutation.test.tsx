import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyBudgetCategoryDeleteFailure, useBudgetCategoryDeleteMutation } from './use-budget-category-delete-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBudgetCategoryDeleteMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('deletes a single month via the month-scoped endpoint', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetCategoryDeleteMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, categoryId: 11, scope: 'month', year: 2026, month: 4 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/budget/7/2026/4/11' })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'month', 8, 7, 2026, 4] } as never)).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('removes going forward via the template-scoped endpoint, never full history', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetCategoryDeleteMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, categoryId: 11, scope: 'forward', year: 2026, month: 4 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/budget/7/category/11?deletePreviousMonths=false' })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid draft before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetCategoryDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 0, categoryId: 11, scope: 'month', year: 2026, month: 4 })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useBudgetCategoryDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, categoryId: 11, scope: 'month', year: 2026, month: 4 })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies failures', () => {
    expect(classifyBudgetCategoryDeleteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBudgetCategoryDeleteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyBudgetCategoryDeleteFailure(new Error('boom'))).toBe('general')
  })
})
