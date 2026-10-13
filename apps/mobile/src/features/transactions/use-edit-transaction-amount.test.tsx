import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useEditTransactionAmount } from './use-edit-transaction-amount'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

describe('useEditTransactionAmount', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the frozen payload to the single-transaction endpoint and invalidates every current-epoch affected family', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const keys = [
      ['transactions', 12, 'aggregate'], ['transactions', 12, 'account', 7], ['accounts', 12], ['account', 12, 7],
      ['account-insights', 12, 'metrics'], ['budgets', 'list', 12], ['budgets', 'month', 12, 1],
      ['recurring', 12, 'items'], ['net-worth', 12], ['accounts', 11],
    ]
    keys.forEach((key) => client.setQueryData(key, {}))
    const invalidated: unknown[][] = []
    jest.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
      keys.forEach((key) => { if (filters?.predicate?.({ queryKey: key } as never)) invalidated.push(key) })
    })
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAmount(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: ' -5.00 ' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/account/transaction/42' }), expect.objectContaining({ body: { updatedAmount: '-5.00' }, commit: expect.any(Function) }))
    expect(invalidated).toEqual(keys.slice(0, -1))
    await hook.unmount()
    client.clear()
  })

  it('includes a supplied description alongside the amount in the write payload', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAmount(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: '-5.00', description: ' New description ' }) })
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/account/transaction/42' }), expect.objectContaining({ body: { updatedAmount: '-5.00', description: 'New description' } }))
    await hook.unmount()
    client.clear()
  })

  it('rejects a concurrent edit while one is already in flight', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    let resolveWrite!: () => void
    mockWrite.mockImplementation(() => new Promise((resolve) => { resolveWrite = () => resolve(undefined) }))
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAmount(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: '5' }) })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: '6' })).rejects.toThrow('already pending') })
    await act(async () => { resolveWrite(); await first })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })

  it('blocks access on an MFA rejection without swallowing the error', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAmount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: '5' })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount()
    client.clear()
  })

  it('rejects an invalid draft before ever calling write', async () => {
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAmount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 42, updatedAmount: 'not-a-number' })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })
})
