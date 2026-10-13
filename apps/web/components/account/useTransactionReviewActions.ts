"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import useEditTransactions from "@/lib/api/account/useEditTransactions";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { invalidateTransactions as invalidateTransactionQueries } from "@/lib/utils/queryInvalidation";

function toTransactionIds(transactions: Transaction[]) {
  return transactions.map((transaction) => transaction.transactionKey);
}

function safeCapture(capture: () => void) {
  try {
    capture();
  } catch {
    // no-op
  }
}

export function useTransactionReviewActions() {
  const t = useTranslations();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const { mutateAsync } = useEditTransactions();
  const [pendingTransactionCounts, setPendingTransactionCounts] = useState<
    Map<number, number>
  >(() => new Map());

  const setPending = (transactions: Transaction[], pending: boolean) => {
    setPendingTransactionCounts((current) => {
      const next = new Map(current);
      for (const transaction of transactions) {
        const transactionKey = transaction.transactionKey;
        const currentCount = next.get(transactionKey) ?? 0;

        if (pending) {
          next.set(transactionKey, currentCount + 1);
        } else if (currentCount <= 1) {
          next.delete(transactionKey);
        } else {
          next.set(transactionKey, currentCount - 1);
        }
      }
      return next;
    });
  };

  const approveTransactions = async (transactions: Transaction[]) => {
    if (transactions.length === 0) return;

    const transactionIds = toTransactionIds(transactions);
    safeCapture(() =>
      posthog.capture("account_transactions_review_approve", {
        count: transactions.length,
        transactionIds,
      }),
    );
    setPending(transactions, true);

    try {
      await mutateAsync({
        transactionIds,
        reviewed: true,
      });
      invalidateTransactionQueries(queryClient);
      toast.success(
        t("transaction-review-success", { count: transactions.length }),
      );
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }

      toast.error(t("transaction-review-error"));
    } finally {
      setPending(transactions, false);
    }
  };

  const categorizeTransactions = async (
    transactions: Transaction[],
    categoryId: string,
  ) => {
    if (transactions.length === 0) return;

    const transactionIds = toTransactionIds(transactions);
    setPending(transactions, true);

    try {
      await mutateAsync({
        transactionIds,
        categoryId,
        reviewed: true,
      });
      safeCapture(() =>
        posthog.capture("transaction_categorized", {
          category_key: categoryId,
          count: transactions.length,
          source: "review_bulk",
          was_auto_suggested: false,
        }),
      );
      invalidateTransactionQueries(queryClient);
      toast.success(
        t("transaction-category-review-success", {
          count: transactions.length,
        }),
      );
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }

      toast.error(t("transaction-review-error"));
    } finally {
      setPending(transactions, false);
    }
  };

  const isTransactionPending = (transaction: Transaction) =>
    (pendingTransactionCounts.get(transaction.transactionKey) ?? 0) > 0;

  return {
    approveTransactions,
    categorizeTransactions,
    isTransactionPending,
  };
}
