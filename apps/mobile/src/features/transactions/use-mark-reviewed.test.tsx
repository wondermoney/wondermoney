import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { normalizePersistedTransactionIds, useMarkTransactionReviewed, useTransactionBulkActions } from './use-mark-reviewed'

const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } } }) }))

describe('useMarkTransactionReviewed', () => {
  beforeEach(() => mockWrite.mockReset())
  it('uses guarded bulk PATCH once and invalidates only current-epoch transactions after commit', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    client.setQueryData(['transactions', 12, 'aggregate'], { transactions: [] })
    client.setQueryData(['accounts', 12], { accounts: [] })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useMarkTransactionReviewed(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(41) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/account/transaction' }), expect.objectContaining({ body: { transactionIds: [41], reviewed: true }, commit: expect.any(Function) }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 12] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account-insights', 12] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['accounts', 12] })
    await hook.unmount()
    client.clear()
  })
  it('rejects synthetic ids before transport', async () => {
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useMarkTransactionReviewed(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(-4)).rejects.toThrow('positive persisted') })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('deduplicates and sorts category ids, omits reviewed, and invalidates category-dependent current-epoch roots only on commit', async () => {
    const client = new QueryClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let commit: (() => void) | undefined
    mockWrite.mockImplementation(async (_endpoint, options) => { commit = options.commit })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useTransactionBulkActions(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ type: 'category', transactionIds: [9, 2, 9], categoryId: 7 }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0]?.[1].body).toEqual({ transactionIds: [2, 9], categoryId: '7' })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { commit?.() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 12] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account-insights', 12] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['budgets', 'month', 12] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring', 12] })
    await hook.unmount(); client.clear()
  })

  it('sends a hidden=true PATCH for the hidden action and invalidates only transactions and insights', async () => {
    const client = new QueryClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let commit: (() => void) | undefined
    mockWrite.mockImplementation(async (_endpoint, options) => { commit = options.commit })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useTransactionBulkActions(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ type: 'hidden', transactionIds: [9, 2, 9] }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0]?.[1].body).toEqual({ transactionIds: [2, 9], hidden: true })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { commit?.() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 12] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account-insights', 12] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['budgets', 'month', 12] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['recurring', 12] })
    await hook.unmount(); client.clear()
  })

  it('sends a hidden=false PATCH for the unhidden action', async () => {
    const client = new QueryClient()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useTransactionBulkActions(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ type: 'unhidden', transactionIds: [4] }) })
    expect(mockWrite.mock.calls[0]?.[1].body).toEqual({ transactionIds: [4], hidden: false })
    await hook.unmount(); client.clear()
  })

  it('locks a pending selected set and never retries an ambiguous failure', async () => {
    const client = new QueryClient()
    let rejectWrite: ((reason: unknown) => void) | undefined
    mockWrite.mockImplementation(() => new Promise((_resolve, reject) => { rejectWrite = reject }))
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useTransactionBulkActions(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync({ type: 'review', transactionIds: [4] }) })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'review', transactionIds: [5] })).rejects.toThrow('already pending') })
    await act(async () => { rejectWrite?.(new Error('ambiguous')); await expect(first).rejects.toThrow('ambiguous') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('rejects an empty set or any synthetic id before transport', () => {
    expect(() => normalizePersistedTransactionIds([])).toThrow('positive persisted')
    expect(() => normalizePersistedTransactionIds([4, 0, -2])).toThrow('positive persisted')
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
