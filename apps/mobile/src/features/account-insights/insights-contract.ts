import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '@/lib/api/runtime-schema'

const money = z.number().finite().nullish()
const count = z.number().int().nonnegative().nullish()
const deltaCount = z.number().int().nullish()
const currencyCode = z.string().regex(/^[A-Z]{3}$/)

export const accountMetricSchema = z.object({
  accountKey: z.number().int().positive(),
  accountName: z.string().max(255).nullish(),
  currencyCode: currencyCode.nullish(),
  type: tolerantEnum(['inflow', 'outflow'], 'unknown'),
  inflowCurrentPeriod: money,
  inflowPastPeriod: money,
  inflowDelta: money,
  inflowDeltaPercentage: money,
  outflowCurrentPeriod: money,
  outflowPastPeriod: money,
  outflowDelta: money,
  outflowDeltaPercentage: money,
  transactionCountCurrentPeriod: count,
  transactionCountPastPeriod: count,
  transactionCountDelta: deltaCount,
  transactionCountDeltaPercentage: money,
})

export const metricsResponseSchema = z.object({ metrics: z.array(accountMetricSchema) })
export const cashflowResponseSchema = z.object({ cashflow: z.array(z.object({
  amount: z.number().finite(),
  date: z.iso.datetime(),
})) })

const categoryShape = {
  amount: z.number().finite(),
  bgColor: z.string().max(100).nullish(),
  categoryKey: z.union([z.literal(-1), z.number().int().positive()]),
  currency: currencyCode.nullish(),
  icon: z.string().max(255).nullish(),
  isSystemCategory: z.boolean(),
  name: z.string().min(1).max(255),
  numTransactions: z.number().int().nonnegative(),
  textColor: z.string().max(100).nullish(),
} as const
const childCategorySchema = z.object(categoryShape)
export const categorySpendingSchema = z.object({
  ...categoryShape,
  childCategories: z.array(childCategorySchema),
})
export const categorySpendingResponseSchema = z.object({ categorySpending: z.array(categorySpendingSchema) })

export type InsightPeriod = 'month' | '30-days' | '90-days'
export type AccountMetricDto = z.infer<typeof accountMetricSchema>
export type CashflowDto = z.infer<typeof cashflowResponseSchema>['cashflow'][number]
export type CategorySpendingDto = z.infer<typeof categorySpendingSchema>

export type DateScope = Readonly<{ fromDate: string; toDate: string }>
const dateQuery = (scope: DateScope, includeTo = true) => {
  const values = [`fromDate=${Date.parse(scope.fromDate)}`]
  if (includeTo) values.push(`toDate=${Date.parse(scope.toDate)}`)
  return values.join('&')
}

export const createAggregateMetricsEndpoint = (scope: DateScope) => readEndpoint({ method: 'GET', path: `/v1/account/metrics?${dateQuery(scope)}`, schema: metricsResponseSchema })
export const createAccountMetricsEndpoint = (accountId: number, fromDate: string) => readEndpoint({ method: 'GET', path: `/v1/account/${accountId}/metrics?fromDate=${Date.parse(fromDate)}`, schema: metricsResponseSchema })
export const createCashflowEndpoint = (scope: DateScope) => readEndpoint({ method: 'GET', path: `/v1/account/cashflow?${dateQuery(scope, false)}`, schema: cashflowResponseSchema })
export const createCategorySpendingEndpoint = (scope: DateScope, limit: number) => readEndpoint({ method: 'GET', path: `/v1/account/transaction/category-spending?${dateQuery(scope)}&limit=${limit}`, schema: categorySpendingResponseSchema })
