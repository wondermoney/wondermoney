import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { loanFixture, repaymentCandidateFixture, repaymentFixture } from './test-fixtures'
import { useLoanRepaymentCandidates } from './use-loan-repayment-candidates'
import { useLoan } from './use-loan'
import { useLoanRepayments } from './use-loan-repayments'
import { useLoans } from './use-loans'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 6
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

async function verifyReadHook(hookFactory: () => { data: unknown }, value: unknown, path: string, key: readonly unknown[]) {
  mockRead.mockResolvedValue(value)
  const { client, wrapper } = setup()
  const hook = await renderHook(() => hookFactory(), { wrapper })
  await waitFor(() => expect(hook.result.current.data).toEqual(value))
  expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path }))
  expect(client.getQueryData(key)).toEqual(value)
  expect(client.getQueryCache().find({ queryKey: key })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
  expect(mockWrite).not.toHaveBeenCalled()
  await hook.unmount(); client.clear()
}

describe('loan query hooks', () => {
  beforeEach(() => { mockEpoch = 6; mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it.each([
    ['list', () => useLoans(), { loans: [loanFixture] }, '/v1/loan', ['loans', 'list', 6]],
    ['detail', () => useLoan(7), { loan: loanFixture }, '/v1/loan/7', ['loans', 'detail', 6, 7]],
    ['repayments', () => useLoanRepayments(7), { repayments: [repaymentFixture] }, '/v1/loan/7/repayments', ['loans', 'repayments', 6, 7]],
    ['repayment candidates', () => useLoanRepaymentCandidates(7), { candidates: [repaymentCandidateFixture] }, '/v1/loan/7/repayment-candidates', ['loans', 'repayment-candidates', 6, 7]],
  ] as const)('loads %s with an exact GET endpoint and epoch key', async (_label, hookFactory, value, path, key) => {
    await verifyReadHook(hookFactory, value, path, key)
  })

  it('makes no detail or repayment request for an invalid route id', async () => {
    const first = setup()
    const detail = await renderHook(() => useLoan(null), { wrapper: first.wrapper })
    const history = await renderHook(() => useLoanRepayments(null), { wrapper: first.wrapper })
    const candidates = await renderHook(() => useLoanRepaymentCandidates(null), { wrapper: first.wrapper })
    expect(detail.result.current.isInvalidId).toBe(true)
    expect(history.result.current.isInvalidId).toBe(true)
    expect(candidates.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await detail.unmount(); await history.unmount(); await candidates.unmount(); first.client.clear()
  })

  it('classifies 404 and retains valid same-epoch data for an ordinary refresh failure', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const first = setup()
    const missing = await renderHook(() => useLoan(7), { wrapper: first.wrapper })
    await waitFor(() => expect(missing.result.current.isNotFound).toBe(true))
    await missing.unmount(); first.client.clear()

    const value = { loans: [loanFixture] }
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const second = setup()
    const stale = await renderHook(() => useLoans(), { wrapper: second.wrapper })
    await waitFor(() => expect(stale.result.current.data).toEqual(value))
    await act(async () => { await stale.result.current.refetch() })
    await waitFor(() => expect(stale.result.current.isRefreshFailure).toBe(true))
    expect(stale.result.current.data).toEqual(value)
    await stale.unmount(); second.client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)('suppresses cached loan data for %s and blocks access when required', async (code) => {
    const value = { loan: loanFixture }
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useLoan(7), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
    await hook.unmount(); client.clear()
  })
})
