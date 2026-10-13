import { z } from 'zod'

import { isValidAccountId } from '@/features/accounts/accounts-contract'
import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * RAD-502 — CSV/statement import as a bank-sync failure fallback. Web's
 * `BankAccountSyncStatusBanner.tsx` offers `onImportStatement` alongside
 * retry/add-manually when a GoCardless sync fails; RAD-503 (a separate,
 * still-Backlog ticket under RAD-196) owns the full per-account transaction
 * CSV/XLS/XLSX import surface (`AccountTransactionImportModal.tsx`:
 * presigned-URL upload -> background-job import -> bank-format detection ->
 * status polling). Neither web component could be read directly (missing
 * from the local web-bak snapshot), so this endpoint set is modeled on the
 * only presigned-upload state machine already proven in this codebase —
 * the portfolio broker-import session (portfolio-import-contract.ts) —
 * scoped per account instead of per portfolio, and deliberately simpler:
 * a bank statement has a fixed date/description/amount shape the server
 * detects itself ("bank-format detection"), so there is no column-mapping
 * or asset-review step to model, only upload -> parse+import -> poll.
 */

const STATEMENT_IMPORT_STATUSES = [
  'cancelled', 'expired', 'failed', 'importing', 'parsing', 'partial', 'succeeded', 'uploaded', 'waiting_for_upload',
] as const
export type StatementImportStatus = typeof STATEMENT_IMPORT_STATUSES[number]
const statementImportStatusSchema = z.enum(STATEMENT_IMPORT_STATUSES)

function importSessionPath(importSessionId: number, suffix = ''): string {
  if (!Number.isSafeInteger(importSessionId) || importSessionId <= 0) throw new Error('A positive safe import session id is required.')
  return `/v1/banking/statement-imports/${importSessionId}${suffix}`
}

export const statementImportSessionCreateResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  maxUploadSizeBytes: z.number().int().positive(),
  status: statementImportStatusSchema,
  uploadHeaders: z.record(z.string(), z.string()),
  uploadMethod: z.literal('PUT'),
  uploadUrl: z.string(),
}).strict()
export type StatementImportSessionCreateResponseDto = z.infer<typeof statementImportSessionCreateResponseSchema>

export function createStatementImportSessionEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/statement-imports`,
    schema: statementImportSessionCreateResponseSchema,
    successStatuses: [201],
  })
}

const triggerStatementImportResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: statementImportStatusSchema,
}).strict()

export function createTriggerStatementImportEndpoint(importSessionId: number) {
  return writeEndpoint({
    method: 'POST',
    path: importSessionPath(importSessionId, '/parse'),
    schema: triggerStatementImportResponseSchema,
    successStatuses: [202],
  })
}

export const statementImportSummarySchema = z.object({
  duplicateRows: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
}).strict()
export type StatementImportSummary = z.infer<typeof statementImportSummarySchema>

const statementImportStatusResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: statementImportStatusSchema,
  // Absent while parsing/importing is still in flight; present once terminal.
  summary: statementImportSummarySchema.optional(),
}).strict()
export type StatementImportStatusDto = z.infer<typeof statementImportStatusResponseSchema>

export function createStatementImportStatusEndpoint(importSessionId: number) {
  return readEndpoint({
    method: 'GET',
    path: importSessionPath(importSessionId),
    schema: statementImportStatusResponseSchema,
  })
}
