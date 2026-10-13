import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyEditPortfolioTransactionFailure, useEditPortfolioTransaction } from './use-edit-portfolio-transaction'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useEditPortfolioTransaction', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the frozen payload to the 200 endpoint and invalidates every current-epoch portfolio-content family', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useEditPortfolioTransaction(7), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ transactionId: 41, draft: { quantity: ' 3.5 ' } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PUT', path: '/v1/portfolio/7/transaction/41', successStatuses: [200] })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ quantity: '3.5' })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['portfolio-activity', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['portfolio-holdings', 8, 7] } as never)).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid portfolio id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useEditPortfolioTransaction(0), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 41, draft: { quantity: '1' } })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('rejects an untouched draft before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useEditPortfolioTransaction(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 41, draft: {} })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useEditPortfolioTransaction(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ transactionId: 41, draft: { quantity: '1' } })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures', () => {
    expect(classifyEditPortfolioTransactionFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyEditPortfolioTransactionFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyEditPortfolioTransactionFailure(new ApiError('http', 400))).toBe('request')
    expect(classifyEditPortfolioTransactionFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyEditPortfolioTransactionFailure(new Error('boom'))).toBe('general')
  })
})
