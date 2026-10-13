import { z } from 'zod'

import { readEndpoint } from '../../lib/api/runtime-schema'

export const netWorthRowTypeSchema = z.enum(['accounts', 'portfolios', 'loans'])

export const netWorthRowSchema = z.object({
  type: netWorthRowTypeSchema,
  name: z.string().min(1).max(255),
  balance: z.number().finite(),
})

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
  rows: z.array(netWorthRowSchema),
  unsupportedCurrencies: z.object({
    loans: z.number().int().nonnegative(),
    portfolios: z.number().int().nonnegative(),
  }),
})

export type NetWorthRowType = z.infer<typeof netWorthRowTypeSchema>
export type NetWorthRowDto = z.infer<typeof netWorthRowSchema>
export type NetWorthDto = z.infer<typeof netWorthDtoSchema>
export type NetWorthSummaryDto = NetWorthDto

export const netWorthSchema = netWorthDtoSchema
export const netWorthSummarySchema = netWorthDtoSchema

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

export const netWorthHistoryReadinessSchema = z.enum(['empty', 'insufficient_history', 'ready'])

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
