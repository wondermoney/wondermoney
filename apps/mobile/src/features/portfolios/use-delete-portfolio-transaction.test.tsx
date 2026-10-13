import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyDeletePortfolioTransactionFailure, useDeletePortfolioTransaction } from './use-delete-portfolio-transaction'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useDeletePortfolioTransaction', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('deletes with no body against the 204 endpoint and invalidates every current-epoch portfolio-content family', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useDeletePortfolioTransaction(7), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(41) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/portfolio/7/transaction/41', successStatuses: [204] })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['portfolio-activity', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-holdings', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-dashboard', 8, 'aggregate', 'YTD'] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-analytics', 8, 'allocation'] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolios', 8] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-activity', 9, 7] } as never)).toBe(false)
    expect(predicate?.({ queryKey: ['portfolio-settings', 8, 7, 'unknown-outcome'] } as never)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid portfolio id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useDeletePortfolioTransaction(0), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(41)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useDeletePortfolioTransaction(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(41)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures, treating ambiguous network/5xx as unknown', () => {
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('mfa-required'))).toBe('mfa')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('http', 500))).toBe('unknown')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyDeletePortfolioTransactionFailure(new ApiError('http', 400))).toBe('request')
    expect(classifyDeletePortfolioTransactionFailure(new Error('boom'))).toBe('general')
  })
})
