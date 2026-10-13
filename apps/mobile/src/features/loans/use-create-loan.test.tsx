import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { loanFixture } from './test-fixtures'
import { classifyLoanCreateFailure, useCreateLoan } from './use-create-loan'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const payload = { name: 'Home loan', type: 'MORTGAGE' as const, currencyKey: 1, openingPrincipalBalance: 250_000, openingBalanceDate: '2026-01-01', includeInNetWorth: true }

describe('useCreateLoan', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('posts the full payload and invalidates loans and net worth after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { loan: loanFixture } })
    const hook = await renderHook(() => useCreateLoan(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(payload) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/loan', successStatuses: [201] })
    expect(mockWrite.mock.calls[0][1].body).toEqual(payload)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loans', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an incomplete payload before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCreateLoan(), { wrapper })
    const { name: _omit, ...incomplete } = payload
    await act(async () => { await expect(hook.result.current.mutateAsync(incomplete as never)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('locks pending and does not invalidate without commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useCreateLoan(), { wrapper })
    await act(() => { hook.result.current.mutate(payload) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('does not retry ambiguous failures and transitions classified access', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const hook = await renderHook(() => useCreateLoan(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required'))
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures and defaults unknown errors to general', () => {
    expect(classifyLoanCreateFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyLoanCreateFailure(new ApiError('mfa-required'))).toBe('mfa')
    expect(classifyLoanCreateFailure(new ApiError('invalid-response'))).toBe('invalid-response')
    expect(classifyLoanCreateFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyLoanCreateFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyLoanCreateFailure(new Error('boom'))).toBe('general')
  })
})
