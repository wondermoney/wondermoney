"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import CategorySelect from "@/components/CategorySelect";
import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCategorizationReviewHint } from "@/lib/account/categorization-confidence-copy";
import { getTransactionDisplayName } from "@/lib/account/transaction-review-groups";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Category } from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface TransactionReviewRowProps {
  categories: Category[];
  isPending?: boolean;
  mode: "needs-category" | "suggested";
  onApprove?: () => void;
  onCategorize: (categoryId: string) => void;
  transaction: Transaction;
}

function getCategoryLabel(
  category: Category,
  t: ReturnType<typeof useTranslations>,
) {
  return category.isSystemCategory
    ? t(getCategoryTranslationKey(category.name))
    : category.name;
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
  const formatCurrency = useFormatCurrency();
  const hint = getCategorizationReviewHint(transaction);
  const suggestedCategory = transaction.appuserTransactionCategories[0];
  const transactionDateValue = transaction.transactionDate.includes("T")
    ? transaction.transactionDate.slice(0, 10)
    : transaction.transactionDate;
  const transactionDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${transactionDateValue}T00:00:00`));

  return (
    <div className="bg-card grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-foreground truncate font-medium">
            {getTransactionDisplayName(transaction)}
          </div>
          {mode === "suggested" && suggestedCategory && (
            <Badge variant="muted" className="font-normal">
              {getCategoryLabel(suggestedCategory, t)}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground text-sm">
          {transaction.accountKey.accountName} · {transactionDate}
        </div>
        {hint && (
          <div
            className={cn(
              "flex items-center gap-1 text-sm",
              hint.tone === "warning"
                ? "text-warning-text"
                : "text-muted-foreground",
            )}
          >
            {hint.tone === "warning" && (
              <TriangleAlert className="size-3.5 shrink-0" />
            )}
            <span>{t(hint.messageKey)}</span>
          </div>
        )}
      </div>

      <div className="font-mono text-sm font-medium md:text-right">
        <Amount value={transaction.settlementAmount} currency={transaction.settlementCurrencyKey.code} />
      </div>

      <div className="flex flex-wrap gap-2 md:justify-end">
        <CategorySelect
          categories={categories}
          initialValue={suggestedCategory?.categoryKey.toString()}
          onChange={onCategorize}
          loading={isPending}
          triggerProps={{ disabled: isPending, loading: isPending, size: "sm" }}
        />
        {mode === "suggested" && onApprove && (
          <Button
            type="button"
            disabled={isPending}
            loading={isPending}
            onClick={onApprove}
            size="sm"
            variant="outline"
          >
            <CheckCircle2 className="mr-2 size-4" />
            {t("transaction-review-approve")}
          </Button>
        )}
      </div>
    </div>
  );
}
