import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyBudgetDeleteFailure, useBudgetDeleteMutation } from './use-budget-delete-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBudgetDeleteMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('deletes with no body and invalidates every current-epoch budget query after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetDeleteMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(7) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/budget/7' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'list', 8] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 9, 7] } as never)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid budget id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBudgetDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(0)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useBudgetDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(7)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures and defaults unknown errors to general', () => {
    expect(classifyBudgetDeleteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyBudgetDeleteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyBudgetDeleteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyBudgetDeleteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBudgetDeleteFailure(new ApiError('invalid-response'))).toBe('invalid')
    expect(classifyBudgetDeleteFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyBudgetDeleteFailure(new Error('boom'))).toBe('general')
  })
})
