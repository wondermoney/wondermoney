import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyRepaymentWriteFailure, isRepaymentDerivedQueryForEpoch, useLoanRepaymentMutation } from './use-loan-repayment-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const allocation = { principalAmount: 645, interestAmount: 300, feeAmount: 5, totalPaymentAmount: 950 }
const link = { type: 'link' as const, loanId: 7, transactionKey: 82, allocation }

const setup = async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = await renderHook(() => useLoanRepaymentMutation(), { wrapper })
  return { client, hook }
}

describe('useLoanRepaymentMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('serializes link/edit/unlink and invalidates only current loan families after confirmed success', async () => {
    const { client, hook } = await setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    await act(async () => { await hook.result.current.mutateAsync(link) })
    await act(async () => { await hook.result.current.mutateAsync({ type: 'edit', loanId: 7, repaymentLinkId: 21, allocation }) })
    await act(async () => { await hook.result.current.mutateAsync({ type: 'unlink', loanId: 7, repaymentLinkId: 21 }) })
    expect(mockWrite.mock.calls[0]).toEqual([expect.objectContaining({ method: 'POST', path: '/v1/loan/7/repayments/link?transactionKey=82' }), expect.objectContaining({ body: allocation })])
    expect(mockWrite.mock.calls[1]).toEqual([expect.objectContaining({ method: 'PATCH', path: '/v1/loan/7/repayments/21' }), expect.objectContaining({ body: allocation })])
    expect(mockWrite.mock.calls[2][0]).toMatchObject({ method: 'DELETE', path: '/v1/loan/7/repayments/21' })
    expect(mockWrite.mock.calls[2][1]).not.toHaveProperty('body')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'detail', 8, 7], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'repayments', 8, 7], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'repayment-candidates', 8, 7], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) })
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining(['accounts']) }))
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining(['transactions']) }))
    await hook.unmount(); client.clear()
  })

  it('matches only active-epoch transaction, insight, budget, and canonical net-worth families', () => {
    const affected = [
      ['transactions', 8],
      ['transactions', 8, 'aggregate', { limit: 100 }],
      ['transactions', 8, 'account', 42, { limit: 100 }],
      ['account-insights', 8, 'metrics', 'from', 'to'],
      ['account-insights', 8, 'account', 42, 'metrics', 'from'],
      ['account-insights', 8, 'category-spending', 'from', 'to', 10],
      ['account-insights', 8, 'cashflow', 'from', 'to'],
      ['budgets', 'list', 8],
      ['budgets', 'inventory', 8],
      ['budgets', 'detail', 8, 3],
      ['budgets', 'month', 8, 3, 2026, 7],
      ['net-worth', 8],
    ]
    const unrelated = [
      ['transactions', 7, 'aggregate'], ['account-insights', 7, 'metrics'], ['budgets', 'month', 7, 3], ['net-worth', 7],
      ['account-insights', 8], ['account-insights', 8, 'unknown'], ['account-insights', 8, 'metrics-extra'], ['account-insights-sibling', 8, 'metrics'],
      ['account-insights', 'metrics', 8], ['account-insights', 8, null], ['account-insights', 8, 0],
      ['net-worth', 8, 'detail'], ['accounts', 8], ['portfolios', 8], ['goals', 8], ['recurring', 8], ['categories', 8],
      ['budgets', 'unknown', 8],
    ]
    affected.forEach((key) => expect(isRepaymentDerivedQueryForEpoch(key, 8)).toBe(true))
    unrelated.forEach((key) => expect(isRepaymentDerivedQueryForEpoch(key, 8)).toBe(false))
  })

  it('uses one per-loan lock across all repayment action types', async () => {
    const { client, hook } = await setup()
    let resolve!: () => void
    mockWrite.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync(link) })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'unlink', loanId: 7, repaymentLinkId: 21 })).rejects.toThrow(/already pending/) })
    await act(async () => { resolve(); await first })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('gates all writes after an unknown result until authoritative refresh is marked', async () => {
    const { client, hook } = await setup()
    mockWrite.mockRejectedValueOnce(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))
    await act(async () => { await expect(hook.result.current.mutateAsync(link)).rejects.toMatchObject({ code: 'cancelled' }) })
    expect(hook.result.current.requiresAuthoritativeRefresh(7)).toBe(true)
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'unlink', loanId: 7, repaymentLinkId: 21 })).rejects.toThrow(/Refresh repayment/) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(() => hook.result.current.markAuthoritativeRefresh(7))
    mockWrite.mockImplementationOnce(async (_endpoint, options) => { options.commit(undefined); return undefined })
    await act(async () => { await expect(hook.result.current.mutateAsync(link)).resolves.toBeUndefined() })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })

  it('keeps pre-dispatch cancellation definitive and classifies stale, duplicate, demo, access, and server uncertainty distinctly', () => {
    expect(classifyRepaymentWriteFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyRepaymentWriteFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyRepaymentWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyRepaymentWriteFailure(new ApiError('http', 409))).toBe('conflict')
    expect(classifyRepaymentWriteFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyRepaymentWriteFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyRepaymentWriteFailure(new ApiError('http', 500))).toBe('unknown')
    expect(classifyRepaymentWriteFailure(new ApiError('invalid-response'))).toBe('unknown')
  })
})
