import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  buildTransactionOcrFormData,
  type ConfirmTransactionOcrDraft,
  createConfirmTransactionOcrEndpoint,
  createRejectTransactionOcrEndpoint,
  freezeConfirmTransactionOcr,
  transactionOcrScanEndpoint,
  type TransactionOcrFile,
  type TransactionOcrScanDto,
} from './transaction-ocr-contract'
import { isManualTransactionAffectedQuery } from './use-create-manual-transaction'

export type TransactionOcrFailure = 'demo' | 'access' | 'mfa' | 'cancelled' | 'network' | 'validation' | 'general'

export type TransactionOcrPhase =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'review'; scan: TransactionOcrScanDto; confirmError?: TransactionOcrFailure }
  | { phase: 'confirming'; scan: TransactionOcrScanDto }
  | { phase: 'succeeded' }
  | { phase: 'error'; reason: TransactionOcrFailure }

export type ConfirmTransactionOcrInput = Omit<ConfirmTransactionOcrDraft, 'transactionOcrImportId'>

function classifyFailure(error: unknown): TransactionOcrFailure {
  if (!(error instanceof ApiError)) return 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (error.code === 'cancelled') return isPostDispatchCancellation(error) ? 'general' : 'cancelled'
  if (error.code === 'network') return 'network'
  return 'general'
}

/**
 * Mirrors web's scan -> review -> confirm/reject flow (useCreateTransactionOcr ->
 * AccountTransactionOcrContent's prefilled form -> useConfirmTransactionOcr /
 * useRejectTransactionOcr). The scan upload is the only mobile write that is not a plain JSON
 * body — the shared fetch transport passes a FormData body straight through to fetch, letting it
 * set its own multipart boundary, matching multer's `upload.single('file')` on core/api.
 */
export function useTransactionOcr() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionOcr requires an authenticated runtime')
  const queryClient = useQueryClient()
  const [state, setState] = useState<TransactionOcrPhase>({ phase: 'idle' })

  const blockOnAccessError = useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) return
    if (error.code === 'mfa-required') blockAccess('mfa-required')
  }, [blockAccess])

  const scan = useCallback(async (file: TransactionOcrFile) => {
    setState({ phase: 'scanning' })
    try {
      const result = await runtime.apiClient.write(transactionOcrScanEndpoint, {
        body: buildTransactionOcrFormData(file),
        commit: () => undefined,
      })
      setState({ phase: 'review', scan: result })
    } catch (error) {
      blockOnAccessError(error)
      setState({ phase: 'error', reason: classifyFailure(error) })
    }
  }, [blockOnAccessError, runtime])

  const confirm = useCallback(async (input: ConfirmTransactionOcrInput) => {
    if (state.phase !== 'review') return
    const { scan: activeScan } = state
    let frozen: ReturnType<typeof freezeConfirmTransactionOcr>
    try {
      frozen = freezeConfirmTransactionOcr({ ...input, transactionOcrImportId: activeScan.transactionOcrImportId })
    } catch {
      setState({ phase: 'review', scan: activeScan, confirmError: 'validation' })
      return
    }
    setState({ phase: 'confirming', scan: activeScan })
    try {
      await runtime.apiClient.write(createConfirmTransactionOcrEndpoint(frozen.transactionOcrImportId), {
        body: frozen.payload,
        commit: () => {
          void queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
        },
      })
      setState({ phase: 'succeeded' })
    } catch (error) {
      blockOnAccessError(error)
      setState({ phase: 'review', scan: activeScan, confirmError: classifyFailure(error) })
    }
  }, [blockOnAccessError, queryClient, runtime, state])

  const reject = useCallback(async (): Promise<'success' | TransactionOcrFailure> => {
    if (state.phase !== 'review') return 'general'
    try {
      await runtime.apiClient.write(createRejectTransactionOcrEndpoint(state.scan.transactionOcrImportId), { commit: () => undefined })
      setState({ phase: 'idle' })
      return 'success'
    } catch (error) {
      blockOnAccessError(error)
      return classifyFailure(error)
    }
  }, [blockOnAccessError, runtime, state])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, scan, confirm, reject, reset }
}
