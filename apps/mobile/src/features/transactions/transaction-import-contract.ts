import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

import { csvImportFormatSchema, isValidAccountId } from '../accounts/accounts-contract'

/** Mirrors web's core/api background-operation status vocabulary
 * (lib/api/background-operation/backgroundOperation.ts): queued/running are in-flight, the rest
 * are terminal outcomes the caller must render distinctly. */
export const TERMINAL_TRANSACTION_IMPORT_STATUSES = ['succeeded', 'partial', 'failed', 'needs_action', 'stale'] as const
export type TerminalTransactionImportStatus = typeof TERMINAL_TRANSACTION_IMPORT_STATUSES[number]

export function isTerminalTransactionImportStatus(status: string): status is TerminalTransactionImportStatus {
  return (TERMINAL_TRANSACTION_IMPORT_STATUSES as readonly string[]).includes(status)
}

// csvImportFormat: see accounts-contract. On an API from before #182 it is missing and
// isSupportedBank decides, as it did before.
const uploadResponseSchema = z.object({
  key: z.string().min(1),
  presignedUrl: z.string().min(1),
  isSupportedBank: z.boolean(),
  csvImportFormat: csvImportFormatSchema.optional(),
})

export function createTransactionImportUploadEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/transaction/upload`,
    schema: uploadResponseSchema,
  })
}

const startImportResponseSchema = z.object({
  correlationId: z.string().min(1),
  status: z.string().min(1),
})

export function createStartTransactionImportEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/transaction/import`,
    schema: startImportResponseSchema,
  })
}

const backgroundOperationResponseSchema = z.object({
  correlationId: z.string().min(1),
  progress: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string().min(1),
})
export type BackgroundOperationDto = z.infer<typeof backgroundOperationResponseSchema>

export type ImportRowCounts = Readonly<{ failed: number; total: number }>

/** The worker's row counts (`progress.failed`, `progress.totalRows`), when it reports both. */
export function readImportRowCounts(progress: BackgroundOperationDto['progress']): ImportRowCounts | null {
  const failed = progress?.failed
  const total = progress?.totalRows
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
  return isCount(failed) && isCount(total) ? { failed, total } : null
}

export function createBackgroundOperationEndpoint(correlationId: string) {
  const normalized = correlationId.trim()
  if (!normalized) throw new Error('A non-empty correlation id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/operations/${encodeURIComponent(normalized)}`,
    schema: backgroundOperationResponseSchema,
  })
}
