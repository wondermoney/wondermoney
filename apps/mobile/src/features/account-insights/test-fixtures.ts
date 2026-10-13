import type { AccountMetricDto, CategorySpendingDto, CashflowDto } from './insights-contract'

export const metricFixture: AccountMetricDto = { accountKey: 1, accountName: 'Daily', currencyCode: 'EUR', type: 'inflow', inflowCurrentPeriod: 1000, inflowPastPeriod: 900, inflowDelta: 100, inflowDeltaPercentage: 11.11, outflowCurrentPeriod: 600, outflowPastPeriod: 500, outflowDelta: 100, outflowDeltaPercentage: 20, transactionCountCurrentPeriod: 12, transactionCountPastPeriod: 10, transactionCountDelta: 2, transactionCountDeltaPercentage: 20 }
export const categoryFixture: CategorySpendingDto = { amount: 120, bgColor: 'not-a-trusted-color', categoryKey: -1, currency: 'EUR', icon: '<unsafe>', isSystemCategory: true, name: 'Uncategorized', numTransactions: 4, textColor: 'also-untrusted', childCategories: [] }
export const cashflowFixture: CashflowDto = { amount: -42.5, date: '2026-07-01T00:00:00.000Z' }
