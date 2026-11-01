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

/*
 * The user-currency amount of a transaction. An amount edit writes the account-currency value to
 * `editedSettlementAmount` and the converted value to `appuserSettlementAmount`, so aggregates in
 * the user's currency read the latter; preferring the edited column would sum a GBP edit as if
 * it were EUR.
 */
export function buildEffectiveAmountSql(alias: string): string {
  return `${alias}.appuser_settlement_amount`;
}

/*
 * The signed user-currency amount a transaction contributes to spending (negative is money out).
 * A loan repayment contributes only its interest and fees, which are money out too; its principal
 * is a transfer to the loan, and must not net against expenses as a positive amount.
 */
export function buildEffectiveSpendingAmountSql(transactionAlias: string, repaymentLinkAlias?: string): string {
  if (!repaymentLinkAlias) return buildEffectiveAmountSql(transactionAlias);

  return `CASE WHEN ${repaymentLinkAlias}.loan_repayment_link_key IS NULL THEN ${buildEffectiveAmountSql(transactionAlias)} ELSE -(COALESCE(${repaymentLinkAlias}.interest_amount, 0) + COALESCE(${repaymentLinkAlias}.fee_amount, 0)) END`;
}

export function filterExpenseTransactions<T extends TransactionAmountLike>(transactions: T[]): T[] {
  return transactions.filter((transaction) => getEffectiveAppuserAmount(transaction) < 0);
}

export function getEffectiveAppuserAmount(transaction: TransactionAmountLike): number {
  return transaction.appuserSettlementAmount ?? 0;
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
