import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAccountRecalculation } from './use-account-recalculation'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const noWait = { wait: async () => undefined }
const result = { accountKey: 7, amountsReconverted: 0, appuserCurrency: 'EUR', appuserCurrencyBalanceAfter: 140, appuserCurrencyBalanceBefore: 500, balanceAfter: 140, balanceBefore: 500, currency: 'EUR', rowsChanged: 2, rowsScanned: 3 }

describe('useAccountRecalculation', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('starts the recalculation, follows it to the end and refreshes the account', async () => {
    mockWrite.mockResolvedValueOnce({ operationId: 'account.recalculate:1' })
    mockRead.mockResolvedValueOnce({ status: 'running', progress: null }).mockResolvedValueOnce({ status: 'succeeded', progress: result })
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useAccountRecalculation(noWait), { wrapper })

    await act(async () => { await hook.result.current.start(7) })

    expect(mockWrite.mock.calls[0]?.[0]).toMatchObject({ method: 'POST', path: '/v1/account/7/recalculate' })
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/operations/account.recalculate%3A1')
    expect(hook.result.current.state).toEqual({ phase: 'done', result: { balanceAfter: 140, balanceBefore: 500, currency: 'EUR', rowsChanged: 2 } })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }))
    await hook.unmount(); client.clear()
  })

  it('reports a run that failed', async () => {
    mockWrite.mockResolvedValueOnce({ operationId: 'account.recalculate:1' })
    mockRead.mockResolvedValueOnce({ status: 'failed', progress: null })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountRecalculation(noWait), { wrapper })

    await act(async () => { await hook.result.current.start(7) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'failed' })
    await hook.unmount(); client.clear()
  })

  it('tells a start refused for coming too soon from one the account is gone for', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountRecalculation(noWait), { wrapper })

    mockWrite.mockRejectedValueOnce(new ApiError('http', 429))
    await act(async () => { await hook.result.current.start(7) })
    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'too-soon' })

    mockWrite.mockRejectedValueOnce(new ApiError('http', 404))
    await act(async () => { await hook.result.current.start(7) })
    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'not-found' })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('leaves a long run to finish in the background', async () => {
    mockWrite.mockResolvedValueOnce({ operationId: 'account.recalculate:1' })
    mockRead.mockResolvedValue({ status: 'running', progress: null })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountRecalculation({ ...noWait, maxPollAttempts: 3 }), { wrapper })

    await act(async () => { await hook.result.current.start(7) })

    expect(mockRead).toHaveBeenCalledTimes(3)
    expect(hook.result.current.state).toEqual({ phase: 'background' })
    await hook.unmount(); client.clear()
  })
})
