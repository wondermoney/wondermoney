import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyCreatePortfolioTransactionFailure, useCreatePortfolioTransaction } from './use-create-portfolio-transaction'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const draft = { assetSymbol: 'AAPL', financialTransactionTypeId: 3, notes: '', quantity: '10', settlementCurrencyId: 2, transactionDate: '2026-08-01', unitPrice: '150.25' }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useCreatePortfolioTransaction', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the frozen payload to the 201 endpoint and invalidates every current-epoch portfolio-content family', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { transactionId: 99 } })
    const hook = await renderHook(() => useCreatePortfolioTransaction(7), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(draft) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/portfolio/7/transaction', successStatuses: [201] })
    expect(mockWrite.mock.calls[0][1].body).toEqual({
      assetSymbol: 'AAPL', financialTransactionTypeId: 3, quantity: '10', settlementCurrencyId: 2, transactionDate: '2026-08-01T12:00:00.000Z', unitPrice: '150.25',
    })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['portfolio-activity', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-holdings', 8, 7] } as never)).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid portfolio id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCreatePortfolioTransaction(0), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(draft)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('rejects a draft missing a transaction type or settlement currency before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCreatePortfolioTransaction(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ ...draft, financialTransactionTypeId: null })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useCreatePortfolioTransaction(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(draft)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures', () => {
    expect(classifyCreatePortfolioTransactionFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyCreatePortfolioTransactionFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyCreatePortfolioTransactionFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyCreatePortfolioTransactionFailure(new Error('boom'))).toBe('general')
  })
})
