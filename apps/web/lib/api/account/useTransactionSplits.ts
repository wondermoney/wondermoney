import { type QueryClient, useMutation } from "@tanstack/react-query";

import api from "../api";
import type { Category } from "../category/useCategories";

/**
 * One line of a split transaction, as list rows and the split endpoints return it.
 *
 * A split shares one transaction's amount over several categories. Its lines always add up to
 * the transaction's amount, each with the transaction's sign; a row that is not split has
 * `splits: []`. A split row's `appuserTransactionCategories` is its largest line's category, so
 * a client that ignores `splits` still shows something sensible.
 */
export interface TransactionSplitLine {
  transactionSplitKey: number;
  /** In the transaction's settlement (account) currency, signed. */
  amount: number;
  /** The line's share in the owner's currency; null when the transaction has no converted amount. */
  appuserAmount: number | null;
  /** Null for an uncategorized line. */
  category: Pick<
    Category,
    "categoryKey" | "name" | "icon" | "bgColor" | "isSystemCategory"
  > | null;
  notes: string | null;
  position: number;
}

/** One line of a `PUT .../splits` request. */
export interface TransactionSplitLineRequest {
  categoryId: number | null;
  /** A decimal string ("-12.5") in the settlement currency, with the transaction's sign. */
  amount: string;
  notes?: string | null;
}

export interface SetTransactionSplitsRequest {
  transactionKey: number;
  lines: TransactionSplitLineRequest[];
}

interface SplitTransactionResponse {
  transaction: {
    transactionKey: number;
    splits: TransactionSplitLine[];
  };
}

/** A transaction is split when the API sent it lines. */
export function isSplitTransaction(transaction: {
  splits?: TransactionSplitLine[];
}): boolean {
  return (transaction.splits?.length ?? 0) > 0;
}

/**
 * Replaces every line of the transaction's split (at least two, summing exactly to its
 * amount). Errors: 400 `split_invalid`, 404, 409 `transaction_has_loan_repayment`.
 */
export function useSetTransactionSplits() {
  return useMutation({
    mutationFn: async ({
      transactionKey,
      lines,
    }: SetTransactionSplitsRequest) => {
      const { data } = await api.put<SplitTransactionResponse>(
        `/v1/account/transaction/${transactionKey}/splits`,
        lines,
      );
      return data.transaction;
    },
  });
}

/** Removes the split; the transaction keeps its largest line's category. */
export function useRemoveTransactionSplits() {
  return useMutation({
    mutationFn: async (transactionKey: number) => {
      const { data } = await api.delete<SplitTransactionResponse>(
        `/v1/account/transaction/${transactionKey}/splits`,
      );
      return data.transaction;
    },
  });
}

/**
 * A split moves spending between categories, so after one changes the transaction lists, the
 * transaction's history, category spending, budgets and reports are all stale.
 */
export const invalidateTransactionSplits = async (
  qc: QueryClient,
  transactionKey: number,
) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["accounts-transactions"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions-infinite"] }),
    qc.invalidateQueries({ queryKey: ["account-transactions"] }),
    qc.invalidateQueries({ queryKey: ["transaction-history", transactionKey] }),
    qc.invalidateQueries({ queryKey: ["transactions-category-spending"] }),
    qc.invalidateQueries({ queryKey: ["reports"] }),
    qc.invalidateQueries({ queryKey: ["budgets"] }),
    qc.invalidateQueries({ queryKey: ["budget"] }),
    qc.invalidateQueries({ queryKey: ["budgets-full"] }),
  ]);
};
