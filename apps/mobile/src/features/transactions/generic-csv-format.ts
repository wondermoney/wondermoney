import Papa from 'papaparse'

import type { CsvImportFormat } from '../accounts/accounts-contract'
import type { ImportRowCounts } from './transaction-import-contract'

/**
 * The generic CSV format the API reads for an account whose bank has no statement parser
 * (`AccountCsvImportService.importAccountCsv` without a bank name). The header names are fixed and
 * the API rejects any other column, so the template carries exactly these. Same spec as web's
 * lib/account/account-csv-generic-format.ts (apps never share source, so it is restated here).
 */
export const GENERIC_CSV_COLUMNS = [
  'date',
  'amount',
  'merchant',
  'internalTransactionId',
  'transactionTypeKey',
  'description',
] as const

export type GenericCsvColumn = typeof GENERIC_CSV_COLUMNS[number]

export const GENERIC_CSV_OPTIONAL_COLUMNS: ReadonlySet<GenericCsvColumn> = new Set<GenericCsvColumn>(['description'])

export const GENERIC_CSV_TEMPLATE_FILENAME = 'transactions-template.csv'

type TemplateTransactionType = Readonly<{ transactionTypeKey: number; name: string }>

/**
 * A template with the header and, when the instance's transaction types are known, one money-out
 * and one money-in example row using their real type codes. Starts with a BOM so spreadsheet apps
 * read it as UTF-8, as web's download does.
 */
export function buildGenericCsvTemplate(transactionTypes: readonly TemplateTransactionType[] = []): string {
  const keyOf = (name: string) => transactionTypes.find((type) => type.name === name)?.transactionTypeKey
  const examples: Record<GenericCsvColumn, string>[] = []
  const payment = keyOf('PAYMENT')
  const deposit = keyOf('DEPOSIT')
  if (payment !== undefined) {
    examples.push({ date: '2026-01-15', amount: '23.40', merchant: 'Grocery store', internalTransactionId: 'example-1', transactionTypeKey: String(payment), description: 'Weekly shop' })
  }
  if (deposit !== undefined) {
    examples.push({ date: '2026-01-31', amount: '1500.00', merchant: 'Employer', internalTransactionId: 'example-2', transactionTypeKey: String(deposit), description: 'Salary' })
  }
  return '﻿' + Papa.unparse(
    { fields: [...GENERIC_CSV_COLUMNS], data: examples.map((row) => GENERIC_CSV_COLUMNS.map((column) => row[column])) },
    { newline: '\n' },
  )
}

export const isCsvFileName = (name: string) => /\.csv$/i.test(name.trim())

/**
 * The flow the import screen offers for an account. `legacy` is an older API that doesn't
 * report a format: the screen shows the old bank-statement copy and the upload response's
 * `isSupportedBank` decides.
 */
export type TransactionImportFlow = CsvImportFormat | 'legacy'

export function importFlowForAccount(format: CsvImportFormat | null | undefined): TransactionImportFlow {
  return format ?? 'legacy'
}

/** What the upload response says to do with the file: import it in a format, or stop. */
export type UploadDecision =
  | { action: 'import'; format: 'bank' | 'generic' }
  | { action: 'stop'; reason: 'unsupported-bank' | 'unknown-format' }

export function decideUpload(upload: Readonly<{ csvImportFormat?: CsvImportFormat; isSupportedBank: boolean }>): UploadDecision {
  switch (upload.csvImportFormat) {
    case 'bank':
    case 'generic':
      return { action: 'import', format: upload.csvImportFormat }
    case 'unknown':
      return { action: 'stop', reason: 'unknown-format' }
    case undefined:
      return upload.isSupportedBank ? { action: 'import', format: 'bank' } : { action: 'stop', reason: 'unsupported-bank' }
  }
}

/**
 * The "{failed} of {total} rows couldn't be imported" counts, shown (as on web) for a generic
 * import that ended partial or failed with at least one rejected row.
 */
export function rowsFailedCounts(
  format: 'bank' | 'generic',
  outcome: string,
  rows: ImportRowCounts | null,
): ImportRowCounts | null {
  if (format !== 'generic' || (outcome !== 'partial' && outcome !== 'failed')) return null
  return rows && rows.failed > 0 ? rows : null
}
