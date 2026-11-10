"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { isSplitTransaction } from "@/lib/api/account/useTransactionSplits";

/**
 * Giving a split transaction one category removes its split (the API does it on any single
 * category edit). `confirm(transactions, run)` runs `run` straight away when none of them is
 * split, and otherwise asks first; render `dialog` once.
 */
export function useConfirmReplaceSplit() {
  const t = useTranslations();
  const [pending, setPending] = useState<{
    count: number;
    total: number;
    run: () => void;
  } | null>(null);

  const confirm = (transactions: Transaction[], run: () => void) => {
    const count = transactions.filter(isSplitTransaction).length;
    if (count === 0) {
      run();
      return;
    }
    setPending({ count, total: transactions.length, run });
  };

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("transactionSplit.replace.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("transactionSplit.replace.description", {
              count: pending?.count ?? 1,
              total: pending?.total ?? 1,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const run = pending?.run;
              setPending(null);
              run?.();
            }}
          >
            {t("transactionSplit.replace.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
