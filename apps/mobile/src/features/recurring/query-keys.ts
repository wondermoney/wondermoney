export const recurringItemsKey = (epochId: number) => ['recurring', epochId, 'items'] as const
export const recurringSummaryKey = (epochId: number) => ['recurring', epochId, 'summary'] as const
export const recurringOccurrencesKey = (epochId: number, from: string, to: string) => ['recurring', epochId, 'occurrences', from, to] as const
