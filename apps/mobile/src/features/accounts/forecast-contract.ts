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

export const forecastSeriesSchema = z.object({
  complete: z.boolean(),
  currency: currencyCode,
  lowPoint: forecastPointSchema.nullish(),
  openingBalance: money.nullish(),
  points: z.array(forecastPointSchema),
  projected: z.array(forecastOccurrenceSchema),
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

/** The account's projected daily balances for the next `days` days (30..90). */
export const createAccountForecastEndpoint = (accountId: number, days = 30) => readEndpoint({
  method: 'GET',
  path: `/v1/account/forecast?accountKeys=${accountId}&days=${days}`,
  schema: forecastResponseSchema,
})
