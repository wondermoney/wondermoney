import type { GoalActivityParams } from "./types";

export const goalsQueryKey = ["goals"] as const;

export const availableToAssignQueryKey = ["goals", "available-to-assign"] as const;

export const debtStrategyQueryKey = ["goals", "debt-strategy"] as const;

export const goalQueryKey = (goalKey: number) => ["goal", goalKey] as const;

export const goalActivityListQueryKey = (goalKey: number) => ["goal-activity", goalKey] as const;

export const goalActivityQueryKey = (
  goalKey: number,
  params?: GoalActivityParams,
) => ["goal-activity", goalKey, params ?? {}] as const;
