import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { invalidateBudgets } from "@/lib/utils/queryInvalidation";

import api from "../api";
import type {
  CreateInstallmentPlanRequest,
  GetInstallmentPlanResponse,
  InstallmentPlanDetail,
  UpdateInstallmentPlanRequest,
} from "./types";
import {
  installmentPlanKeys,
  installmentPlansRootKey,
} from "./useInstallmentPlans";

/**
 * After a plan changes: every plan query (lists, detail, commitments, suggestions), the
 * transaction lists (their rows carry the "n/N" badge), the forecast and the bills calendar
 * (both project the upcoming installments) and the budgets (a posted installment counts in the
 * month of its schedule date).
 */
export async function invalidateInstallmentPlans(
  queryClient: QueryClient,
  { deletedPlanKey }: { deletedPlanKey?: number } = {},
) {
  const deletedDetailKey =
    deletedPlanKey === undefined
      ? null
      : JSON.stringify(installmentPlanKeys.detail(deletedPlanKey));
  await Promise.all([
    // A deleted plan's detail is left alone: refetching it would only turn the page the
    // person is leaving into a 404.
    queryClient.invalidateQueries({
      queryKey: installmentPlansRootKey,
      predicate: (query) => JSON.stringify(query.queryKey) !== deletedDetailKey,
    }),
    ...[
      ["transactions"],
      ["accounts-transactions"],
      ["accounts-transactions-infinite"],
      ["account-transactions"],
      ["account-forecast"],
      ["recurring-occurrences"],
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    invalidateBudgets(queryClient),
  ]);
}

export async function createInstallmentPlan(
  request: CreateInstallmentPlanRequest,
): Promise<InstallmentPlanDetail> {
  const { data } = await api.post<GetInstallmentPlanResponse>(
    "/v1/installment-plans",
    request,
  );
  return data.installmentPlan;
}

export function useCreateInstallmentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createInstallmentPlan,
    onSuccess: async (plan) => {
      queryClient.setQueryData<GetInstallmentPlanResponse>(
        installmentPlanKeys.detail(plan.installmentPlanKey),
        { installmentPlan: plan },
      );
      await invalidateInstallmentPlans(queryClient);
    },
  });
}

export function useUpdateInstallmentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      installmentPlanKey,
      ...body
    }: UpdateInstallmentPlanRequest & { installmentPlanKey: number }) => {
      const { data } = await api.patch<GetInstallmentPlanResponse>(
        `/v1/installment-plans/${installmentPlanKey}`,
        body,
      );
      return data.installmentPlan;
    },
    onSuccess: async (plan) => {
      queryClient.setQueryData<GetInstallmentPlanResponse>(
        installmentPlanKeys.detail(plan.installmentPlanKey),
        { installmentPlan: plan },
      );
      await invalidateInstallmentPlans(queryClient);
    },
  });
}

/** Deletes a plan. Its posted transactions stay, unlinked. */
export function useDeleteInstallmentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (installmentPlanKey: number) => {
      await api.delete(`/v1/installment-plans/${installmentPlanKey}`);
      return installmentPlanKey;
    },
    onSuccess: (installmentPlanKey) =>
      invalidateInstallmentPlans(queryClient, {
        deletedPlanKey: installmentPlanKey,
      }),
  });
}
