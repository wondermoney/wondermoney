import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  buildCreateTransactionImportSessionBody,
  createTransactionImportSessionEndpoint,
  createTransactionImportUploadEndpoint,
  type TransactionImportSessionDto,
} from './transaction-import-contract'
import { decideUpload, isCamtFileName, isCsvFileName, isOfxFileName, isQifFileName } from './generic-csv-format'
import { uploadTransactionImportFile } from './transaction-import-upload'

export type TransactionImportFailure = 'demo' | 'read-only' | 'access' | 'mfa' | 'cancelled' | 'network' | 'conflict' | 'upload-failed' | 'unsupported-bank' | 'unknown-format' | 'csv-only' | 'general'

export type TransactionImportPhase =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'starting' }
  | { phase: 'staged'; session: TransactionImportSessionDto }
  | { phase: 'error'; reason: TransactionImportFailure }

export type TransactionImportFile = Readonly<{ uri: string; name: string }>

/** How a failed import request reads to the person. A demo profile is read-only: its writes come back `demo-forbidden`. */
export function classifyTransactionImportFailure(error: unknown): TransactionImportFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  // The session moved on under the request (it expired, or a commit already started).
  if (error.code === 'http' && error.status === 409) return 'conflict'
  return 'general'
}

/**
 * Mirrors web's import dialog up to its review: presigned upload (useCreateAccountTransactionsCsvUrl
 * -> S3 PUT), then the file staged as a session (useCreateTransactionImport), which reads it into
 * rows and waits. Nothing is written to the account until the person commits from the review.
 * The upload response says which format the account reads: a bank's own export or the generic
 * CSV. An unknown format, an unsupported bank on an API that does not report the format, or a
 * file the generic format can't read stops before any bytes are uploaded.
 */
export function useTransactionImport() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionImport requires an authenticated runtime')
  const [state, setState] = useState<TransactionImportPhase>({ phase: 'idle' })

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    setState({ phase: 'error', reason: classifyTransactionImportFailure(error) })
  }, [blockAccess])

  /** Resolves with the staged session, or `null` when the import stopped (the state says why). */
  const start = useCallback(async (accountId: number, file: TransactionImportFile): Promise<TransactionImportSessionDto | null> => {
    setState({ phase: 'uploading' })
    try {
      const upload = await runtime.apiClient.write(createTransactionImportUploadEndpoint(accountId), { commit: () => undefined })
      const decision = decideUpload(upload)
      if (decision.action === 'stop') {
        setState({ phase: 'error', reason: decision.reason })
        return null
      }
      if (decision.format === 'generic' && !isCsvFileName(file.name) && !isOfxFileName(file.name) && !isQifFileName(file.name) && !isCamtFileName(file.name)) {
        setState({ phase: 'error', reason: 'csv-only' })
        return null
      }
      try {
        await uploadTransactionImportFile(file.uri, upload.presignedUrl)
      } catch {
        setState({ phase: 'error', reason: 'upload-failed' })
        return null
      }

      setState({ phase: 'starting' })
      const { session } = await runtime.apiClient.write(createTransactionImportSessionEndpoint, {
        body: buildCreateTransactionImportSessionBody({ accountId, fileName: file.name, key: upload.key }),
        commit: () => undefined,
      })
      setState({ phase: 'staged', session })
      return session
    } catch (error) {
      fail(error)
      return null
    }
  }, [fail, runtime])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, reset }
}
