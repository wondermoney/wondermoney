import { type QueryClient, useMutation } from "@tanstack/react-query";

import api from "../api";

/**
 * What a bulk delete did. Rows the bank sent are never deleted (the next sync
 * would send them again); they come back under `skipped`, with their ids, so
 * the client can offer to hide them instead.
 */
export interface DeleteTransactionsResponse {
  deletedTransactionIds: number[];
  skipped: { reason: "bank_synced"; transactionIds: number[] }[];
}

/** Rows `transactionIds`, or every row `filter` matches (at most 5,000). */
export interface DeleteTransactionsRequest {
  transactionIds?: number[];
  filter?: Record<string, string | boolean>;
}

/** The bank-synced rows a delete skipped. */
export const skippedBankSyncedIds = (result: DeleteTransactionsResponse) =>
  result.skipped
    .filter((entry) => entry.reason === "bank_synced")
    .flatMap((entry) => entry.transactionIds);

/**
 * A delete moves running balances, account balances and every total, so all
 * of them are refetched, not only the list.
 */
export const invalidateAfterTransactionDelete = async (qc: QueryClient) => {
  await Promise.all(
    [
      ["accounts"],
      ["accounts-metrics"],
      ["accounts-transactions"],
      ["accounts-transactions-infinite"],
      ["account-transactions"],
      ["reports"],
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
};

export function useDeleteTransactions() {
  return useMutation({
    mutationFn: async ({
      transactionIds,
      filter,
    }: DeleteTransactionsRequest) => {
      const { data } = await api.delete<DeleteTransactionsResponse>(
        "/v1/account/transaction",
        { data: { transactionIds, filter } },
      );
      return data;
    },
  });
}

/** One row. A bank-synced row answers 409 `transaction_bank_synced`. */
export function useDeleteTransaction() {
  return useMutation({
    mutationFn: async (transactionKey: number) => {
      await api.delete(`/v1/account/transaction/${transactionKey}`);
    },
  });
}
