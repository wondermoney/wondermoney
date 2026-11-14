import type { DateScope } from './insights-contract'

const scopeKey = (scope: DateScope) => [scope.fromDate ?? 'all', scope.toDate] as const
export const aggregateMetricsKey = (epoch: number, scope: DateScope) => ['account-insights', epoch, 'metrics', ...scopeKey(scope)] as const
export const accountMetricsKey = (epoch: number, accountId: number, fromDate?: string) => ['account-insights', epoch, 'account', accountId, 'metrics', fromDate ?? 'default'] as const
/** A member-filtered query (`memberKeys`) adds the member at the end; the household's keys are unchanged. */
const memberKey = (memberKeys?: string) => (memberKeys ? [memberKeys] : [])
export const cashflowKey = (epoch: number, scope: DateScope, memberKeys?: string) => ['account-insights', epoch, 'cashflow', ...scopeKey(scope), ...memberKey(memberKeys)] as const
export const categorySpendingKey = (epoch: number, scope: DateScope, limit: number, memberKeys?: string) => ['account-insights', epoch, 'category-spending', ...scopeKey(scope), limit, ...memberKey(memberKeys)] as const
