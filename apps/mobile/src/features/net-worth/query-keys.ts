export const netWorthKey = (epochId: number) => ['net-worth', epochId] as const
// Nested under the ['net-worth', epochId, ...] family so existing epoch-scoped purges cover it.
export const netWorthHistoryKey = (epochId: number, months: number, member?: string) => (
  member ? ['net-worth', epochId, 'history', months, 'member', member] as const : ['net-worth', epochId, 'history', months] as const
)
/** One member's (or Shared's) net worth; without a member it is the household's `netWorthKey`. */
export const memberNetWorthKey = (epochId: number, member?: string) => (
  member ? ['net-worth', epochId, 'member', member] as const : netWorthKey(epochId)
)
