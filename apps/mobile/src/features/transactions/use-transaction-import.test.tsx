import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useTransactionImport } from './use-transaction-import'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockUpload = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))
jest.mock('./transaction-import-upload', () => ({ uploadTransactionImportFile: (...args: unknown[]) => mockUpload(...args) }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const supportedUpload = { key: 'account-7-k1', presignedUrl: 'https://s3.example/upload', isSupportedBank: true }
const unsupportedUpload = { key: 'account-7-k1', presignedUrl: 'https://s3.example/upload', isSupportedBank: false }
const genericUpload = { ...unsupportedUpload, csvImportFormat: 'generic' as const }
const file = { uri: 'file:///picked.csv', name: 'picked.csv' }
const session = {
  accountId: 7,
  accountMapping: {},
  canCommit: false,
  canRetry: false,
  committedAt: null,
  correlationId: 'transaction-import:parse:x',
  counts: { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0, skipped: 0, imported: 0, failed: 0 },
  createdAt: '2026-11-12T10:00:00.000Z',
  decisions: { import: 0, skip: 0 },
  detailsDeletedAt: null,
  errorCode: null,
  expiresAt: '2026-11-19T10:00:00.000Z',
  fileName: 'picked.csv',
  format: 'statement',
  id: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e',
  sourceAccounts: [],
  status: 'parsing',
  upload: null,
  warnings: [],
}

describe('useTransactionImport', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset(); mockUpload.mockReset() })

  it('uploads the file and stages it as a session for review, without committing anything', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce({ session })
    mockUpload.mockResolvedValue(undefined)

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useTransactionImport(), { wrapper })

    let staged: unknown
    await act(async () => { staged = await hook.result.current.start(7, file) })

    expect(mockWrite.mock.calls[0]?.[0].path).toBe('/v1/account/7/transaction/upload')
    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://s3.example/upload')
    expect(mockWrite.mock.calls[1]?.[0]).toMatchObject({ method: 'POST', path: '/v1/transaction-import-sessions' })
    // The name the file had stays with the import; no autoCommit, so the session waits for review.
    expect(mockWrite.mock.calls[1]?.[1].body).toEqual({ accountId: 7, fileName: 'picked.csv', format: 'statement', key: 'account-7-k1' })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite.mock.calls.map((call) => call[0].path)).not.toContain('/v1/account/7/transaction/import')
    expect(staged).toMatchObject({ id: session.id, status: 'parsing' })
    expect(hook.result.current.state).toMatchObject({ phase: 'staged', session: { id: session.id } })
    // Nothing was written to the account yet.
    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('reads an OFX file in its own format, as web does', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockResolvedValueOnce({ session })
    mockUpload.mockResolvedValue(undefined)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, { uri: 'file:///bank.qfx', name: 'bank.qfx' }) })

    expect(mockWrite.mock.calls[1]?.[1].body).toMatchObject({ fileName: 'bank.qfx', format: 'ofx' })
    await hook.unmount(); client.clear()
  })

  it('stages a generic CSV for an account without a supported bank', async () => {
    mockWrite.mockResolvedValueOnce(genericUpload).mockResolvedValueOnce({ session })
    mockUpload.mockResolvedValue(undefined)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/transaction-import-sessions')
    expect(hook.result.current.state.phase).toBe('staged')
    await hook.unmount(); client.clear()
  })

  it('stops before uploading for an unsupported bank on an API that reports no format', async () => {
    mockWrite.mockResolvedValueOnce(unsupportedUpload)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    let staged: unknown = 'unset'
    await act(async () => { staged = await hook.result.current.start(7, file) })

    expect(staged).toBeNull()
    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'unsupported-bank' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('stops before uploading when the API reports a format this build does not know', async () => {
    mockWrite.mockResolvedValueOnce({ ...supportedUpload, csvImportFormat: 'unknown' })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'unknown-format' })
    expect(mockUpload).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('refuses a non-CSV file for the generic format before uploading it', async () => {
    mockWrite.mockResolvedValueOnce(genericUpload)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, { uri: 'file:///statement.xlsx', name: 'statement.xlsx' }) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'csv-only' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports upload-failed without staging the import when the presigned upload fails', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload)
    mockUpload.mockRejectedValue(new Error('network blip'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'upload-failed' })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports the demo guard when the demo refuses the upload', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('demo-forbidden', 403))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'demo' })
    expect(mockUpload).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('classifies an MFA error and blocks access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'mfa' })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies a network error while staging without blocking access', async () => {
    mockWrite.mockResolvedValueOnce(supportedUpload).mockRejectedValueOnce(new ApiError('network'))
    mockUpload.mockResolvedValue(undefined)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })

    expect(hook.result.current.state).toEqual({ phase: 'error', reason: 'network' })
    expect(mockBlockAccess).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('resets back to idle', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTransactionImport(), { wrapper })
    await act(async () => { await hook.result.current.start(7, file) })
    expect(hook.result.current.state.phase).toBe('error')
    await act(async () => hook.result.current.reset())
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })
})
