import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  createBackgroundOperationEndpoint,
  createStartTransactionImportEndpoint,
  createTransactionImportUploadEndpoint,
  isTerminalTransactionImportStatus,
  type TerminalTransactionImportStatus,
} from './transaction-import-contract'
import { uploadTransactionImportFile } from './transaction-import-upload'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'

export type TransactionImportFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'network' | 'upload-failed' | 'unsupported-bank' | 'general'

export type TransactionImportPhase =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'starting' }
  | { phase: 'processing' }
  | { phase: 'done'; outcome: TerminalTransactionImportStatus }
  | { phase: 'error'; reason: TransactionImportFailure }

export type TransactionImportFile = Readonly<{ uri: string; name: string }>

const ROWS_CREATED_OUTCOMES: ReadonlySet<TerminalTransactionImportStatus> = new Set(['succeeded', 'partial'])

function classifyFailure(error: unknown): TransactionImportFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  return 'general'
}

export type UseTransactionImportOptions = Readonly<{
  pollIntervalMs?: number
  maxPollAttempts?: number
  wait?: (ms: number) => Promise<void>
}>

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Mirrors web's presigned-upload -> background-job import -> status-polling flow
 * (useCreateAccountTransactionsCsvUrl -> S3 PUT -> useStartAccountCsvImport ->
 * useBackgroundOperation). A bank-format mismatch is caught right after the presigned URL is
 * issued (the response already reports isSupportedBank), before any bytes are uploaded.
 */
export function useTransactionImport(options: UseTransactionImportOptions = {}) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionImport requires an authenticated runtime')
  const queryClient = useQueryClient()
  const [state, setState] = useState<TransactionImportPhase>({ phase: 'idle' })
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const maxPollAttempts = options.maxPollAttempts ?? 60
  const wait = options.wait ?? defaultWait

  const pollUntilTerminal = useCallback(async (correlationId: string): Promise<TerminalTransactionImportStatus> => {
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      const operation = await runtime.apiClient.read(createBackgroundOperationEndpoint(correlationId))
      if (isTerminalTransactionImportStatus(operation.status)) return operation.status
      await wait(pollIntervalMs)
    }
    throw new Error('Transaction import polling timed out')
  }, [maxPollAttempts, pollIntervalMs, runtime, wait])

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    }
    setState({ phase: 'error', reason: classifyFailure(error) })
  }, [blockAccess])

  const start = useCallback(async (accountId: number, file: TransactionImportFile) => {
    setState({ phase: 'uploading' })
    try {
      const upload = await runtime.apiClient.write(createTransactionImportUploadEndpoint(accountId), { commit: () => undefined })
      if (!upload.isSupportedBank) {
        setState({ phase: 'error', reason: 'unsupported-bank' })
        return
      }
      try {
        await uploadTransactionImportFile(file.uri, upload.presignedUrl)
      } catch {
        setState({ phase: 'error', reason: 'upload-failed' })
        return
      }

      setState({ phase: 'starting' })
      const started = await runtime.apiClient.write(createStartTransactionImportEndpoint(accountId), {
        body: { key: upload.key },
        commit: () => undefined,
      })

      setState({ phase: 'processing' })
      const outcome = isTerminalTransactionImportStatus(started.status) ? started.status : await pollUntilTerminal(started.correlationId)
      if (ROWS_CREATED_OUTCOMES.has(outcome)) {
        void queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
      }
      setState({ phase: 'done', outcome })
    } catch (error) {
      fail(error)
    }
  }, [fail, pollUntilTerminal, queryClient, runtime])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, reset }
}
