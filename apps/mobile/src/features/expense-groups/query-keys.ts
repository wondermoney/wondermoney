export const expenseGroupsRootKey = (epochId: number) => ['expense-groups', epochId] as const
export const expenseGroupsListKey = (epochId: number) => [...expenseGroupsRootKey(epochId), 'list'] as const
export const expenseGroupKey = (epochId: number, groupId: number) => [...expenseGroupsRootKey(epochId), 'group', groupId] as const
export const expenseGroupBalancesKey = (epochId: number, groupId: number) => [...expenseGroupKey(epochId, groupId), 'balances'] as const
export const expenseGroupExpensesKey = (epochId: number, groupId: number) => [...expenseGroupKey(epochId, groupId), 'expenses'] as const
export const expenseGroupExpenseKey = (epochId: number, groupId: number, transactionId: number) => [...expenseGroupExpensesKey(epochId, groupId), transactionId] as const
export const expenseGroupSettlementsKey = (epochId: number, groupId: number) => [...expenseGroupKey(epochId, groupId), 'settlements'] as const
export const settlementSuggestionsKey = (epochId: number, groupId: number, query: Readonly<{ fromMemberId: number; toMemberId: number; currencyCode: string; search: string }>) => (
  [...expenseGroupSettlementsKey(epochId, groupId), 'suggestions', query.fromMemberId, query.toMemberId, query.currencyCode, query.search] as const
)
