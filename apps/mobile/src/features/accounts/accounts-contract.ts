import { z } from 'zod'

import { fxRateDateSchema, fxStatusSchema } from '../../lib/api/fx-status'
import { readEndpoint, tolerantEnum, writeEndpoint } from '../../lib/api/runtime-schema'

const currencySchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
})

const emptyWriteResponseSchema = z.undefined()

// A source this build doesn't know reads as 'unknown' ("Other source") instead of failing the
// whole accounts list.
export const accountSourceSchema = tolerantEnum(['manual', 'open_banking'], 'unknown')

/**
 * Which file an account's CSV import reads: `bank` is the bank's own statement export,
 * `generic` the fixed-column format in transactions/generic-csv-format.ts. A value this build
 * doesn't know reads as `unknown`, which the import screen answers with a safe message instead of
 * guessing a format. It is optional because an older API doesn't send it.
 */
export const csvImportFormatSchema = tolerantEnum(['bank', 'generic'], 'unknown')
export type CsvImportFormat = z.infer<typeof csvImportFormatSchema>

export const syncStalenessSchema = tolerantEnum(['fresh', 'stale', 'very_stale', 'error'], 'unknown')

/** Sync freshness for an open-banking account (web `SyncStatus`). */
export const syncStatusSchema = z.object({
  staleness: syncStalenessSchema,
  lastSyncedAt: z.iso.datetime().nullish().catch(null),
})

/**
 * A credit card's cycle and limit. Optional and lenient on read: an older API does not send it,
 * and a malformed one must not fail the whole accounts list.
 */
export const creditCardSettingsSchema = z.object({
  statementCloseDay: z.number().int().min(1).max(31),
  paymentDueDay: z.number().int().min(1).max(31),
  creditLimit: z.number().finite().nullish().catch(null),
  minimumPaymentPercent: z.number().finite().nullish().catch(null),
})

export type CreditCardSettingsDto = z.infer<typeof creditCardSettingsSchema>

export const accountSummarySchema = z.object({
  accountFinancialInstitutionKey: z.object({
    displayName: z.string().max(255).nullable(),
    logoUrl: z.string().nullable(),
  }).nullable(),
  accountKey: z.number().int().positive(),
  accountName: z.string().max(255).nullable(),
  accountOwnerAppuserKey: z.object({
    currencyKey: currencySchema,
  }),
  appuserCurrencyBalance: z.number().finite().nullable(),
  balance: z.number().finite().nullable(),
  currencyKey: currencySchema,
  // Household privacy state + whether the viewer owns the account, driving the
  // owner-only privacy toggle on mobile's account edit screen.
  isOwnedByViewer: z.boolean(),
  isPrivate: z.boolean(),
  refreshedAt: z.iso.datetime().nullable(),
  source: accountSourceSchema,
  csvImportFormat: csvImportFormatSchema.optional(),
  // Web reads these too (lib/api/account/useAccounts.ts). Each is optional and falls back to
  // null when malformed, so an older API or a new shape never fails the whole accounts list.
  ownerFirstName: z.string().max(255).nullish().catch(null),
  appuserCurrencyAvailableBalance: z.number().finite().nullish().catch(null),
  syncStatus: syncStatusSchema.nullish().catch(null),
  // The account type's key ('CHECKING', 'CREDIT_CARD', 'MORTGAGE', …) for the row's glyph when there
  // is no institution logo. Optional: older APIs don't send it.
  accountType: z.string().max(255).nullish().catch(null),
  // How `appuserCurrencyBalance` was converted; optional, an older API doesn't send them.
  fxStatus: fxStatusSchema,
  fxRateDate: fxRateDateSchema,
  // The card's cycle and limit, or null when the account is not a credit card. Optional: an
  // older API does not send it.
  creditCard: creditCardSettingsSchema.nullish().catch(null),
})

export const accountUpdateWriteSchema = z.object({
  accountName: z.string().min(1).max(100).optional(),
  isPrivate: z.boolean().optional(),
}).strict()

/** The member's accounts in their new display order, each once. */
export const reorderAccountsWriteSchema = z.object({
  accountIds: z.array(z.number().int().positive()).min(1).max(1000),
}).strict()

export type AccountUpdateWrite = z.input<typeof accountUpdateWriteSchema>
export type ReorderAccountsWrite = z.input<typeof reorderAccountsWriteSchema>

/** The card settings the edit screen sends. Strict, because this builds a request body. */
export const creditCardWriteSchema = z.object({
  statementCloseDay: z.number().int().min(1).max(31),
  paymentDueDay: z.number().int().min(1).max(31),
  creditLimit: z.number().finite().min(0).nullable().optional(),
  minimumPaymentPercent: z.number().finite().min(0).max(100).nullable().optional(),
}).strict()

export type CreditCardWrite = z.input<typeof creditCardWriteSchema>

export const creditCardSettingsResponseSchema = z.object({
  creditCard: creditCardSettingsSchema,
})

const statementDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One statement's totals, as `GET /v1/account/:id/statements` reports them. */
export const creditCardStatementSchema = z.object({
  periodStart: statementDateSchema,
  periodEnd: statementDateSchema,
  dueDate: statementDateSchema,
  charges: z.number().finite(),
  payments: z.number().finite(),
  balance: z.number().finite(),
  availableCredit: z.number().finite().nullable(),
  isCurrent: z.boolean(),
})

export type CreditCardStatementDto = z.infer<typeof creditCardStatementSchema>

export const creditCardStatementsResponseSchema = z.object({
  statements: z.array(creditCardStatementSchema),
})

export const accountsResponseSchema = z.object({
  accounts: z.array(accountSummarySchema),
})

export const accountDetailResponseSchema = z.object({
  account: accountSummarySchema,
})

export type AccountSource = z.infer<typeof accountSourceSchema>
export type AccountSummaryDto = z.infer<typeof accountSummarySchema>
export type AccountsResponseDto = z.infer<typeof accountsResponseSchema>

export const accountsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account',
  schema: accountsResponseSchema,
})

export const isValidAccountId = (accountId: number): boolean => (
  Number.isSafeInteger(accountId) && accountId > 0
)

export function parseAccountId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidAccountId(parsed) ? parsed : null
}

export function createAccountDetailEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/${accountId}`,
    schema: accountDetailResponseSchema,
  })
}

export function createUpdateAccountEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/account/${accountId}`,
    schema: emptyWriteResponseSchema,
  })
}

/** The account order is per member; the API answers 400 when an id is not one the caller can see. */
export function createReorderAccountsEndpoint() {
  return writeEndpoint({
    method: 'PUT',
    path: '/v1/account/order',
    schema: emptyWriteResponseSchema,
  })
}

export function createUpdateCreditCardEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/account/${accountId}/credit-card`,
    schema: creditCardSettingsResponseSchema,
  })
}

/**
 * The card's statements. `from`/`to` are optional calendar days (`YYYY-MM-DD`); without them the
 * API answers with its default window (the last three months).
 */
export function createCreditCardStatementsEndpoint(accountId: number, range: { from?: string; to?: string } = {}) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const query = params.toString()
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/${accountId}/statements${query ? `?${query}` : ''}`,
    schema: creditCardStatementsResponseSchema,
  })
}

export function createDeleteAccountEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/account/${accountId}`,
    schema: emptyWriteResponseSchema,
  })
}
