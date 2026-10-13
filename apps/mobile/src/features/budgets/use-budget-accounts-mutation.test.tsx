import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyBudgetAccountsWriteFailure, useBudgetAccountsMutation } from './use-budget-accounts-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('budget accounts write', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the full account-key set and invalidates every current-epoch budget query after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetAccountsMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, value: { accountKeys: [9, 10] } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/budget/7/accounts' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ accountKeys: [9, 10] })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'accounts', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'month', 8, 7, 2026, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'accounts', 9, 7] } as never)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid budget id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetAccountsMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 0, value: { accountKeys: [9] } })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('locks pending and does not invalidate without commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useBudgetAccountsMutation(), { wrapper })
    await act(() => { hook.result.current.mutate({ budgetId: 7, value: { accountKeys: [9] } }) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useBudgetAccountsMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, value: { accountKeys: [9] } })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures', () => {
    expect(classifyBudgetAccountsWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyBudgetAccountsWriteFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyBudgetAccountsWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBudgetAccountsWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyBudgetAccountsWriteFailure(new Error('boom'))).toBe('general')
  })
})
