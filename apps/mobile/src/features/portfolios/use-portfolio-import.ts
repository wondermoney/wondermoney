import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import { decisionBatches, type PortfolioImportExistingAsset } from './portfolio-import-asset-review-view-model'
import {
  columnMappingWriteFromSuggestion,
  createConfirmPortfolioImportAssetMappingsEndpoint,
  createConfirmPortfolioImportColumnMappingEndpoint,
  createConfirmPortfolioImportSessionEndpoint,
  createPortfolioImportPreviewEndpoint,
  createPortfolioImportSessionEndpoint,
  createSuggestPortfolioImportColumnMappingEndpoint,
  createTriggerPortfolioImportParseEndpoint,
  type PortfolioImportAssetMappingDecision,
  type PortfolioImportPreviewDto,
  portfolioImportAssetMappingsWriteSchema,
} from './portfolio-import-contract'
import { uploadPortfolioImportFile } from './portfolio-import-upload'
import { createPortfolioHoldingsEndpoint } from './portfolios-contract'
import { isPortfolioContentQueryForEpoch, portfolioHoldingsKey } from './query-keys'
import { conservativePortfolioQueryOptions } from './query-state'

export type PortfolioImportFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'network' | 'upload-failed' | 'unmapped-columns' | 'processing-failed' | 'general'

export type PortfolioImportPhase =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'parsing' }
  | { phase: 'mapping' }
  | { phase: 'review'; preview: PortfolioImportPreviewDto }
  | { phase: 'confirming'; preview: PortfolioImportPreviewDto }
  | { phase: 'succeeded'; preview: PortfolioImportPreviewDto }
  | { phase: 'failed'; reason: PortfolioImportFailure }

export type PortfolioImportFile = Readonly<{ uri: string; name: string }>

const TERMINAL_FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled', 'expired'])
const PARSE_IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['waiting_for_upload', 'uploaded', 'parsing'])
const CONFIRM_IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['importing'])
// A file the server can read without help (WonderMoney's own CSV shape) skips column mapping and
// comes out of parsing already in one of these.
const REVIEWABLE_STATUSES: ReadonlySet<string> = new Set(['needs_asset_review', 'partial', 'ready_to_import'])

function classifyFailure(error: unknown): PortfolioImportFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  return 'general'
}

