import { z } from 'zod'

import { isValidAccountId } from '@/features/accounts/accounts-contract'
import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * CSV/statement import as a bank-sync failure fallback. Web's
 * `BankAccountSyncStatusBanner.tsx` offers `onImportStatement` alongside
 * retry/add-manually when a bank sync fails. This endpoint set is modeled on
 * the portfolio broker-import session (portfolio-import-contract.ts) —
 * scoped per account instead of per portfolio, and deliberately simpler:
 * a bank statement has a fixed date/description/amount shape the server
 * detects itself ("bank-format detection"), so there is no column-mapping
 * or asset-review step to model, only upload -> parse+import -> poll.
 */

const STATEMENT_IMPORT_STATUSES = [
  'cancelled', 'expired', 'failed', 'importing', 'parsing', 'partial', 'succeeded', 'uploaded', 'waiting_for_upload',
] as const
// A status this build doesn't know reads as 'unknown': not in flight and not a success, so polling
// stops on the generic failure screen instead of an invalid-response error.
const statementImportStatusSchema = tolerantEnum(STATEMENT_IMPORT_STATUSES, 'unknown')

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
})

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
})

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
})
export type StatementImportSummary = z.infer<typeof statementImportSummarySchema>

const statementImportStatusResponseSchema = z.object({
  importSessionId: z.number().int().positive(),
  status: statementImportStatusSchema,
  // Absent while parsing/importing is still in flight; present once terminal.
  summary: statementImportSummarySchema.optional(),
})
export type StatementImportStatusDto = z.infer<typeof statementImportStatusResponseSchema>

export function createStatementImportStatusEndpoint(importSessionId: number) {
  return readEndpoint({
    method: 'GET',
    path: importSessionPath(importSessionId),
    schema: statementImportStatusResponseSchema,
  })
}
