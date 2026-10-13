import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  createConfirmPortfolioImportAssetGroupsEndpoint,
  createConfirmPortfolioImportColumnMappingEndpoint,
  createConfirmPortfolioImportSessionEndpoint,
  createPortfolioImportPreviewEndpoint,
  createPortfolioImportSessionEndpoint,
  createSuggestPortfolioImportColumnMappingEndpoint,
  createTriggerPortfolioImportParseEndpoint,
  type PortfolioImportAssetGroupResolution,
  type PortfolioImportPreviewDto,
} from './portfolio-import-contract'
import { uploadPortfolioImportFile } from './portfolio-import-upload'
import { isPortfolioContentQueryForEpoch } from './query-keys'

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

function classifyFailure(error: unknown): PortfolioImportFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  return 'general'
}

export type PortfolioImportAssetGroupMapping = Readonly<{ assetGroupId: number; resolution: PortfolioImportAssetGroupResolution }>

export type UsePortfolioImportOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Mirrors web's create-session -> presigned-upload -> parse -> column-mapping -> confirm flow
 * (core/api's PortfolioImportSession state machine). Deliberately auto-accepts the server's
 * suggested column mapping rather than offering manual remapping — a real, separately-scoped
 * follow-up. confirmColumnMapping is synchronous server-side (asset matching included), so only
 * the post-parse "needs_column_mapping" wait requires polling.
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
      if (parsed.status !== 'needs_column_mapping') {
        setState({ phase: 'failed', reason: 'processing-failed' })
        return
      }

      setState({ phase: 'mapping' })
      const suggestion = await runtime.apiClient.write(createSuggestPortfolioImportColumnMappingEndpoint(session.importSessionId), { commit: () => undefined })
      if (!suggestion.columnMapping) {
        setState({ phase: 'failed', reason: 'unmapped-columns' })
        return
      }
      await runtime.apiClient.write(createConfirmPortfolioImportColumnMappingEndpoint(session.importSessionId), {
        body: { columnMapping: suggestion.columnMapping },
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
  }, [fail, pollUntil, portfolioId, runtime])

  const confirm = useCallback(async () => {
    const importSessionId = sessionIdRef.current
    if (importSessionId === null || state.phase !== 'review') return
    setState({ phase: 'confirming', preview: state.preview })
    try {
      await runtime.apiClient.write(createConfirmPortfolioImportSessionEndpoint(importSessionId), { commit: () => undefined })
      const final = await pollUntil(importSessionId, (preview) => !CONFIRM_IN_FLIGHT_STATUSES.has(preview.status))
      if (final.status === 'succeeded') {
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
   * RAD-514 — submits every group's resolution (a server-suggested candidate accepted as-is, a
   * different ticker searched and picked by hand, or an explicit skip) in one batch, then refetches
   * the preview so summary.canConfirm reflects the now-resolved groups. Only callable from the
   * review phase; a stale/absent session id or an empty batch is a no-op rather than a request.
   */
  const resolveAssetGroups = useCallback(async (mappings: readonly PortfolioImportAssetGroupMapping[]) => {
    const importSessionId = sessionIdRef.current
    if (importSessionId === null || state.phase !== 'review' || mappings.length === 0) return
    setResolvingAssetGroups(true)
    try {
      await runtime.apiClient.write(createConfirmPortfolioImportAssetGroupsEndpoint(importSessionId), {
        body: { mappings },
        commit: () => undefined,
      })
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
