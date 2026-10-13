"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

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
      })),
    [buckets.suggestedCategory],
  );
  const { approveTransactions, categorizeTransactions, isTransactionPending } =
    useTransactionReviewActions();
  const hasPendingSuggested = buckets.suggestedCategory.some((transaction) =>
    isTransactionPending(transaction),
  );

  if (buckets.totalUnreviewed === 0) return <TransactionReviewEmptyState />;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card flex flex-col gap-4 rounded-lg border p-5 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <Heading variant="h2">{t("transaction-review-title")}</Heading>
          <Text className="text-muted-foreground max-w-2xl">
            {t("transaction-review-description")}
          </Text>
          <div className="text-muted-foreground flex flex-wrap gap-2 text-sm">
            <span>
              {t("transaction-review-left", { count: buckets.totalUnreviewed })}
            </span>
            <span>·</span>
            <span>
              {t("transaction-review-needs-category-count", {
                count: buckets.needsCategory.length,
              })}
            </span>
            <span>·</span>
            <span>
              {t("transaction-review-suggested-count", {
                count: buckets.suggestedCategory.length,
              })}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/accounts/transactions">{t("view-all")}</Link>
        </Button>
      </div>

      {buckets.needsCategory.length > 0 && (
        <section className="space-y-3">
          <div>
            <Heading variant="h3">
              {t("transaction-review-needs-category-title")}
            </Heading>
            <Text className="text-muted-foreground">
              {t("transaction-review-needs-category-description")}
            </Text>
          </div>
          <div className="space-y-2">
            {buckets.needsCategory.map((transaction) => (
              <TransactionReviewRow
                key={transaction.transactionKey}
                categories={categories}
                isPending={isTransactionPending(transaction)}
                mode="needs-category"
                onCategorize={(categoryId) =>
                  categorizeTransactions([transaction], categoryId)
                }
                transaction={transaction}
              />
            ))}
          </div>
        </section>
      )}

      {buckets.suggestedCategory.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <Heading variant="h3">
                {t("transaction-review-suggested-title")}
              </Heading>
              <Text className="text-muted-foreground">
                {t("transaction-review-suggested-description")}
              </Text>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => approveTransactions(buckets.suggestedCategory)}
              disabled={hasPendingSuggested}
              loading={hasPendingSuggested}
            >
              {t("transaction-review-approve-all")}
            </Button>
          </div>
          <div className="space-y-2">
            {suggestedGroups.map((group) => (
              <div key={group.key} className="space-y-2">
                {group.transactions.length > 1 && (
                  <div className="text-muted-foreground px-1 text-sm">
                    {t("transaction-review-group-summary", {
                      label: group.label,
                      count: group.transactions.length,
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  {group.transactions.length > 1 && (
                    <div className="flex justify-end px-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={group.transactions.some((transaction) =>
                          isTransactionPending(transaction),
                        )}
                        loading={group.transactions.some((transaction) =>
                          isTransactionPending(transaction),
                        )}
                        onClick={() => approveTransactions(group.transactions)}
                      >
                        {t("transaction-review-approve-group", {
                          count: group.transactions.length,
                        })}
                      </Button>
                    </div>
                  )}
                  {group.transactions.map((transaction) => (
                    <TransactionReviewRow
                      key={transaction.transactionKey}
                      categories={categories}
                      isPending={isTransactionPending(transaction)}
                      mode="suggested"
                      onApprove={() => approveTransactions([transaction])}
                      onCategorize={(categoryId) =>
                        categorizeTransactions([transaction], categoryId)
                      }
                      transaction={transaction}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
