import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { loanFixture } from './test-fixtures'
import { classifyLoanWriteFailure, useLoanMetadataMutation } from './use-loan-metadata-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('loan metadata write', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the exact sparse body once and invalidates current-epoch loan and net worth only after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const response = { loan: { ...loanFixture, providerName: '', notes: 'Retained' } }
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(response); return response })
    const hook = await renderHook(() => useLoanMetadataMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ loanId: 7, value: { providerName: '', notes: 'Retained' } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/loan/7' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ providerName: '', notes: 'Retained' })
    expect(invalidate).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'detail', 8, 7], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8], exact: true })
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['loans', 'repayments', 8, 7] }))
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['loans', 'detail', 9, 7] }))
    await hook.unmount(); client.clear()
  })

  it('rejects no-op, null, unknown and material bodies before transport', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useLoanMetadataMutation(), { wrapper })
    for (const value of [{}, { includeInNetWorth: 'false' }, { includeInNetWorth: null }, { notes: null }, { currency: 'EUR' }, { outstandingPrincipal: 1 }, { annualInterestRateBps: 10_001 }, { termMonths: 1.5 }, { status: 'CLOSED' }, { currencyKey: 1 }]) {
      await act(async () => { await expect(hook.result.current.mutateAsync({ loanId: 7, value: value as never })).rejects.toBeDefined() })
    }
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('sends an explicit boolean only and rejects a same-loan double tap', async () => {
    const { client, wrapper } = setup()
    let resolve!: (value: unknown) => void
    mockWrite.mockReturnValue(new Promise((done) => { resolve = done }))
    const hook = await renderHook(() => useLoanMetadataMutation(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync({ loanId: 7, value: { includeInNetWorth: false } }) })
    await waitFor(() => expect(hook.result.current.isLoanPending(7)).toBe(true))
    await act(async () => { await expect(hook.result.current.mutateAsync({ loanId: 7, value: { includeInNetWorth: true } })).rejects.toThrow(/already pending/i) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][1].body).toEqual({ includeInNetWorth: false })
    await act(async () => { resolve({ loan: loanFixture }); await first })
    await hook.unmount(); client.clear()
  })

  it.each(['network', 'invalid-response'] as const)('locks %s ambiguity behind authoritative refresh without retry or invalidation', async (code) => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let reject!: (error: Error) => void
    mockWrite.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    const hook = await renderHook(() => useLoanMetadataMutation(), { wrapper })
    await act(() => { hook.result.current.mutate({ loanId: 7, value: { name: 'Loan' } }) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await act(async () => { reject(new ApiError(code)) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
    expect(hook.result.current.requiresAuthoritativeRefresh(7)).toBe(true)
    await act(async () => { await expect(hook.result.current.mutateAsync({ loanId: 7, value: { includeInNetWorth: false } })).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(() => hook.result.current.markAuthoritativeRefresh(7))
    expect(hook.result.current.requiresAuthoritativeRefresh(7)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('classifies sensitive failures distinctly and transitions guarded access', async () => {
    expect(classifyLoanWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyLoanWriteFailure(new ApiError('mfa-required'))).toBe('mfa')
    expect(classifyLoanWriteFailure(new ApiError('auth-session'))).toBe('access')
    expect(classifyLoanWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyLoanWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyLoanWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyLoanWriteFailure(new ApiError('invalid-response'))).toBe('invalid-response')
    expect(classifyLoanWriteFailure(new ApiError('http', 500))).toBe('general')
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useLoanMetadataMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ loanId: 7, value: { name: 'Loan' } })).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})
