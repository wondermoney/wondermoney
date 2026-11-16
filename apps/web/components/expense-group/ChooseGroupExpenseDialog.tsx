"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import DataLoadError from "@/components/ui/DataLoadError";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { readOnlyAccountKeys } from "@/lib/account/account-access";
import { getTransactionDisplayName } from "@/lib/account/transaction-review-groups";
import useAccounts from "@/lib/api/account/useAccounts";
import {
  type Transaction,
  useInfiniteTransactions,
} from "@/lib/api/account/useTransactions";
import useCategories from "@/lib/api/category/useCategories";
import type { ExpenseGroup } from "@/lib/api/expense-group/types";
import {
  groupShareBlocker,
  sharedGroupOf,
} from "@/lib/expense-group/expense-group";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

import { ShareTransactionInGroup } from "./TransactionExpenseGroupField";

export function ChooseGroupExpenseDialog({
  group,
  onClose,
}: {
  group: ExpenseGroup;
  onClose: () => void;
}) {
  const t = useTranslations("expenseGroups.chooseExpense");
  const tRoot = useTranslations();
  const [selected, setSelected] = useState<Transaction | null>(null);
  const query = useInfiniteTransactions({
    direction: "out",
    excludeTransfers: true,
    limit: 25,
  });
  const accounts = useAccounts();
  const categories = useCategories();
  const formatDate = useFormatShortDate();
  const readOnly = readOnlyAccountKeys(accounts.data?.accounts);
  const eligible = (query.data?.transactions ?? []).filter(
    (row) =>
      !readOnly.has(row.accountKey.accountKey) &&
      !groupShareBlocker(row) &&
      sharedGroupOf(row) === null,
  );
  return (
    <DrawerDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title")}
      description={t("description")}
    >
      {selected ? (
        <ShareTransactionInGroup
          transaction={selected}
          group={group}
          categories={categories.data?.categories ?? []}
          onCancel={() => setSelected(null)}
          onSaved={onClose}
        />
      ) : (
        <div className="space-y-4">
          {query.isError ? (
            <DataLoadError
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : query.isPending || accounts.isPending ? (
            <p role="status">{tRoot("loading")}</p>
          ) : (
            <>
              {eligible.length ? (
                <ul className="divide-border divide-y">
                  {eligible.map((row) => (
                    <li key={row.transactionKey}>
                      <button
                        type="button"
                        className="hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-4 rounded-md py-3 text-left focus-visible:ring-2"
                        onClick={() => setSelected(row)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">
                            {getTransactionDisplayName(row)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {row.accountKey.accountName} ·{" "}
                            {formatDate(row.transactionDate)}
                          </span>
                        </span>
                        <Amount
                          value={row.settlementAmount}
                          currency={row.settlementCurrencyKey.code}
                          className="shrink-0 font-mono text-sm"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t("empty")}</p>
              )}
              {query.hasNextPage ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("more")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    </DrawerDialog>
  );
}