export type UsePortfolioImportOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Mirrors web's create-session -> presigned-upload -> parse -> column-mapping -> asset review ->
 * confirm flow (the API's PortfolioImportSession state machine). Deliberately auto-accepts the
 * server's suggested column mapping rather than offering manual remapping — a real,
 * separately-scoped follow-up. Confirming the mapping and the asset mappings is synchronous
 * server-side (asset matching included), so only parsing and the final import need polling.
 */
export function usePortfolioImport(portfolioId: number, options: UsePortfolioImportOptions = {}) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioImport requires an authenticated runtime')
  const queryClient = useQueryClient()
  const [state, setState] = useState<PortfolioImportPhase>({ phase: 'idle' })
  const [resolvingAssetGroups, setResolvingAssetGroups] = useState(false)
  const sessionIdRef = useRef<number | null>(null)
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const maxPollAttempts = options.maxPollAttempts ?? 60
  const wait = options.wait ?? defaultWait

  const pollUntil = useCallback(async (
    importSessionId: number,
    isDone: (preview: PortfolioImportPreviewDto) => boolean,
  ): Promise<PortfolioImportPreviewDto> => {
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      const preview = await runtime.apiClient.read(createPortfolioImportPreviewEndpoint(importSessionId))
      if (isDone(preview)) return preview
      await wait(pollIntervalMs)
    }
    throw new Error('Portfolio import polling timed out')
  }, [maxPollAttempts, pollIntervalMs, runtime, wait])

  // The suggest route is gated on the server having an AI provider (501 without one), although a
  // saved spec or the local heuristic would not need it. Without a suggestion there is nothing to
  // auto-accept, so that reads as columns this app cannot map, not as a failed request.
  const suggestColumnMapping = useCallback(async (importSessionId: number) => {
    try {
      return await runtime.apiClient.write(createSuggestPortfolioImportColumnMappingEndpoint(importSessionId), { commit: () => undefined })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'http' && error.status === 501) return null
      throw error
    }
  }, [runtime])

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    }
    setState({ phase: 'failed', reason: classifyFailure(error) })
  }, [blockAccess])

  const start = useCallback(async (file: PortfolioImportFile) => {
    setState({ phase: 'uploading' })
    try {
      const session = await runtime.apiClient.write(createPortfolioImportSessionEndpoint(portfolioId), {
        body: { mode: 'review' },
        commit: () => undefined,
      })
      sessionIdRef.current = session.importSessionId
      try {
        await uploadPortfolioImportFile(file.uri, session.uploadUrl, session.uploadHeaders)
      } catch {
        setState({ phase: 'failed', reason: 'upload-failed' })
        return
      }

      setState({ phase: 'parsing' })
      await runtime.apiClient.write(createTriggerPortfolioImportParseEndpoint(session.importSessionId), { commit: () => undefined })
      const parsed = await pollUntil(session.importSessionId, (preview) => !PARSE_IN_FLIGHT_STATUSES.has(preview.status))
      if (REVIEWABLE_STATUSES.has(parsed.status)) {
        setState({ phase: 'review', preview: parsed })
        return
      }
      if (parsed.status !== 'needs_column_mapping') {
        setState({ phase: 'failed', reason: 'processing-failed' })
        return
      }

      setState({ phase: 'mapping' })
      const suggestion = await suggestColumnMapping(session.importSessionId)
      if (!suggestion?.columnMapping) {
        setState({ phase: 'failed', reason: 'unmapped-columns' })
        return
      }
      await runtime.apiClient.write(createConfirmPortfolioImportColumnMappingEndpoint(session.importSessionId), {
        body: columnMappingWriteFromSuggestion(suggestion.columnMapping),
        commit: () => undefined,
      })
      const preview = await runtime.apiClient.read(createPortfolioImportPreviewEndpoint(session.importSessionId))
      if (TERMINAL_FAILURE_STATUSES.has(preview.status)) {
        setState({ phase: 'failed', reason: 'processing-failed' })
        return
      }
      setState({ phase: 'review', preview })
    } catch (error) {
      fail(error)
    }
  }, [fail, pollUntil, portfolioId, runtime, suggestColumnMapping])

  const confirm = useCallback(async () => {
    const importSessionId = sessionIdRef.current
    if (importSessionId === null || state.phase !== 'review') return
    setState({ phase: 'confirming', preview: state.preview })
    try {
      await runtime.apiClient.write(createConfirmPortfolioImportSessionEndpoint(importSessionId), { commit: () => undefined })
      const final = await pollUntil(importSessionId, (preview) => !CONFIRM_IN_FLIGHT_STATUSES.has(preview.status))
      // `partial` committed some rows and failed others; the rows that failed ride along in
      // `rows.failed` for the result screen, and the imported ones must still refresh the portfolio.
      if (final.status === 'succeeded' || final.status === 'partial') {
        void queryClient.invalidateQueries({ predicate: (query) => isPortfolioContentQueryForEpoch(query.queryKey, runtime.epochId) })
        setState({ phase: 'succeeded', preview: final })
      } else {
        setState({ phase: 'failed', reason: 'processing-failed' })
      }
    } catch (error) {
      fail(error)
    }
  }, [fail, pollUntil, queryClient, runtime, state])

  /**
   * Sends every group's decision (a suggested listing, a ticker searched by hand, a holding already
   * in the portfolio, or a skip) in requests of at most the API's 100, then refetches the preview
   * so summary.canConfirm reflects the now-resolved groups. Only callable from the review phase; a
   * stale/absent session id or an empty list is a no-op rather than a request.
   */
  const resolveAssetGroups = useCallback(async (decisions: readonly PortfolioImportAssetMappingDecision[]) => {
    const importSessionId = sessionIdRef.current
    if (importSessionId === null || state.phase !== 'review' || decisions.length === 0) return
    setResolvingAssetGroups(true)
    try {
      for (const batch of decisionBatches(decisions)) {
        await runtime.apiClient.write(createConfirmPortfolioImportAssetMappingsEndpoint(importSessionId), {
          body: portfolioImportAssetMappingsWriteSchema.parse({ decisions: batch }),
          commit: () => undefined,
        })
      }
      const preview = await runtime.apiClient.read(createPortfolioImportPreviewEndpoint(importSessionId))
      if (TERMINAL_FAILURE_STATUSES.has(preview.status)) {
        setState({ phase: 'failed', reason: 'processing-failed' })
        return
      }
      setState({ phase: 'review', preview })
    } catch (error) {
      fail(error)
    } finally {
      setResolvingAssetGroups(false)
    }
  }, [fail, runtime, state])

  const reset = useCallback(() => {
    sessionIdRef.current = null
    setState({ phase: 'idle' })
  }, [])

  return { state, start, confirm, reset, resolveAssetGroups, resolvingAssetGroups }
}

/**
 * The portfolio's holdings as asset-review targets ("use an asset already in this portfolio"),
 * one per security, by symbol. Loaded only while a review needs them; a failed load just leaves
 * the option out.
 */
export function usePortfolioImportExistingAssets(portfolioId: number, enabled: boolean): readonly PortfolioImportExistingAsset[] {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('usePortfolioImportExistingAssets requires an authenticated runtime')
  const holdings = useQuery({
    queryKey: portfolioHoldingsKey(runtime.epochId, portfolioId),
    queryFn: () => runtime.apiClient.read(createPortfolioHoldingsEndpoint(portfolioId)),
    enabled,
    ...conservativePortfolioQueryOptions,
  })
  return useMemo(() => {
    const byAsset = new Map<number, PortfolioImportExistingAsset>()
    for (const holding of holdings.data?.holdings ?? []) {
      if (!byAsset.has(holding.financialAssetKey)) {
        byAsset.set(holding.financialAssetKey, { financialAssetId: holding.financialAssetKey, name: holding.financialAssetName, symbol: holding.financialAssetSymbol })
      }
    }
    return [...byAsset.values()].sort((left, right) => left.symbol.localeCompare(right.symbol))
  }, [holdings.data])
}
