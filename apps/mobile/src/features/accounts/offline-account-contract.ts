import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

export const OFFLINE_ACCOUNT_BALANCE_MAX = 999_999_999_999

const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const accountCurrencySchema = z.object({
  currencyKey: positiveSafeId,
  code: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().min(1).max(255),
}).strict()

export const accountCurrenciesResponseSchema = z.object({
  currencies: z.array(accountCurrencySchema),
}).strict()

export const accountFinancialInstitutionSchema = z.object({
  accountFinancialInstitutionKey: positiveSafeId,
  displayName: z.string().trim().min(1).max(255).nullable().optional(),
  logoUrl: z.url().nullable().optional(),
}).strict()

export const accountFinancialInstitutionsResponseSchema = z.object({
  accountFinancialInstitutions: z.array(accountFinancialInstitutionSchema),
}).strict()

export const offlineAccountPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  currentBalance: z.number().finite().positive().max(OFFLINE_ACCOUNT_BALANCE_MAX),
  currencyId: positiveSafeId,
  financialInstitutionId: positiveSafeId.optional(),
}).strict()

export type AccountCurrencyDto = z.infer<typeof accountCurrencySchema>
export type AccountFinancialInstitutionDto = z.infer<typeof accountFinancialInstitutionSchema>
export type OfflineAccountPayload = z.infer<typeof offlineAccountPayloadSchema>

export const accountCurrenciesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/currencies',
  schema: accountCurrenciesResponseSchema,
})

export const accountFinancialInstitutionsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/financial-institutions',
  schema: accountFinancialInstitutionsResponseSchema,
})

export const createOfflineAccountEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/account/offline',
  schema: z.undefined(),
  successStatuses: [201],
})

export function parsePositiveDecimal(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 && amount <= OFFLINE_ACCOUNT_BALANCE_MAX
    ? amount
    : null
}

export type OfflineAccountField = 'name' | 'balance' | 'currency'

/** Institution isn't included — it's optional and chosen from a fixed list,
 * so there's no free-text way for a user to make it invalid. */
export function invalidOfflineAccountFields(
  name: string,
  balance: string,
  currencyId: number | null,
  currencies: readonly AccountCurrencyDto[],
): ReadonlySet<OfflineAccountField> {
  const fields = new Set<OfflineAccountField>()
  if (name.trim().length === 0 || name.trim().length > 100) fields.add('name')
  if (parsePositiveDecimal(balance) === null) fields.add('balance')
  if (currencyId === null || !currencies.some((item) => item.currencyKey === currencyId)) fields.add('currency')
  return fields
}
