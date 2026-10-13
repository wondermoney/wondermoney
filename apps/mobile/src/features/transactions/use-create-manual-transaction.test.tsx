import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyManualTransactionFailure, isManualTransactionAffectedQuery, useCreateManualTransaction } from './use-create-manual-transaction'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const frozen = { accountId: 7, payload: { transactionDate: '2026-07-19T12:00:00.000Z', transactionTypeId: '3', settlementAmount: '12.50', settlementCurrencyId: '151', transactionMerchantId: 9 } } as const

describe('useCreateManualTransaction', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes once without retry and invalidates every current-epoch affected family only after empty success', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const keys = [
      ['transactions', 12, 'aggregate'], ['transactions', 12, 'account', 7], ['accounts', 12], ['account', 12, 7],
      ['account-insights', 12, 'metrics'], ['budgets', 'list', 12], ['budgets', 'detail', 12, 1], ['budgets', 'month', 12, 1],
      ['recurring', 12, 'items'], ['recurring', 12, 'summary'], ['net-worth', 12], ['accounts', 11],
    ]
    keys.forEach((key) => client.setQueryData(key, {}))
    const invalidated: unknown[][] = []
    jest.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
      keys.forEach((key) => { if (filters?.predicate?.({ queryKey: key } as never)) invalidated.push(key) })
    })
    mockWrite.mockImplementation(async (endpoint, options) => { expect(endpoint.schema.parse(undefined)).toBeUndefined(); options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useCreateManualTransaction(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(frozen) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/account/7/transaction' }), expect.objectContaining({ body: frozen.payload, commit: expect.any(Function) }))
    expect(invalidated).toEqual(keys.slice(0, -1))
    await hook.unmount()
    client.clear()
  })

  it('blocks double dispatch and permanently gates an unknown outcome', async () => {
    const client = new QueryClient()
    let reject!: (error: unknown) => void
    mockWrite.mockImplementation(() => new Promise((_resolve, rejectWrite) => { reject = rejectWrite }))
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useCreateManualTransaction(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync(frozen) })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync(frozen)).rejects.toThrow('already been submitted') })
    await act(async () => { reject(new ApiError('network')); await expect(first).rejects.toMatchObject({ code: 'network' }) })
    await act(async () => { await expect(hook.result.current.mutateAsync(frozen)).rejects.toThrow('already been submitted') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })

  it('re-enables the same reviewed submission after definitive pre-dispatch cancellation', async () => {
    const client = new QueryClient()
    mockWrite
      .mockRejectedValueOnce(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))
      .mockImplementationOnce(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useCreateManualTransaction(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(frozen)).rejects.toMatchObject({ code: 'cancelled', writeDispatchState: 'pre-dispatch' }) })
    await act(async () => { await expect(hook.result.current.mutateAsync(frozen)).resolves.toBeUndefined() })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })

  it('classifies uncertainty conservatively and 4xx/demo/access as definitive', () => {
    expect(classifyManualTransactionFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyManualTransactionFailure(new ApiError('invalid-response'))).toBe('unknown')
    expect(classifyManualTransactionFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyManualTransactionFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyManualTransactionFailure(new ApiError('http', 503))).toBe('unknown')
    expect(classifyManualTransactionFailure(new ApiError('http', 422))).toBe('validation')
    expect(classifyManualTransactionFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(isManualTransactionAffectedQuery(['account', 11, 7], 12)).toBe(false)
  })
})
