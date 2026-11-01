import { z } from 'zod'

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
})

export const accountUpdateWriteSchema = z.object({
  accountName: z.string().min(1).max(100).optional(),
  isPrivate: z.boolean().optional(),
}).strict()

export type AccountUpdateWrite = z.input<typeof accountUpdateWriteSchema>

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

export function createDeleteAccountEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/account/${accountId}`,
    schema: emptyWriteResponseSchema,
  })
}
