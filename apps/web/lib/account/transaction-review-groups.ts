import type { Transaction } from "@/lib/api/account/useTransactions";

export interface TransactionReviewBuckets {
  needsCategory: Transaction[];
  suggestedCategory: Transaction[];
  totalUnreviewed: number;
}

export interface TransactionReviewGroup {
  label: string;
  settlementCurrencyCode: string;
  transactions: Transaction[];
  totalSettlementAmount: number;
}

function hasTransactionCategory(transaction: Transaction): boolean {
  return transaction.appuserTransactionCategories.length > 0;
}

function needsCategoryRank(transaction: Transaction): number {
  if (transaction.categorizationConfidence === "low") return 0;
  if (transaction.categorizationConfidence === "none") return 1;
  return 2;
}

export function getTransactionReviewBuckets(
  transactions: Transaction[],
): TransactionReviewBuckets {
  const unreviewed = transactions.filter((transaction) => !transaction.reviewed);

  const needsCategory = unreviewed
    .filter((transaction) => !hasTransactionCategory(transaction))
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (a, b) =>
        needsCategoryRank(a.transaction) - needsCategoryRank(b.transaction) ||
        a.index - b.index,
    )
    .map((entry) => entry.transaction);

  return {
    needsCategory,
    suggestedCategory: unreviewed.filter((transaction) => hasTransactionCategory(transaction)),
    totalUnreviewed: unreviewed.length,
  };
}

export function getTransactionDisplayName(transaction: Transaction): string {
  const candidates = [
    transaction.transactionMerchantKey?.name,
    transaction.descriptionDirty,
    transaction.description,
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = candidate?.trim();

    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return `#${transaction.transactionKey}`;
}

export function groupTransactionsByMerchant(
  transactions: Transaction[],
): TransactionReviewGroup[] {
  const groups = new Map<string, TransactionReviewGroup>();

  for (const transaction of transactions) {
    const label = getTransactionDisplayName(transaction);
    const normalizedLabel = label.toLowerCase();
    const settlementCurrencyCode = transaction.settlementCurrencyKey.code;
    const groupKey = `${normalizedLabel}::${settlementCurrencyCode.toLowerCase()}`;
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.transactions.push(transaction);
      existingGroup.totalSettlementAmount += transaction.settlementAmount;
    } else {
      groups.set(groupKey, {
        label,
        settlementCurrencyCode,
        transactions: [transaction],
        totalSettlementAmount: transaction.settlementAmount,
      });
    }
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      right.transactions.length -
      left.transactions.length ||
      left.label.toLowerCase().localeCompare(right.label.toLowerCase()) ||
      left.settlementCurrencyCode.localeCompare(right.settlementCurrencyCode),
  );
}
