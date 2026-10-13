export const netWorthKey = (epochId: number) => ['net-worth', epochId] as const
// Nested under the ['net-worth', epochId, ...] family so existing epoch-scoped purges cover it.
export const netWorthHistoryKey = (epochId: number, months: number) => (
  ['net-worth', epochId, 'history', months] as const
)
