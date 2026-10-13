import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

import { isValidAccountId } from '../accounts/accounts-contract'

/** Mirrors web's core/api background-operation status vocabulary
 * (lib/api/background-operation/backgroundOperation.ts): queued/running are in-flight, the rest
 * are terminal outcomes the caller must render distinctly. */
export const TERMINAL_TRANSACTION_IMPORT_STATUSES = ['succeeded', 'partial', 'failed', 'needs_action', 'stale'] as const
export type TerminalTransactionImportStatus = typeof TERMINAL_TRANSACTION_IMPORT_STATUSES[number]

export function isTerminalTransactionImportStatus(status: string): status is TerminalTransactionImportStatus {
  return (TERMINAL_TRANSACTION_IMPORT_STATUSES as readonly string[]).includes(status)
}

const uploadResponseSchema = z.object({
  key: z.string().min(1),
  presignedUrl: z.string().min(1),
  isSupportedBank: z.boolean(),
}).strict()
export type TransactionImportUploadDto = z.infer<typeof uploadResponseSchema>

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
}).strict()
export type StartTransactionImportDto = z.infer<typeof startImportResponseSchema>

export function createStartTransactionImportEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/transaction/import`,
    schema: startImportResponseSchema,
  })
}

export type StartTransactionImportPayload = Readonly<{ key: string }>

const backgroundOperationResponseSchema = z.object({
  correlationId: z.string().min(1),
  progress: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string().min(1),
}).strict()
export type BackgroundOperationDto = z.infer<typeof backgroundOperationResponseSchema>

export function createBackgroundOperationEndpoint(correlationId: string) {
  const normalized = correlationId.trim()
  if (!normalized) throw new Error('A non-empty correlation id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/operations/${encodeURIComponent(normalized)}`,
    schema: backgroundOperationResponseSchema,
  })
}
