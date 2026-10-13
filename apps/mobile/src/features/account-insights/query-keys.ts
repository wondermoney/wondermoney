import type { DateScope } from './insights-contract'

const scopeKey = (scope: DateScope) => [scope.fromDate, scope.toDate] as const
export const aggregateMetricsKey = (epoch: number, scope: DateScope) => ['account-insights', epoch, 'metrics', ...scopeKey(scope)] as const
export const accountMetricsKey = (epoch: number, accountId: number, fromDate: string) => ['account-insights', epoch, 'account', accountId, 'metrics', fromDate] as const
export const cashflowKey = (epoch: number, scope: DateScope) => ['account-insights', epoch, 'cashflow', ...scopeKey(scope)] as const
export const categorySpendingKey = (epoch: number, scope: DateScope, limit: number) => ['account-insights', epoch, 'category-spending', ...scopeKey(scope), limit] as const
