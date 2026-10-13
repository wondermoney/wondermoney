import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useTransactionOcr } from './use-transaction-ocr'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const scanResult = {
  transactionOcrImportId: 5,
  transactionInfo: { settlementAmount: 12.5, settlementCurrencyId: 2, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantId: 9, transactionMerchantName: 'Corner shop' },
}
const file = { uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' }
const confirmDraft = { accountId: 7, transactionTypeId: 3, transactionDate: '2026-07-18', settlementAmount: '12.50', settlementCurrencyId: 2, existingMerchantId: 9 }

describe('useTransactionOcr', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('scans a picked file with a FormData body and reaches the review phase', async () => {
    mockWrite.mockResolvedValueOnce(scanResult)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })

    await act(async () => { await hook.result.current.scan(file) })

    expect(mockWrite.mock.calls[0]?.[0].path).toBe('/v1/account/transaction/ocr')
    expect(mockWrite.mock.calls[0]?.[1].body).toBeInstanceOf(FormData)
    expect(hook.result.current.state).toEqual({ phase: 'review', scan: scanResult })
    await hook.unmount(); client.clear()
  })

  it('reports a scan failure and classifies MFA errors', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })

    await act(async () => { await hook.result.current.scan(file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'mfa' })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('confirms a reviewed scan, invalidates transaction content, and reaches succeeded', async () => {
    mockWrite.mockResolvedValueOnce(scanResult).mockImplementationOnce(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.scan(file) })

    await act(async () => { await hook.result.current.confirm(confirmDraft) })

    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/account/transaction/ocr/5/confirm')
    expect(mockWrite.mock.calls[1]?.[1].body).toEqual({ accountId: 7, transactionTypeId: 3, transactionDate: '2026-07-18T12:00:00.000Z', settlementAmount: '12.50', settlementCurrencyId: 2, transactionMerchantId: 9 })
    expect(hook.result.current.state).toEqual({ phase: 'succeeded' })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }))
    await hook.unmount(); client.clear()
  })

  it('never calls confirm without a reviewed scan', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.confirm(confirmDraft) })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })

  it('surfaces a validation failure inline on the review phase without dispatching a write', async () => {
    mockWrite.mockResolvedValueOnce(scanResult)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.scan(file) })

    await act(async () => { await hook.result.current.confirm({ ...confirmDraft, existingMerchantId: undefined, newMerchantName: undefined }) })

    expect(hook.result.current.state).toEqual({ phase: 'review', scan: scanResult, confirmError: 'validation' })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('returns to the review phase with a confirm error on a rejected confirm request', async () => {
    mockWrite.mockResolvedValueOnce(scanResult).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.scan(file) })

    await act(async () => { await hook.result.current.confirm(confirmDraft) })

    expect(hook.result.current.state).toEqual({ phase: 'review', scan: scanResult, confirmError: 'network' })
    await hook.unmount(); client.clear()
  })

  it('rejects a reviewed scan and returns to idle', async () => {
    mockWrite.mockResolvedValueOnce(scanResult).mockResolvedValueOnce(undefined)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.scan(file) })

    let result: string | undefined
    await act(async () => { result = await hook.result.current.reject() })

    expect(result).toBe('success')
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/account/transaction/ocr/5/reject')
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })

  it('never calls reject without a reviewed scan', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    let result: string | undefined
    await act(async () => { result = await hook.result.current.reject() })
    expect(result).toBe('general')
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('resets back to idle from any phase', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionOcr(), { wrapper })
    await act(async () => { await hook.result.current.scan(file) })
    expect(hook.result.current.state.phase).toBe('error')
    await act(async () => hook.result.current.reset())
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })
})
