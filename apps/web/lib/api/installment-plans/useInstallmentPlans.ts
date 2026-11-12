import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type {
  GetInstallmentCommitmentsResponse,
  GetInstallmentPlanResponse,
  GetInstallmentPlansResponse,
  GetInstallmentSuggestionsResponse,
} from "./types";

type QueryOptions<T> = Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">;

/**
 * Every installment-plan query lives under one root, so a plan mutation can refresh the lists,
 * the detail, the commitments and the suggestions with one prefix.
 */
export const installmentPlansRootKey = ["installment-plans"] as const;

export const installmentPlanKeys = {
  list: (accountId?: number) =>
    [...installmentPlansRootKey, "list", accountId ?? "all"] as const,
  detail: (planId: number | string) =>
    [...installmentPlansRootKey, "detail", String(planId)] as const,
  commitments: (accountId?: number) =>
    [...installmentPlansRootKey, "commitments", accountId ?? "all"] as const,
  suggestions: (accountId?: number) =>
    [...installmentPlansRootKey, "suggestions", accountId ?? "all"] as const,
};

const accountParams = (accountId?: number) =>
  accountId === undefined ? {} : { accountId };

export async function getInstallmentPlans(
  accountId?: number,
  apiClient: AxiosInstance = api,
): Promise<GetInstallmentPlansResponse> {
  const { data } = await apiClient.get<GetInstallmentPlansResponse>(
    "/v1/installment-plans",
    { params: accountParams(accountId) },
  );
  return data;
}

export async function getInstallmentPlan(
  planId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetInstallmentPlanResponse> {
  const { data } = await apiClient.get<GetInstallmentPlanResponse>(
    `/v1/installment-plans/${planId}`,
  );
  return data;
}

export async function getInstallmentCommitments(
  accountId?: number,
  apiClient: AxiosInstance = api,
): Promise<GetInstallmentCommitmentsResponse> {
  const { data } = await apiClient.get<GetInstallmentCommitmentsResponse>(
    "/v1/installment-plans/commitments",
    { params: accountParams(accountId) },
  );
  return data;
}

export async function getInstallmentSuggestions(
  accountId?: number,
  apiClient: AxiosInstance = api,
): Promise<GetInstallmentSuggestionsResponse> {
  const { data } = await apiClient.get<GetInstallmentSuggestionsResponse>(
    "/v1/installment-plans/suggestions",
    { params: accountParams(accountId) },
  );
  return data;
}

/** The household's plans, or one account's, newest purchase first. */
export default function useInstallmentPlans(
  accountId?: number,
  options?: QueryOptions<GetInstallmentPlansResponse>,
) {
  return useQuery({
    queryKey: installmentPlanKeys.list(accountId),
    queryFn: () => getInstallmentPlans(accountId),
    ...options,
  });
}

/** One plan with its whole schedule. */
export function useInstallmentPlan(
  planId: number | string,
  options?: QueryOptions<GetInstallmentPlanResponse>,
) {
  return useQuery({
    queryKey: installmentPlanKeys.detail(planId),
    queryFn: () => getInstallmentPlan(planId),
    ...options,
  });
}

/** What is still to be charged, per account that has a plan. */
export function useInstallmentCommitments(
  accountId?: number,
  options?: QueryOptions<GetInstallmentCommitmentsResponse>,
) {
  return useQuery({
    queryKey: installmentPlanKeys.commitments(accountId),
    queryFn: () => getInstallmentCommitments(accountId),
    ...options,
  });
}

/** Card rows that look like a purchase in installments, for the person to accept or ignore. */
export function useInstallmentSuggestions(
  accountId?: number,
  options?: QueryOptions<GetInstallmentSuggestionsResponse>,
) {
  return useQuery({
    queryKey: installmentPlanKeys.suggestions(accountId),
    queryFn: () => getInstallmentSuggestions(accountId),
    ...options,
  });
}
