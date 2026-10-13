import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { usePortfolioImport } from './use-portfolio-import'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockUpload = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))
jest.mock('./portfolio-import-upload', () => ({ uploadPortfolioImportFile: (...args: unknown[]) => mockUpload(...args) }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const session = {
  correlationId: 'c1', importSessionId: 41, maxUploadSizeBytes: 1000, s3Bucket: 'b', s3Key: 'k',
  status: 'waiting_for_upload', uploadHeaders: { 'Content-Type': 'text/csv' }, uploadMethod: 'PUT', uploadUrl: 'https://s3.example/upload',
}
const parseTrigger = { correlationId: 'c2', importSessionId: 41, status: 'parsing' }
const needsMapping = { rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] }, status: 'needs_column_mapping', summary: { blockingRows: 0, canConfirm: false, duplicateRows: 0, failedRows: 0, importableRows: 0, importedRows: 0, invalidRows: 0, needsAssetReviewRows: 0, readyRows: 0, skippedRows: 0, totalRows: 0 }, assetGroups: [], importSessionId: 41, limits: { rowsPerBucket: 25 }, portfolioId: 7 }
const suggestion = { columnMapping: { transactionDate: 'Date', quantity: 'Shares', unitPrice: 'Price' }, importSessionId: 41, mappingSource: 'llm', status: 'needs_column_mapping' }
const readyPreview = { ...needsMapping, status: 'ready_to_import', summary: { ...needsMapping.summary, canConfirm: true, importableRows: 3, readyRows: 3, totalRows: 3 } }
const confirmMapping = { importSessionId: 41, status: 'ready_to_import', summary: {} }
const confirmImport = { correlationId: 'c3', importSessionId: 41, status: 'importing' }
const succeededPreview = { ...readyPreview, status: 'succeeded' }

const file = { uri: 'file:///picked.csv', name: 'picked.csv' }
const noWait = { wait: async () => undefined }

describe('usePortfolioImport', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset(); mockUpload.mockReset() })

  it('runs the full auto-mapped upload flow through to a reviewable preview', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
    mockUpload.mockResolvedValue(undefined)
    mockRead
      .mockResolvedValueOnce(needsMapping)
      .mockResolvedValueOnce(readyPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })

    await act(async () => { await hook.result.current.start(file) })

    expect(mockWrite.mock.calls[0]?.[0].path).toBe('/v1/portfolio/7/import-sessions')
    expect(mockWrite.mock.calls[0]?.[1].body).toEqual({ mode: 'review' })
    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://s3.example/upload', { 'Content-Type': 'text/csv' })
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/portfolio-import-sessions/41/parse')
    expect(mockWrite.mock.calls[2]?.[0].path).toBe('/v1/portfolio-import-sessions/41/column-mapping/suggest')
    expect(mockWrite.mock.calls[3]?.[0].path).toBe('/v1/portfolio-import-sessions/41/column-mapping')
    expect(mockWrite.mock.calls[3]?.[1].body).toEqual({ columnMapping: suggestion.columnMapping })
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: readyPreview })
    await hook.unmount(); client.clear()
  })

  it('confirms a reviewed import and invalidates portfolio content on success', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
      .mockResolvedValueOnce(confirmImport)
    mockUpload.mockResolvedValue(undefined)
    mockRead
      .mockResolvedValueOnce(needsMapping)
      .mockResolvedValueOnce(readyPreview)
      .mockResolvedValueOnce(succeededPreview)

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })
    await act(async () => { await hook.result.current.confirm() })

    expect(mockWrite.mock.calls[4]?.[0].path).toBe('/v1/portfolio-import-sessions/41/confirm')
    expect(hook.result.current.state).toEqual({ phase: 'succeeded', preview: succeededPreview })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }))
    await hook.unmount(); client.clear()
  })

  it('never calls confirm without a reviewed session', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.confirm() })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })

  it('reports upload-failed without triggering parse when the presigned upload fails', async () => {
    mockWrite.mockResolvedValueOnce(session)
    mockUpload.mockRejectedValue(new Error('network blip'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'upload-failed' })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports processing-failed when parsing terminates in a failed status', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ ...needsMapping, status: 'failed' })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'processing-failed' })
    await hook.unmount(); client.clear()
  })

  it('reports unmapped-columns when the server has no suggestion to offer', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce({ importSessionId: 41, mappingSource: 'disabled', status: 'needs_column_mapping', warning: 'Automatic column mapping suggestion is unavailable' })
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'unmapped-columns' })
    expect(mockWrite).toHaveBeenCalledTimes(3)
    await hook.unmount(); client.clear()
  })

  it('still reaches review with a disabled confirm when rows need asset review', async () => {
    const needsReview = { ...readyPreview, status: 'needs_asset_review', summary: { ...readyPreview.summary, canConfirm: false, needsAssetReviewRows: 2 } }
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping).mockResolvedValueOnce(needsReview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'review', preview: needsReview })
    await hook.unmount(); client.clear()
  })

  it('classifies an MFA error and blocks access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'mfa' })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('submits resolved asset-group mappings and refetches the preview into the review phase', async () => {
    const needsReview = { ...readyPreview, status: 'needs_asset_review', summary: { ...readyPreview.summary, canConfirm: false, needsAssetReviewRows: 2 } }
    const resolvedPreview = { ...readyPreview, summary: { ...readyPreview.summary, canConfirm: true } }
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
      .mockResolvedValueOnce({ importSessionId: 41, status: 'ready_to_import' })
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping).mockResolvedValueOnce(needsReview).mockResolvedValueOnce(resolvedPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: needsReview })

    const mappings = [{ assetGroupId: 1, resolution: { type: 'skip' as const } }]
    await act(async () => { await hook.result.current.resolveAssetGroups(mappings) })

    expect(mockWrite.mock.calls[4]?.[0].path).toBe('/v1/portfolio-import-sessions/41/asset-groups')
    expect(mockWrite.mock.calls[4]?.[1].body).toEqual({ mappings })
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: resolvedPreview })
    expect(hook.result.current.resolvingAssetGroups).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('never submits an empty asset-group batch and stays a no-op outside the review phase', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.resolveAssetGroups([]) })
    await act(async () => { await hook.result.current.resolveAssetGroups([{ assetGroupId: 1, resolution: { type: 'skip' } }]) })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })

  it('polls repeatedly through in-flight parsing statuses before proceeding', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
    mockUpload.mockResolvedValue(undefined)
    mockRead
      .mockResolvedValueOnce({ ...needsMapping, status: 'uploaded' })
      .mockResolvedValueOnce({ ...needsMapping, status: 'parsing' })
      .mockResolvedValueOnce(needsMapping)
      .mockResolvedValueOnce(readyPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(mockRead).toHaveBeenCalledTimes(4)
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: readyPreview })
    await hook.unmount(); client.clear()
  })
})
