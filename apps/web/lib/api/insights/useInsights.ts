import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export type InsightType = "budget_pace" | "spending_vs_normal";
export type InsightSeverity = "critical" | "info" | "warning";

export interface SpendingVsNormalFacts {
  categoryKey: number;
  categoryName: string;
  categoryKeys: number[];
  currentAmount: string;
  baselineAmount: string;
  deviationPercent: string;
  direction: "above" | "below";
  daysElapsed: number;
  currency: string;
  fromDate: string;
  toDate: string;
}

export interface BudgetPaceFacts {
  budgetKey: number;
  budgetName: string;
  budgetTemplateCategoryKey: number;
  categoryKey: number;
  categoryName: string;
  parentCategoryName: null | string;
  currencyCode: string;
  amountBudgeted: string;
  amountSpent: string;
  projectedAmount: string;
  overBy: string;
  elapsedPercent: string;
  daysElapsed: number;
  daysInMonth: number;
}

export type Insight =
  | {
      facts: SpendingVsNormalFacts;
      id: string;
      period: string;
      severity: InsightSeverity;
      type: "spending_vs_normal";
    }
  | {
      facts: BudgetPaceFacts;
      id: string;
      period: string;
      severity: InsightSeverity;
      type: "budget_pace";
    };

export interface GetInsightsResponse {
  insights: Insight[];
}

/** `month` is `YYYY-MM`; omitted means the current month. */
export async function getInsights(
  month?: string,
  apiClient: AxiosInstance = api,
): Promise<GetInsightsResponse> {
  const { data } = await apiClient.get<GetInsightsResponse>("/v1/insights", {
    params: month ? { month } : undefined,
  });
  return data;
}

export default function useInsights<R = GetInsightsResponse>(
  month?: string,
  options?: Omit<
    UseQueryOptions<GetInsightsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["insights", month ?? "current"],
    queryFn: () => getInsights(month),
    ...options,
  });
}
