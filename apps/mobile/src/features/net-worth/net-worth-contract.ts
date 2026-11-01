import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '../../lib/api/runtime-schema'

const netWorthRowTypeSchema = z.enum(['accounts', 'portfolios', 'loans'])

export const netWorthRowSchema = z.object({
  type: netWorthRowTypeSchema,
  name: z.string().min(1).max(255),
  balance: z.number().finite(),
})

// A row of a type this build doesn't know (a new asset class, say) is dropped from the breakdown
// rather than shown with the wrong sign or failing the whole summary. The server's totals still
// include it.
const netWorthRowsSchema = z.array(z.object({
  type: tolerantEnum(['accounts', 'portfolios', 'loans'], 'unknown'),
  name: z.string().min(1).max(255),
  balance: z.number().finite(),
})).transform((rows) => rows.filter((row): row is NetWorthRowDto => row.type !== 'unknown'))

export const netWorthDtoSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  totalNetWorth: z.number().finite(),
  assets: z.object({
    accounts: z.number().finite(),
    portfolios: z.number().finite(),
  }),
  liabilities: z.object({
    loans: z.number().finite(),
  }),
  rows: netWorthRowsSchema,
  unsupportedCurrencies: z.object({
    loans: z.number().int().nonnegative(),
    portfolios: z.number().int().nonnegative(),
  }),
})

export type NetWorthRowDto = z.infer<typeof netWorthRowSchema>
export type NetWorthDto = z.infer<typeof netWorthDtoSchema>

export const netWorthEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/net-worth',
  schema: netWorthDtoSchema,
})

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

export function createNetWorthHistoryEndpoint(months: number = NET_WORTH_HISTORY_MONTHS) {
  const bounded = Math.min(12, Math.max(2, Math.trunc(months)))
  return readEndpoint({
    method: 'GET',
    path: `/v1/net-worth/history?granularity=monthly&months=${bounded}`,
    schema: netWorthHistorySummarySchema,
  })
}
