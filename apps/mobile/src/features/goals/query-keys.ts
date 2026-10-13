export const goalsKey = (epochId: number) => ['goals', epochId] as const
export const archivedGoalsKey = (epochId: number) => ['goals', 'archived', epochId] as const
export const goalDetailKey = (epochId: number, goalId: number) => ['goal', epochId, goalId] as const
export const goalActivityKey = (epochId: number, goalId: number) => ['goal-activity', epochId, goalId] as const
export const goalCreateUnknownKey = (epochId: number) => ['goal-create-unknown', epochId] as const
export const debtStrategyKey = (epochId: number) => ['goals', 'debt-strategy', epochId] as const
