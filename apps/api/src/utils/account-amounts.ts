interface CategoryLike {
  bgColor: string;
  categoryKey: number;
  icon?: string;
  isSystemCategory: boolean;
  name: string;
  parentCategory: CategoryLike | null;
  textColor: string;
}

interface CategorySpendingTransaction extends TransactionAmountLike {
  appuserCurrencyCode?: string;
  category: CategoryLike | null;
}

interface TransactionAmountLike {
  appuserSettlementAmount?: null | number;
  editedSettlementAmount?: null | number;
}

export function buildEffectiveAmountSql(alias: string): string {
  return `COALESCE(${alias}.edited_settlement_amount, ${alias}.appuser_settlement_amount)`;
}

export function buildEffectiveSpendingAmountSql(transactionAlias: string, repaymentLinkAlias?: string): string {
  if (!repaymentLinkAlias) return buildEffectiveAmountSql(transactionAlias);

  return `CASE WHEN ${repaymentLinkAlias}.loan_repayment_link_key IS NULL THEN ${buildEffectiveAmountSql(transactionAlias)} ELSE COALESCE(${repaymentLinkAlias}.interest_amount, 0) + COALESCE(${repaymentLinkAlias}.fee_amount, 0) END`;
}

export function filterExpenseTransactions<T extends TransactionAmountLike>(transactions: T[]): T[] {
  return transactions.filter((transaction) => getEffectiveAppuserAmount(transaction) < 0);
}

export function getEffectiveAppuserAmount(transaction: TransactionAmountLike): number {
  return transaction.editedSettlementAmount ?? transaction.appuserSettlementAmount ?? 0;
}

export function getNegativeEffectiveAppuserAmount(transaction: TransactionAmountLike): number {
  const amount = getEffectiveAppuserAmount(transaction);
  return amount < 0 ? amount : 0;
}

export function getPositiveEffectiveAppuserAmount(transaction: TransactionAmountLike): number {
  const amount = getEffectiveAppuserAmount(transaction);
  return amount > 0 ? amount : 0;
}

export function mapCategorySpendingByName(transactions: CategorySpendingTransaction[]) {
  const categorySpending = new Map<string, { amount: number; name: string; numTransactions: number }>();

  for (const transaction of transactions) {
    const amount = Math.abs(getEffectiveAppuserAmount(transaction));
    const categoryName = transaction.category?.parentCategory?.name ?? transaction.category?.name ?? 'Uncategorized';
    const current = categorySpending.get(categoryName);

    if (current) {
      current.amount += amount;
      current.numTransactions += 1;
      continue;
    }

    categorySpending.set(categoryName, {
      amount,
      name: categoryName,
      numTransactions: 1,
    });
  }

  return [...categorySpending.values()];
}
