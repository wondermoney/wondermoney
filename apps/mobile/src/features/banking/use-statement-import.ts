import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { accountKey, accountsKey } from '@/features/accounts/query-keys'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  createStatementImportSessionEndpoint,
  createStatementImportStatusEndpoint,
  createTriggerStatementImportEndpoint,
  type StatementImportStatusDto,
  type StatementImportSummary,
} from './statement-import-contract'
import { uploadStatementImportFile } from './statement-import-upload'

export type StatementImportFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'network' | 'upload-failed' | 'processing-failed' | 'general'

export type StatementImportPhase =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'processing' }
  | { phase: 'succeeded'; summary: StatementImportSummary | undefined }
  | { phase: 'failed'; reason: StatementImportFailure }

export type StatementImportFile = Readonly<{ uri: string; name: string }>

const TERMINAL_FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled', 'expired'])
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['waiting_for_upload', 'uploaded', 'parsing', 'importing'])
const SUCCESS_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'partial'])

function classifyFailure(error: unknown): StatementImportFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  return 'general'
}

export type UseStatementImportOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Upload -> trigger parse+import -> poll until terminal. Simpler
 * than usePortfolioImport by design: no column-mapping or asset-review
 * step (see statement-import-contract.ts for why), so there is nothing to
 * separately confirm — the server runs parse and import as one background
 * job once /parse is triggered.
 */
export function useStatementImport(options: UseStatementImportOptions = {}) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useStatementImport requires an authenticated runtime')
  const queryClient = useQueryClient()
  const [state, setState] = useState<StatementImportPhase>({ phase: 'idle' })
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const maxPollAttempts = options.maxPollAttempts ?? 60
  const wait = options.wait ?? defaultWait

  const pollUntil = useCallback(async (
    importSessionId: number,
    isDone: (status: StatementImportStatusDto) => boolean,
  ): Promise<StatementImportStatusDto> => {
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      const status = await runtime.apiClient.read(createStatementImportStatusEndpoint(importSessionId))
      if (isDone(status)) return status
      await wait(pollIntervalMs)
    }
    throw new Error('Statement import polling timed out')
  }, [maxPollAttempts, pollIntervalMs, runtime, wait])

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    }
    setState({ phase: 'failed', reason: classifyFailure(error) })
  }, [blockAccess])

  const start = useCallback(async (accountId: number, file: StatementImportFile) => {
    setState({ phase: 'uploading' })
    try {
      const session = await runtime.apiClient.write(createStatementImportSessionEndpoint(accountId), { commit: () => undefined })
      try {
        await uploadStatementImportFile(file.uri, session.uploadUrl, session.uploadHeaders)
      } catch {
        setState({ phase: 'failed', reason: 'upload-failed' })
        return
      }

      setState({ phase: 'processing' })
      await runtime.apiClient.write(createTriggerStatementImportEndpoint(session.importSessionId), { commit: () => undefined })
      const final = await pollUntil(session.importSessionId, (status) => !IN_FLIGHT_STATUSES.has(status.status))
      if (TERMINAL_FAILURE_STATUSES.has(final.status) || !SUCCESS_STATUSES.has(final.status)) {
        setState({ phase: 'failed', reason: 'processing-failed' })
        return
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true }),
        queryClient.invalidateQueries({ queryKey: accountKey(runtime.epochId, accountId), exact: true }),
      ])
      setState({ phase: 'succeeded', summary: final.summary })
    } catch (error) {
      fail(error)
    }
  }, [fail, pollUntil, queryClient, runtime])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, reset }
}
