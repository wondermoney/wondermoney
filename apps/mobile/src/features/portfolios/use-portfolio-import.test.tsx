import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import {
  confirmColumnMapping,
  createSession,
  previewAfterColumnMapping,
  previewNeedsColumnMapping,
  suggestColumnMapping,
  triggerParse,
} from './portfolio-import-api-payloads'
import { usePortfolioImport, usePortfolioImportExistingAssets } from './use-portfolio-import'

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

// Real API responses (portfolio-import-api-payloads.ts); the session they belong to is id 1.
const session = createSession
const parseTrigger = triggerParse
const needsMapping = previewNeedsColumnMapping
const suggestion = suggestColumnMapping
const readyPreview = { ...needsMapping, status: 'ready_to_import', summary: { ...needsMapping.summary, canConfirm: true, importableRows: 3, readyRows: 3, totalRows: 3 } }
const confirmMapping = confirmColumnMapping
const confirmImport = { correlationId: 'c3', importSessionId: 1, status: 'importing' }
const succeededPreview = { ...readyPreview, status: 'succeeded' }
const needsReview = previewAfterColumnMapping

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
    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://storage.example.test/upload', { 'Content-Type': 'text/csv' })
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/portfolio-import-sessions/1/parse')
    expect(mockWrite.mock.calls[2]?.[0].path).toBe('/v1/portfolio-import-sessions/1/column-mapping/suggest')
    expect(mockWrite.mock.calls[3]?.[0].path).toBe('/v1/portfolio-import-sessions/1/column-mapping')
    // The whole suggestion goes back, split into the fields the confirm route takes.
    expect(mockWrite.mock.calls[3]?.[1].body).toEqual({
      columnMapping: suggestion.columnMapping.columnMapping,
      derivedValues: {},
      fixedValues: {},
      layout: { dataStartRowIndex: 1, headerRowIndex: 0 },
      transformations: {},
    })
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

    expect(mockWrite.mock.calls[4]?.[0].path).toBe('/v1/portfolio-import-sessions/1/confirm')
    expect(hook.result.current.state).toEqual({ phase: 'succeeded', preview: succeededPreview })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }))
    await hook.unmount(); client.clear()
  })

  it('treats a partial import as done, keeping the rows that failed and refreshing the portfolio', async () => {
    const partialPreview = {
      ...readyPreview,
      rows: { ...readyPreview.rows, failed: [{ failureReason: 'Insufficient quantity to sell', id: 707, raw: { Symbol: 'AMD' }, rowNumber: 7, status: 'failed' as const }] },
      status: 'partial',
    }
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
      .mockResolvedValueOnce(partialPreview)

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })
    await act(async () => { await hook.result.current.confirm() })

    expect(hook.result.current.state).toEqual({ phase: 'succeeded', preview: partialPreview })
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
      .mockResolvedValueOnce({ importSessionId: 1, mappingSource: 'disabled', status: 'needs_column_mapping', warning: 'Automatic column mapping suggestion is unavailable' })
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

  it('sends the asset decisions to the asset-mappings route and refetches the preview into review', async () => {
    const resolvedPreview = { ...readyPreview, summary: { ...readyPreview.summary, canConfirm: true } }
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
      .mockResolvedValueOnce({ importSessionId: 1, status: 'ready_to_import' })
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping).mockResolvedValueOnce(needsReview).mockResolvedValueOnce(resolvedPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: needsReview })

    const decisions = [
      { action: 'use_candidate' as const, candidateId: 1, groupId: 1 },
      { action: 'use_existing_asset' as const, financialAssetId: 9, groupId: 3 },
      { action: 'skip_group' as const, groupId: 2 },
    ]
    await act(async () => { await hook.result.current.resolveAssetGroups(decisions) })

    expect(mockWrite.mock.calls[4]?.[0]).toMatchObject({ method: 'PATCH', path: '/v1/portfolio-import-sessions/1/asset-mappings' })
    expect(mockWrite.mock.calls[4]?.[1].body).toEqual({ decisions })
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: resolvedPreview })
    expect(hook.result.current.resolvingAssetGroups).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('sends more than 100 decisions as consecutive requests of at most 100', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce(confirmMapping)
      .mockResolvedValue({ importSessionId: 1, status: 'needs_asset_review' })
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping).mockResolvedValueOnce(needsReview).mockResolvedValueOnce(readyPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })
    const decisions = Array.from({ length: 230 }, (_, index) => ({ action: 'skip_group' as const, groupId: index + 1 }))
    await act(async () => { await hook.result.current.resolveAssetGroups(decisions) })

    const mappingCalls = mockWrite.mock.calls.slice(4)
    expect(mappingCalls.map(([endpoint]) => endpoint.path)).toEqual(Array(3).fill('/v1/portfolio-import-sessions/1/asset-mappings'))
    expect(mappingCalls.map(([, request]) => request.body.decisions.length)).toEqual([100, 100, 30])
    expect(mappingCalls.flatMap(([, request]) => request.body.decisions)).toEqual(decisions)
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: readyPreview })
    await hook.unmount(); client.clear()
  })

  it('never submits an empty decision list and stays a no-op outside the review phase', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.resolveAssetGroups([]) })
    await act(async () => { await hook.result.current.resolveAssetGroups([{ action: 'skip_group', groupId: 1 }]) })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })

  it('goes straight to review when the server reads the file without column mapping', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(readyPreview)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(hook.result.current.state).toEqual({ phase: 'review', preview: readyPreview })
    await hook.unmount(); client.clear()
  })

  it('reports unmapped-columns when the server has no AI provider for the suggest route', async () => {
    mockWrite
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(parseTrigger)
      .mockRejectedValueOnce(new ApiError('http', 501))
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(needsMapping)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImport(7, noWait), { wrapper })
    await act(async () => { await hook.result.current.start(file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'unmapped-columns' })
    expect(mockWrite).toHaveBeenCalledTimes(3)
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

describe('usePortfolioImportExistingAssets', () => {
  beforeEach(() => { mockRead.mockReset() })

  const holding = (financialAssetKey: number, financialAssetSymbol: string, financialAssetName: string) => ({ financialAssetKey, financialAssetName, financialAssetSymbol })

  it('loads nothing until a review needs it', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImportExistingAssets(7, false), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    expect(hook.result.current).toEqual([])
    await hook.unmount(); client.clear()
  })

  it('offers each held security once, by symbol', async () => {
    mockRead.mockResolvedValueOnce({ holdings: [holding(2, 'MSFT', 'Microsoft'), holding(1, 'AAPL', 'Apple'), holding(2, 'MSFT', 'Microsoft')] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioImportExistingAssets(7, true), { wrapper })
    await waitFor(() => expect(hook.result.current).toHaveLength(2))
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/portfolio/7/holdings')
    expect(hook.result.current).toEqual([
      { financialAssetId: 1, name: 'Apple', symbol: 'AAPL' },
      { financialAssetId: 2, name: 'Microsoft', symbol: 'MSFT' },
    ])
    await hook.unmount(); client.clear()
  })
})
