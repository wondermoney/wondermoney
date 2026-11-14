import {
  type QueryClient,
  useMutation,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * A saved manual entry. `direction` says which way the money moves; the add form picks a
 * transaction type of that direction when it pre-fills. `amount` is a positive magnitude.
 *
 * Templates are private to the member who created them: the API only ever returns the
 * caller's own, and another member's is a 404.
 */
export interface TransactionTemplate {
  account: { accountKey: number; accountName: string | null } | null;
  amount: number | null;
  category: { categoryKey: number; name: string } | null;
  description: string | null;
  direction: "in" | "out";
  name: string;
  notes: string | null;
  position: number;
  transactionMerchant: { name: string; transactionMerchantKey: number } | null;
  transactionTemplateKey: number;
}

export interface GetTransactionTemplatesResponse {
  templates: TransactionTemplate[];
}

export const transactionTemplatesKey = ["transaction-templates"] as const;

export async function getTransactionTemplates(
  apiClient: AxiosInstance = api,
): Promise<GetTransactionTemplatesResponse> {
  const { data } = await apiClient.get<GetTransactionTemplatesResponse>(
    "/v1/transaction-template",
  );
  return data;
}

export default function useTransactionTemplates<R = GetTransactionTemplatesResponse>(
  options?: Omit<
    UseQueryOptions<GetTransactionTemplatesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: transactionTemplatesKey,
    queryFn: () => getTransactionTemplates(),
    ...options,
  });
}

export const invalidateTransactionTemplates = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: transactionTemplatesKey });

export interface CreateTransactionTemplateRequest {
  accountKey?: number | null;
  amount?: number | null;
  categoryKey?: number | null;
  description?: string | null;
  direction?: "in" | "out";
  fromTransactionId?: number;
  name?: string;
  notes?: string | null;
  transactionMerchantKey?: number | null;
}

export function useCreateTransactionTemplate() {
  return useMutation({
    mutationFn: async (request: CreateTransactionTemplateRequest) => {
      const { data } = await api.post<{ template: TransactionTemplate }>(
        "/v1/transaction-template",
        request,
      );
      return data.template;
    },
  });
}

export interface UpdateTransactionTemplateRequest
  extends Omit<CreateTransactionTemplateRequest, "fromTransactionId"> {
  transactionTemplateKey: number;
}

export function useUpdateTransactionTemplate() {
  return useMutation({
    mutationFn: async ({
      transactionTemplateKey,
      ...changes
    }: UpdateTransactionTemplateRequest) => {
      const { data } = await api.patch<{ template: TransactionTemplate }>(
        `/v1/transaction-template/${transactionTemplateKey}`,
        changes,
      );
      return data.template;
    },
  });
}

export function useDeleteTransactionTemplate() {
  return useMutation({
    mutationFn: (transactionTemplateKey: number) =>
      api.delete(`/v1/transaction-template/${transactionTemplateKey}`),
  });
}
