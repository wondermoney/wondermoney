"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { MerchantAvatar } from "@/components/merchant/MerchantAvatar";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/Typography";
import { Link } from "@/i18n/navigation";
import {
  getTransactionReviewBuckets,
  groupTransactionsByMerchant,
} from "@/lib/account/transaction-review-groups";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Category } from "@/lib/api/category/useCategories";

import TransactionReviewEmptyState from "./TransactionReviewEmptyState";
import TransactionReviewRow from "./TransactionReviewRow";
import { useTransactionReviewActions } from "./useTransactionReviewActions";

interface TransactionReviewInboxProps {
  categories: Category[];
  transactions: Transaction[];
}

export default function TransactionReviewInbox({
  categories,
  transactions,
}: TransactionReviewInboxProps) {
  const t = useTranslations();
  const buckets = useMemo(
    () => getTransactionReviewBuckets(transactions),
    [transactions],
  );
  const suggestedGroups = useMemo(
    () =>
      groupTransactionsByMerchant(buckets.suggestedCategory).map((group) => ({
        ...group,
        key: `${group.label.toLowerCase()}::${group.settlementCurrencyCode.toLowerCase()}`,
        // The group is named after its merchant when its rows have one.
        merchant: group.transactions.find((transaction) =>
          transaction.transactionMerchantKey?.name.trim(),
        )?.transactionMerchantKey,
      })),
    [buckets.suggestedCategory],
  );
  const { approveTransactions, categorizeTransactions, isTransactionPending } =
    useTransactionReviewActions();
  const hasPendingSuggested = buckets.suggestedCategory.some((transaction) =>
    isTransactionPending(transaction),
  );

  if (buckets.totalUnreviewed === 0) return <TransactionReviewEmptyState />;

  const figure = (chunks: ReactNode) => (
    <span className="text-foreground block font-mono text-xl font-semibold tabular-nums">
      {chunks}
    </span>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("transaction-review-title")}
          description={t("transaction-review-description")}
          actions={
            <Button asChild variant="secondary">
              <Link href="/accounts/transactions">{t("view-all")}</Link>
            </Button>
          }
        />
        <ul className="text-muted-foreground flex flex-wrap gap-x-8 gap-y-4 text-sm">
          <li>
            {t.rich("transaction-review-left", {
              count: buckets.totalUnreviewed,
              figure,
            })}
          </li>
          <li>
            {t.rich("transaction-review-needs-category-count", {
              count: buckets.needsCategory.length,
              figure,
            })}
          </li>
          <li>
            {t.rich("transaction-review-suggested-count", {
              count: buckets.suggestedCategory.length,
              figure,
            })}
          </li>
        </ul>
      </div>

      {buckets.needsCategory.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="space-y-1">
            <Heading variant="h4" as="h2">
              {t("transaction-review-needs-category-title")}
            </Heading>
            <Text className="text-muted-foreground text-sm">
              {t("transaction-review-needs-category-description")}
            </Text>
          </div>
          <ul className="divide-border divide-y rounded-lg border">
            {buckets.needsCategory.map((transaction) => (
              <li key={transaction.transactionKey}>
                <TransactionReviewRow
                  categories={categories}
                  isPending={isTransactionPending(transaction)}
                  mode="needs-category"
                  onCategorize={(categoryId) =>
                    categorizeTransactions([transaction], categoryId)
                  }
                  transaction={transaction}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {buckets.suggestedCategory.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <Heading variant="h4" as="h2">
                {t("transaction-review-suggested-title")}
              </Heading>
              <Text className="text-muted-foreground text-sm">
                {t("transaction-review-suggested-description")}
              </Text>
            </div>
            <Button
              type="button"
              className="shrink-0"
              onClick={() => approveTransactions(buckets.suggestedCategory)}
              disabled={hasPendingSuggested}
              loading={hasPendingSuggested}
            >
              {t("transaction-review-approve-all")}
            </Button>
          </div>
          {/* One list for the section. A merchant with several transactions
              gets a header row carrying its count and a batch approve, so the
              action sits beside what it acts on. */}
          <ul className="divide-border divide-y rounded-lg border">
            {suggestedGroups.map((group) => {
              const groupPending = group.transactions.some((transaction) =>
                isTransactionPending(transaction),
              );
              return (
                <li key={group.key}>
                  {group.transactions.length > 1 && (
                    <div className="bg-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
                      <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                        {group.merchant ? (
                          <MerchantAvatar merchant={group.merchant} />
                        ) : null}
                        <h3 className="text-foreground truncate text-sm font-medium">
                          {group.label}
                        </h3>
                        <span className="text-muted-foreground shrink-0 text-sm">
                          {t("transaction-review-group-summary", {
                            count: group.transactions.length,
                          })}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        disabled={groupPending}
                        loading={groupPending}
                        onClick={() => approveTransactions(group.transactions)}
                      >
                        {t("transaction-review-approve-group", {
                          count: group.transactions.length,
                        })}
                      </Button>
                    </div>
                  )}
                  <ul className="divide-border divide-y">
                    {group.transactions.map((transaction) => (
                      <li key={transaction.transactionKey}>
                        <TransactionReviewRow
                          categories={categories}
                          isPending={isTransactionPending(transaction)}
                          mode="suggested"
                          onApprove={() => approveTransactions([transaction])}
                          onCategorize={(categoryId) =>
                            categorizeTransactions([transaction], categoryId)
                          }
                          transaction={transaction}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
