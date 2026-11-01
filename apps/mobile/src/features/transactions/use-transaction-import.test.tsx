import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useTransactionImport } from './use-transaction-import'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockUpload = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))
jest.mock('./transaction-import-upload', () => ({ uploadTransactionImportFile: (...args: unknown[]) => mockUpload(...args) }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const supportedUpload = { key: 'k1', presignedUrl: 'https://s3.example/upload', isSupportedBank: true }
const unsupportedUpload = { key: 'k1', presignedUrl: 'https://s3.example/upload', isSupportedBank: false }
const genericUpload = { key: 'k1', presignedUrl: 'https://s3.example/upload', isSupportedBank: false, csvImportFormat: 'generic' as const }
const started = { correlationId: 'c1', status: 'queued' }
const file = { uri: 'file:///picked.csv', name: 'picked.csv' }
const noWait = { wait: async () => undefined }

describe('useTransactionImport', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset(); mockUpload.mockReset() })

  it('runs the full upload -> start -> poll flow to a succeeded outcome and invalidates transaction content', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce(started)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ correlationId: 'c1', status: 'running' }).mockResolvedValueOnce({ correlationId: 'c1', status: 'succeeded' })

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })

    await act(async () => { await hook.result.current.start(7, file) })

    expect(mockWrite.mock.calls[0]?.[0].path).toBe('/v1/account/7/transaction/upload')
    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://s3.example/upload')
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/account/7/transaction/import')
    expect(mockWrite.mock.calls[1]?.[1].body).toEqual({ key: 'k1' })
    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'succeeded', format: 'bank', rows: null })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }))
    await hook.unmount(); client.clear()
  })

  it('stops before uploading for an unsupported bank on an API that reports no format', async () => {
    mockWrite.mockResolvedValueOnce(unsupportedUpload)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'unsupported-bank' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('imports a generic CSV for an account without a supported bank and reports the rejected rows', async () => {
    mockWrite.mockResolvedValueOnce(genericUpload).mockResolvedValueOnce(started)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ correlationId: 'c1', status: 'partial', progress: { imported: 1, failed: 1, totalRows: 2 } })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://s3.example/upload')
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/account/7/transaction/import')
    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'partial', format: 'generic', rows: { failed: 1, total: 2 } })
    await hook.unmount(); client.clear()
  })

  it('imports a bank statement when the API reports the bank format', async () => {
    mockWrite.mockResolvedValueOnce({ ...supportedUpload, csvImportFormat: 'bank' }).mockResolvedValueOnce(started)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ correlationId: 'c1', status: 'succeeded', progress: { imported: 3, failed: 0, totalRows: 3 } })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, { uri: 'file:///statement.xlsx', name: 'statement.xlsx' }) })

    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'succeeded', format: 'bank', rows: { failed: 0, total: 3 } })
    await hook.unmount(); client.clear()
  })

  it('stops before uploading when the API reports a format this build does not know', async () => {
    mockWrite.mockResolvedValueOnce({ ...supportedUpload, csvImportFormat: 'unknown' })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'unknown-format' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('refuses a non-CSV file for the generic format before uploading it', async () => {
    mockWrite.mockResolvedValueOnce(genericUpload)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, { uri: 'file:///statement.xlsx', name: 'statement.xlsx' }) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'csv-only' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports upload-failed without triggering the import start when the presigned upload fails', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload)
    mockUpload.mockRejectedValue(new Error('network blip'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'upload-failed' })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('does not invalidate transaction content for a failed terminal outcome', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce({ correlationId: 'c1', status: 'failed' })
    mockUpload.mockResolvedValue(undefined)

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'failed', format: 'bank', rows: null })
    expect(mockRead).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('reaches a partial outcome and still invalidates transaction content', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce(started)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ correlationId: 'c1', status: 'partial' })

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'partial', format: 'bank', rows: null })
    expect(invalidate).toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('reports a needs_action outcome without invalidating transaction content', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce(started)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ correlationId: 'c1', status: 'needs_action' })

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'done', outcome: 'needs_action', format: 'bank', rows: null })
    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('classifies an MFA error and blocks access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'mfa' })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies a network error without blocking access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('network'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'network' })
    expect(mockBlockAccess).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('resets back to idle', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })
    expect(hook.result.current.state.phase).toBe('error')
    await act(async () => hook.result.current.reset())
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })
})
