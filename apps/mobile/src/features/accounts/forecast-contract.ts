import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

const currencyCode = z.string().regex(/^[A-Z]{3}$/)
const money = z.number().finite()

export const forecastPointSchema = z.object({
  date: z.iso.date(),
  balance: money,
})

export const forecastOccurrenceSchema = z.object({
  accountKey: z.number().int().positive().nullish(),
  amount: money,
  currency: currencyCode,
  date: z.iso.date(),
  name: z.string().min(1).max(255),
  seriesKey: z.number().int().positive(),
})

/**
 * A card installment still to be charged inside the window: a projection, never a transaction.
 * The series' points already include it.
 */
export const forecastInstallmentSchema = z.object({
  accountKey: z.number().int().positive(),
  amount: money,
  currency: currencyCode,
  date: z.iso.date(),
  installmentCount: z.number().int().positive(),
  installmentNumber: z.number().int().positive(),
  installmentPlanKey: z.number().int().positive(),
  name: z.string().max(1000),
})

export const forecastSeriesSchema = z.object({
  complete: z.boolean(),
  currency: currencyCode,
  lowPoint: forecastPointSchema.nullish(),
  openingBalance: money.nullish(),
  points: z.array(forecastPointSchema),
  projected: z.array(forecastOccurrenceSchema),
  // Optional: an API from before installment plans omits it; a malformed list reads as none.
  projectedInstallments: z.array(forecastInstallmentSchema).optional().catch(undefined),
})

export const accountForecastSchema = forecastSeriesSchema.extend({
  accountKey: z.number().int().positive(),
})

export const forecastResponseSchema = z.object({
  accounts: z.array(accountForecastSchema),
  days: z.number().int().positive(),
  from: z.iso.date(),
  total: forecastSeriesSchema.nullish(),
  totals: z.array(forecastSeriesSchema),
})

export type AccountForecastDto = z.infer<typeof accountForecastSchema>
export type ForecastOccurrenceDto = z.infer<typeof forecastOccurrenceSchema>
export type ForecastInstallmentDto = z.infer<typeof forecastInstallmentSchema>

/** The account's projected daily balances for the next `days` days (30..90). */
export const createAccountForecastEndpoint = (accountId: number, days = 30) => readEndpoint({
  method: 'GET',
  path: `/v1/account/forecast?accountKeys=${accountId}&days=${days}`,
  schema: forecastResponseSchema,
})
