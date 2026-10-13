import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { getEffectiveAppuserAmount } from '@utils/account-amounts';

import { round2, toCsv } from './csv';
import { buildTransactionWhere, type ReportServiceInput } from './report-filters';

export interface PortfolioPerformanceRow {
  accountKey: string;
  contributions: number;
  currency: string;
  endBalance: number;
  name: string;
  return: number;
  startBalance: number;
}

export function buildPortfolioPerformanceCsv(rows: PortfolioPerformanceRow[]): string {
  const header = ['accountKey', 'name', 'currency', 'startBalance', 'endBalance', 'return', 'contributions'];
  const body = rows.map((row) => [
    row.accountKey,
    row.name,
    row.currency,
    row.startBalance.toFixed(2),
    row.endBalance.toFixed(2),
    row.return.toFixed(2),
    row.contributions.toFixed(2),
  ]);
  return toCsv(header, body);
}

export async function getPortfolioPerformanceReport(input: ReportServiceInput): Promise<PortfolioPerformanceRow[]> {
  const { filters, tenant, user } = input;

  const accounts = await DI.em.find(
    Account,
    { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: user }], deletedAt: undefined, tenantKey: tenant },
    { orderBy: { accountName: 'ASC' }, populate: ['currencyKey'] },
  );
  if (accounts.length === 0) return [];

  const where = buildTransactionWhere(filters, tenant, user);
  const accountCondition = where['accountKey'] as Record<string, unknown>;
  accountCondition['accountKey'] = { $in: accounts.map((account) => account.accountKey) };

  const transactions = await DI.em.find(Transaction, where, {
    orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' },
  });

  const byAccount = new Map<number, Transaction[]>();
  for (const transaction of transactions) {
    if (!transaction.accountKey) continue;
    const accountKey = transaction.accountKey.accountKey;
    const current = byAccount.get(accountKey);
    if (current) current.push(transaction);
    else byAccount.set(accountKey, [transaction]);
  }

  return accounts.map((account) => {
    const accountTransactions = byAccount.get(account.accountKey) ?? [];
    const first = accountTransactions[0];
    const last = accountTransactions[accountTransactions.length - 1];
    const startBalance = first?.appuserCurrencyBalance ?? account.appuserCurrencyBalance ?? 0;
    const endBalance = filters.toDate
      ? (last?.appuserCurrencyBalance ?? account.appuserCurrencyBalance ?? 0)
      : (account.appuserCurrencyBalance ?? 0);
    const start = round2(startBalance);
    const end = round2(endBalance);
    const contributions = round2(accountTransactions.reduce((sum, transaction) => sum + getEffectiveAppuserAmount(transaction), 0));

    return {
      accountKey: String(account.accountKey),
      contributions,
      currency: account.currencyKey.code,
      endBalance: end,
      name: account.accountName ?? 'Account',
      return: round2(end - start - contributions),
      startBalance: start,
    };
  });
}
