import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { invalidateBudgets } from "@/lib/utils/queryInvalidation";

import api from "../api";
import { getApiErrorCode, isDemoReadOnlyError } from "../errors";
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

interface InstallmentRef {
  installmentPlanKey: number;
  installmentNumber: number;
}

const installmentLinkPath = ({
  installmentPlanKey,
  installmentNumber,
}: InstallmentRef) =>
  `/v1/installment-plans/${installmentPlanKey}/installments/${installmentNumber}/link`;

/**
 * Why the API refused to link or unlink an installment, as the key of its message
 * (`installments.link-errors.*`). The endpoint answers with the generic codes: 400 when the
 * transaction is not on the plan's card (or the installment is past the plan's count), 409 when
 * the transaction already pays an installment or the installment is already paid by another
 * transaction, 404 when the plan or the transaction is gone.
 */
export type InstallmentLinkError =
  "demo" | "wrong-card" | "already-linked" | "not-found" | "failed";

export function installmentLinkError(error: unknown): InstallmentLinkError {
  if (isDemoReadOnlyError(error)) return "demo";
  const status = (error as { response?: { status?: unknown } } | undefined)
    ?.response?.status;
  const code = getApiErrorCode(error);
  if (status === 400 && code !== "validation_failed") return "wrong-card";
  if (status === 409) return "already-linked";
  if (status === 404) return "not-found";
  return "failed";
}

/**
 * After a link changes, or a refusal says the page is out of date: the plan, the commitments,
 * the suggestions and the transaction lists (their "n/N" badge), as for any plan change.
 */
function useRefreshAfterLink() {
  const queryClient = useQueryClient();
  return {
    onSuccess: async (plan: InstallmentPlanDetail) => {
      queryClient.setQueryData<GetInstallmentPlanResponse>(
        installmentPlanKeys.detail(plan.installmentPlanKey),
        { installmentPlan: plan },
      );
      await invalidateInstallmentPlans(queryClient);
    },
    onError: async (error: unknown) => {
      const reason = installmentLinkError(error);
      if (reason === "already-linked" || reason === "not-found") {
        await invalidateInstallmentPlans(queryClient);
      }
    },
  };
}

/** Marks an installment paid by a posted transaction on the plan's card. */
export function useLinkInstallment() {
  return useMutation({
    mutationFn: async ({
      transactionKey,
      ...installment
    }: InstallmentRef & { transactionKey: number }) => {
      const { data } = await api.post<GetInstallmentPlanResponse>(
        installmentLinkPath(installment),
        { transactionKey },
      );
      return data.installmentPlan;
    },
    ...useRefreshAfterLink(),
  });
}

/** The installment is no longer paid; its transaction stays, as an ordinary row. */
export function useUnlinkInstallment() {
  return useMutation({
    mutationFn: async (installment: InstallmentRef) => {
      const { data } = await api.delete<GetInstallmentPlanResponse>(
        installmentLinkPath(installment),
      );
      return data.installmentPlan;
    },
    ...useRefreshAfterLink(),
  });
}
