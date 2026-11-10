"use client";

import { Split } from "lucide-react";
import { useTranslations } from "next-intl";

import { CategoryCellContent } from "@/components/CategorySelect";
import { Amount } from "@/components/ui/Amount";
import CategoryIcon from "@/components/ui/CategoryIcon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { TransactionSplitLine } from "@/lib/api/account/useTransactionSplits";
import { cn } from "@/lib/utils";
import { getCategoryTranslationKey } from "@/lib/utils/categories";

/** How many categories a split's lines use; "uncategorized" counts as one. */
export function splitCategoryCount(splits: TransactionSplitLine[]): number {
  return new Set(splits.map((line) => line.category?.categoryKey ?? null)).size;
}

/** A category's name as the reader sees it: system categories are translated. */
export function useSplitCategoryLabel() {
  const t = useTranslations();
  return (category: TransactionSplitLine["category"]) =>
    category
      ? category.isSystemCategory
        ? t(getCategoryTranslationKey(category.name))
        : category.name
      : t("transactionSplit.uncategorized");
}

/** "Split · 3 categories": the compact label a split row shows in place of one category. */
export function useSplitSummaryLabel() {
  const t = useTranslations("transactionSplit");
  return (splits: TransactionSplitLine[]) =>
    t("summary", { count: splitCategoryCount(splits) });
}

/**
 * Each line of a split: category, note and amount. Amounts are in the owner's currency when the
 * transaction has a converted amount (like the row's own figure), else in the account's.
 */
export function TransactionSplitLinesList({
  transaction,
  className,
}: {
  transaction: Pick<
    Transaction,
    "splits" | "appuserCurrencyKey" | "settlementCurrencyKey"
  >;
  className?: string;
}) {
  const categoryLabel = useSplitCategoryLabel();
  const lines = transaction.splits ?? [];
  return (
    <ul className={cn("divide-border divide-y", className)}>
      {lines.map((line) => (
        <li
          key={line.transactionSplitKey}
          className="flex items-start justify-between gap-3 py-2 text-sm"
        >
          <div className="min-w-0 space-y-0.5 text-left">
            <CategoryCellContent
              icon={
                line.category ? (
                  <CategoryIcon icon={line.category.icon} />
                ) : undefined
              }
              iconColor={line.category?.bgColor}
              label={categoryLabel(line.category)}
              muted={!line.category}
            />
            {line.notes ? (
              <p className="text-muted-foreground pl-6 text-xs break-words">
                {line.notes}
              </p>
            ) : null}
          </div>
          <Amount
            value={line.appuserAmount ?? line.amount}
            currency={
              line.appuserAmount !== null
                ? transaction.appuserCurrencyKey.code
                : transaction.settlementCurrencyKey.code
            }
            className="shrink-0 font-mono"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * A split row's category cell: "Split · 3 categories", which opens its lines. Clicking it does
 * not open the row's inspector.
 */
export function TransactionSplitSummary({
  transaction,
}: {
  transaction: Pick<
    Transaction,
    "splits" | "appuserCurrencyKey" | "settlementCurrencyKey"
  >;
}) {
  const t = useTranslations("transactionSplit");
  const splits = transaction.splits ?? [];
  const count = splitCategoryCount(splits);
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("summary-label", { count })}
        className="hover:bg-accent focus-visible:ring-ring -ml-1 flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <Split className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("summary", { count })}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-muted-foreground mb-1 text-xs">{t("lines")}</p>
        <TransactionSplitLinesList transaction={transaction} />
      </PopoverContent>
    </Popover>
  );
}
