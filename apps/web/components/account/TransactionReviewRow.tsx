"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import CategorySelect from "@/components/CategorySelect";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { getCategorizationReviewHint } from "@/lib/account/categorization-confidence-copy";
import { getTransactionDisplayName } from "@/lib/account/transaction-review-groups";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { isSplitTransaction } from "@/lib/api/account/useTransactionSplits";
import type { Category } from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";

import { TransactionSplitSummary } from "./TransactionSplitLines";

interface TransactionReviewRowProps {
  categories: Category[];
  isPending?: boolean;
  mode: "needs-category" | "suggested";
  onApprove?: () => void;
  onCategorize: (categoryId: string) => void;
  transaction: Transaction;
}

export default function TransactionReviewRow({
  categories,
  isPending = false,
  mode,
  onApprove,
  onCategorize,
  transaction,
}: TransactionReviewRowProps) {
  const t = useTranslations();
  const locale = useLocale();
  const hint = getCategorizationReviewHint(transaction);
  const suggestedCategory = transaction.appuserTransactionCategories[0];
  const transactionDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(transactionDisplayDate(transaction.transactionDate));

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_14rem_7rem_auto] md:items-center md:gap-4">
      <div className="flex min-w-0 items-start justify-between gap-4 md:contents">
        <div className="min-w-0 space-y-1">
          <div className="text-foreground truncate text-sm font-medium">
            {getTransactionDisplayName(transaction)}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {transaction.accountKey.accountName} · {transactionDate}
          </div>
          {hint && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs",
                hint.tone === "warning"
                  ? "text-warning-text"
                  : "text-muted-foreground",
              )}
            >
              {hint.tone === "warning" && (
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              )}
              <span>{t(hint.messageKey)}</span>
            </div>
          )}
        </div>

        <Amount
          value={transaction.settlementAmount}
          currency={transaction.settlementCurrencyKey.code}
          className="shrink-0 text-right font-mono text-sm md:col-start-3 md:row-start-1"
        />
      </div>

      <div className="flex items-center justify-between gap-2 md:contents">
        <div className="min-w-0 md:col-start-2 md:row-start-1">
          {/* A split row shows its lines, not a picker: one category here would remove the
              split. Splits are edited from the transaction's edit sheet. */}
          {isSplitTransaction(transaction) ? (
            <TransactionSplitSummary transaction={transaction} />
          ) : (
            <CategorySelect
              categories={categories}
              initialValue={suggestedCategory?.categoryKey.toString()}
              onChange={onCategorize}
              loading={isPending}
              triggerProps={{
                disabled: isPending,
                loading: isPending,
                size: "sm",
              }}
            />
          )}
        </div>

        {mode === "suggested" && onApprove ? (
          <Button
            type="button"
            className="shrink-0 md:col-start-4 md:row-start-1"
            disabled={isPending}
            loading={isPending}
            onClick={onApprove}
            size="sm"
            variant="secondary"
          >
            <Check className="size-4" aria-hidden />
            {t("transaction-review-approve")}
          </Button>
        ) : (
          <span
            aria-hidden
            className="hidden md:col-start-4 md:row-start-1 md:block"
          />
        )}
      </div>
    </div>
  );
}
