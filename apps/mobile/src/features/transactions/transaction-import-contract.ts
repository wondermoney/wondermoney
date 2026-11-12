import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

import { csvImportFormatSchema, isValidAccountId } from '../accounts/accounts-contract'
import { isCamtFileName, isOfxFileName, isQifFileName } from './generic-csv-format'

// csvImportFormat: see accounts-contract. On an older API it is missing and
// isSupportedBank decides, as it did before.
const uploadResponseSchema = z.object({
  key: z.string().min(1),
  presignedUrl: z.string().min(1),
  isSupportedBank: z.boolean(),
  csvImportFormat: csvImportFormatSchema.optional(),
})

/** The presigned upload the file goes to before a session reads it (web's useCreateAccountTransactionsCsvUrl). */
export function createTransactionImportUploadEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/transaction/upload`,
    schema: uploadResponseSchema,
  })
}

/*
 * Staged imports (`/v1/transaction-import-sessions`, the API's transaction-import service): the
 * uploaded file is read into rows, each classified against the account; the person includes or
 * skips them; only the commit writes transactions. The vocabulary mirrors
 * `packages/shared/lib/import/types.ts`, which the app reads only over HTTP.
 */

export const TRANSACTION_IMPORT_ROW_STATUSES = ['new', 'duplicate', 'possible_duplicate', 'invalid', 'skipped', 'imported', 'failed'] as const
export type KnownTransactionImportRowStatus = typeof TRANSACTION_IMPORT_ROW_STATUSES[number]

export const TRANSACTION_IMPORT_SESSION_STATUSES = ['waiting_for_upload', 'parsing', 'needs_mapping', 'ready', 'importing', 'succeeded', 'partial', 'failed', 'cancelled', 'expired'] as const

export type TransactionImportDecision = 'import' | 'skip'

/** How the session reads a file, by its name, as web's import dialog picks it. `statement` also recognises OFX, QIF, CAMT.053 and the generic CSV template by their content. */
export type TransactionImportFileFormat = 'statement' | 'ofx' | 'qif' | 'camt053'

export function importFormatForFileName(name: string): TransactionImportFileFormat {
  if (isOfxFileName(name)) return 'ofx'
  if (isQifFileName(name)) return 'qif'
  if (isCamtFileName(name)) return 'camt053'
  return 'statement'
}

/** The API's `importFileNameInput` bound; it cleans and shortens the name itself. */
const MAX_FILE_NAME_LENGTH = 2048

export type CreateTransactionImportSessionBody = Readonly<{
  accountId: number
  fileName?: string
  format: TransactionImportFileFormat
  key: string
}>

/**
 * The file, uploaded for `accountId`, staged as a session that waits for review: no `autoCommit`
 * (that is the one-step import), so nothing is written until the person commits. The name it
 * had on the device stays with the import's history.
 */
export function buildCreateTransactionImportSessionBody(input: Readonly<{ accountId: number; fileName: string; key: string }>): CreateTransactionImportSessionBody {
  const fileName = input.fileName.trim().slice(0, MAX_FILE_NAME_LENGTH)
  return {
    accountId: input.accountId,
    ...(fileName ? { fileName } : {}),
    format: importFormatForFileName(input.fileName),
    key: input.key,
  }
}

const count = z.number().catch(0).transform((value) => (Number.isInteger(value) && value >= 0 ? value : 0))
/** A missing or newer field reads as absent rather than failing the session. */
const nullableString = z.string().nullish().transform((value) => value ?? null)

const rowCountsSchema = z.record(z.string(), z.unknown()).transform((raw) => Object.fromEntries(
  TRANSACTION_IMPORT_ROW_STATUSES.map((status) => [status, count.parse(raw[status])]),
) as Record<KnownTransactionImportRowStatus, number>)

const decisionSchema = tolerantEnum(['import', 'skip'], null).nullable()

const sessionSchema = z.object({
  accountId: z.number().int().nullable(),
  accountMapping: z.record(z.string(), z.number()).catch({}),
  canCommit: z.boolean(),
  canRetry: z.boolean(),
  committedAt: nullableString,
  counts: rowCountsSchema,
  createdAt: z.string(),
  decisions: z.object({ import: count, skip: count }),
  detailsDeletedAt: nullableString,
  errorCode: nullableString,
  expiresAt: z.string(),
  fileName: nullableString,
  /** How the session reads the file; `ynab` and `actual` (a YNAB or Actual Budget export) need a category step the app does not have. */
  format: z.string().catch('statement'),
  id: z.string().min(1),
  sourceAccounts: z.array(z.object({
    currency: z.string().optional(),
    label: z.string(),
    rowCount: count,
    suggestedAccountId: z.number().int().optional(),
  })).catch([]),
  /** The categories the file uses, for a format whose categories the session maps (YNAB, Actual Budget); only their number matters here. */
  sourceCategories: z.array(z.object({ label: z.string() })).catch([]).optional().transform((value) => value ?? []),
  status: tolerantEnum(TRANSACTION_IMPORT_SESSION_STATUSES, 'unknown'),
  warnings: z.array(z.object({ code: z.string(), detail: z.string().optional(), sourceRow: z.number().optional() })).catch([]),
})
export type TransactionImportSessionDto = z.infer<typeof sessionSchema>
export type TransactionImportSessionStatus = TransactionImportSessionDto['status']

const rowSchema = z.object({
  decision: decisionSchema,
  error: nullableString,
  id: z.number().int(),
  normalized: z.object({
    amount: z.number(),
    currency: z.string().optional(),
    date: z.string(),
    description: z.string(),
    merchant: z.string().optional(),
  }).nullable(),
  sourceRow: z.number().int(),
  status: tolerantEnum(TRANSACTION_IMPORT_ROW_STATUSES, 'unknown'),
})
export type TransactionImportRowDto = z.infer<typeof rowSchema>
export type TransactionImportRowStatus = TransactionImportRowDto['status']

const viewSchema = z.object({
  rows: z.object({ items: z.array(rowSchema), page: z.number().int(), pageSize: z.number().int(), total: count }),
  session: sessionSchema,
})
export type TransactionImportViewDto = z.infer<typeof viewSchema>

const sessionResponseSchema = z.object({ session: sessionSchema })

const SESSIONS_PATH = '/v1/transaction-import-sessions'
const SESSION_ID = /^[0-9a-f-]{36}$/i

function sessionPath(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error('A transaction import session id is required.')
  return `${SESSIONS_PATH}/${id}`
}

export const createTransactionImportSessionEndpoint = writeEndpoint({
  method: 'POST',
  path: SESSIONS_PATH,
  schema: sessionResponseSchema,
})

export type TransactionImportRowQuery = Readonly<{ page: number; pageSize: number; status?: KnownTransactionImportRowStatus }>

/** The summary, and one page of rows (all of them, or one status). */
export function readTransactionImportSessionEndpoint(id: string, query: TransactionImportRowQuery) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.status) params.set('status', query.status)
  return readEndpoint({ method: 'GET', path: `${sessionPath(id)}?${params.toString()}`, schema: viewSchema })
}

/** Body: `{ decision, rowIds }` or `{ decision, status }`. Rows that cannot import are left alone. */
export const createDecideTransactionImportRowsEndpoint = (id: string) => writeEndpoint({ method: 'PATCH', path: `${sessionPath(id)}/rows`, schema: sessionResponseSchema })
/** Body: `{ mapping }`, the file's account labels to account ids. */
export const createMapTransactionImportAccountsEndpoint = (id: string) => writeEndpoint({ method: 'PATCH', path: `${sessionPath(id)}/account-mapping`, schema: sessionResponseSchema })
/** Read the file again, with corrected options (a QIF file's date order), or after the read stopped. */
export const createParseTransactionImportEndpoint = (id: string) => writeEndpoint({ method: 'POST', path: `${sessionPath(id)}/parse`, schema: sessionResponseSchema })
/** Write the rows decided `import`, in the background. Asked again after its job stopped, it resumes. */
export const createCommitTransactionImportEndpoint = (id: string) => writeEndpoint({ method: 'POST', path: `${sessionPath(id)}/commit`, schema: sessionResponseSchema })
export const createCancelTransactionImportEndpoint = (id: string) => writeEndpoint({ method: 'POST', path: `${sessionPath(id)}/cancel`, schema: sessionResponseSchema })
