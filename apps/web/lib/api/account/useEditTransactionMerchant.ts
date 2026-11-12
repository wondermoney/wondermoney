import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import {
  TRANSACTION_MERCHANTS_QUERY_KEY,
  type TransactionMerchant,
} from "./useTransactionMerchants";

/** `null` (or an empty string) clears a field; at least one field must be present. */
export interface EditTransactionMerchantRequest {
  transactionMerchantKey: number;
  website?: string | null;
  logoUrl?: string | null;
}

export interface EditTransactionMerchantResponse {
  transactionMerchant: TransactionMerchant;
}

/**
 * `PATCH /v1/account/transaction-merchants/:merchantId`. A value that is not an https URL, or is
 * too long, answers 400; a merchant that is not the household's own answers 404.
 */
export async function editTransactionMerchant(
  { transactionMerchantKey, ...body }: EditTransactionMerchantRequest,
  apiClient: AxiosInstance = api,
): Promise<EditTransactionMerchantResponse> {
  const { data } = await apiClient.patch<EditTransactionMerchantResponse>(
    `/v1/account/transaction-merchants/${transactionMerchantKey}`,
    body,
  );
  return data;
}

/**
 * Every transaction row carries its merchant, so the transaction lists refetch along with the
 * merchant lists. Balances and totals do not move.
 */
export const invalidateAfterMerchantEdit = async (qc: QueryClient) => {
  await Promise.all(
    [
      ["accounts-transactions"],
      ["accounts-transactions-infinite"],
      ["account-transactions"],
      [...TRANSACTION_MERCHANTS_QUERY_KEY],
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
};

export default function useEditTransactionMerchant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: EditTransactionMerchantRequest) =>
      editTransactionMerchant(request),
    onSuccess: () => invalidateAfterMerchantEdit(qc),
  });
}
