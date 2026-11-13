import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '../../lib/api/runtime-schema'

const netWorthRowTypeSchema = z.enum(['accounts', 'portfolios', 'manualAssets', 'loans'])

export const netWorthRowSchema = z.object({
  type: netWorthRowTypeSchema,
  /** The account, portfolio, manual asset or loan key, so a row can be matched to its record (its logo). */
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(255),
  balance: z.number().finite(),
  /** A portfolio already inside this account's balance: shown, but not part of any total. */
  countedInAccountId: z.number().int().positive().optional(),
})

// A row of a type this build doesn't know (a new asset class, say) is dropped from the breakdown
// rather than shown with the wrong sign or failing the whole summary. The server's totals still
// include it.
const netWorthRowsSchema = z.array(z.object({
  type: tolerantEnum(['accounts', 'portfolios', 'manualAssets', 'loans'], 'unknown'),
  id: z.number().int().positive().optional().catch(undefined),
  name: z.string().min(1).max(255),
  balance: z.number().finite(),
  countedInAccountId: z.number().int().positive().optional().catch(undefined),
})).transform((rows) => rows.filter((row): row is NetWorthRowDto => row.type !== 'unknown'))

export const netWorthDtoSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  totalNetWorth: z.number().finite(),
  assets: z.object({
    accounts: z.number().finite(),
    portfolios: z.number().finite(),
    /** Homes, vehicles and other manually valued assets; absent from older APIs. */
    manualAssets: z.number().finite().optional(),
  }),
  liabilities: z.object({
    loans: z.number().finite(),
  }),
  rows: netWorthRowsSchema,
  unsupportedCurrencies: z.object({
    // Accounts left out for want of an exchange rate; an older API doesn't send it.
    accounts: z.number().int().nonnegative().optional().catch(undefined),
    loans: z.number().int().nonnegative(),
    portfolios: z.number().int().nonnegative(),
    manualAssets: z.number().int().nonnegative().optional(),
  }),
  /** The currencies of the accounts and loans left out, so the note can name them. Optional. */
  unconvertedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).optional().catch(undefined),
  /**
   * Ask "Is this the same money?": an investment account this member can see that no portfolio is
   * linked to (by either member), and a portfolio with no link. Absent from older APIs.
   */
  suggestPortfolioLink: z.boolean().optional().catch(undefined),
})

export type NetWorthRowDto = z.infer<typeof netWorthRowSchema>
export type NetWorthDto = z.infer<typeof netWorthDtoSchema>

export const netWorthEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/net-worth',
  schema: netWorthDtoSchema,
})

/** One member's net worth, or Shared's (`member`: an appuser key or `shared`); absent, the household's. */
export function createNetWorthEndpoint(member?: string) {
  if (!member) return netWorthEndpoint
  return readEndpoint({ method: 'GET', path: `/v1/net-worth?member=${encodeURIComponent(member)}`, schema: netWorthDtoSchema })
}

/**
 * Net-worth history (monthly trend). Totals are nullable per point because a month's
 * value is only known when every contributing source resolves; the client must never
 * fabricate a value, so nulls stay explicitly unavailable.
 */
export const netWorthHistoryPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalNetWorth: z.number().finite().nullable(),
  accountsTotal: z.number().finite().nullable(),
  portfoliosTotal: z.number().finite().nullable(),
  /** Absent from older APIs. */
  manualAssetsTotal: z.number().finite().nullable().optional(),
  loansTotal: z.number().finite().nullable(),
  isComplete: z.boolean(),
})

// A readiness this build doesn't know reads as 'insufficient_history', the conservative state.
export const netWorthHistoryReadinessSchema = tolerantEnum(['empty', 'insufficient_history', 'ready'], 'insufficient_history')

export const netWorthHistorySummarySchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  granularity: z.literal('monthly'),
  points: z.array(netWorthHistoryPointSchema),
  readiness: netWorthHistoryReadinessSchema,
})

export type NetWorthHistoryPointDto = z.infer<typeof netWorthHistoryPointSchema>
export type NetWorthHistoryReadiness = z.infer<typeof netWorthHistoryReadinessSchema>
export type NetWorthHistorySummaryDto = z.infer<typeof netWorthHistorySummarySchema>

/** Server bounds: monthly granularity, months in [2, 12]. */
export const NET_WORTH_HISTORY_MONTHS = 6

export function createNetWorthHistoryEndpoint(months: number = NET_WORTH_HISTORY_MONTHS, member?: string) {
  const bounded = Math.min(12, Math.max(2, Math.trunc(months)))
  return readEndpoint({
    method: 'GET',
    path: `/v1/net-worth/history?granularity=monthly&months=${bounded}${member ? `&member=${encodeURIComponent(member)}` : ''}`,
    schema: netWorthHistorySummarySchema,
  })
}
