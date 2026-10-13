import { endOfDay, isAfter } from "date-fns";

import type { Transaction } from "@/lib/api/account/useTransactions";

export interface ChartDataPoint {
  x: Date;
  balance: number;
  dailyAmount: number;
}

interface ProcessedTransaction {
  transactionDate: Date;
  transactionKey: number;
  accountKey: {
    accountKey: number;
  };
  editedSettlementAmount?: number;
  appuserSettlementAmount: number;
  appuserCurrencyBalance: number;
}

interface BuildChartDataOptions {
  transactions: Transaction[];
  fromDate?: Date;
  toDate?: Date;
  today?: Date;
}

function processTransactions(transactions: Transaction[]): ProcessedTransaction[] {
  return transactions
    .map((tx, originalIndex) => ({
      ...tx,
      originalIndex,
      transactionDate: new Date(tx.transactionDate),
    }))
    .toSorted((a, b) => {
      const dateDifference = a.transactionDate.getTime() - b.transactionDate.getTime();
      if (dateDifference !== 0) return dateDifference;

      const transactionKeyDifference = a.transactionKey - b.transactionKey;
      if (transactionKeyDifference !== 0) return transactionKeyDifference;

      return a.originalIndex - b.originalIndex;
    })
    .map(({ originalIndex, ...tx }) => tx);
}

function getUniqueDates(transactions: ProcessedTransaction[]): Date[] {
  return [...new Set(transactions.map((tx) => endOfDay(tx.transactionDate).getTime()))].map(
    (timestamp) => new Date(timestamp),
  );
}

function getAccountKeys(transactions: ProcessedTransaction[]): number[] {
  return [...new Set(transactions.map((tx) => tx.accountKey.accountKey))];
}

function calculateDailyAmount(transactions: ProcessedTransaction[], date: Date): number {
  return transactions
    .filter((tx) => endOfDay(tx.transactionDate).getTime() === date.getTime())
    .reduce((sum, tx) => sum + Math.abs(tx.editedSettlementAmount ?? tx.appuserSettlementAmount), 0);
}

function calculateBalanceAtDate(transactions: ProcessedTransaction[], date: Date, accountKeys: number[]): number {
  return accountKeys.reduce((acc, accountKey) => {
    const relevantTransactions = transactions.filter(
      (tx) => tx.accountKey.accountKey === accountKey && !isAfter(tx.transactionDate, date),
    );

    const latestRelevantTransaction = relevantTransactions.at(-1);

    return latestRelevantTransaction ? acc + latestRelevantTransaction.appuserCurrencyBalance : acc;
  }, 0);
}

function calculateOpeningBalance(transactions: ProcessedTransaction[], accountKeys: number[]): number {
  return accountKeys.reduce((acc, accountKey) => {
    const firstTransactionForAccount = transactions.find((tx) => tx.accountKey.accountKey === accountKey);
    if (!firstTransactionForAccount) {
      return acc;
    }

    const transactionAmount = firstTransactionForAccount.editedSettlementAmount ?? firstTransactionForAccount.appuserSettlementAmount;

    return acc + (firstTransactionForAccount.transactionKey > 0
      ? firstTransactionForAccount.appuserCurrencyBalance - transactionAmount
      : firstTransactionForAccount.appuserCurrencyBalance);
  }, 0);
}

export function buildAccountTransactionsChartData({
  transactions,
  fromDate,
  toDate,
  today = new Date(),
}: BuildChartDataOptions): ChartDataPoint[] {
  const processedTransactions = processTransactions(transactions);
  if (processedTransactions.length === 0) return [];

  const uniqueDates = getUniqueDates(processedTransactions);
  const accountKeys = getAccountKeys(processedTransactions);

  const chartData: ChartDataPoint[] = uniqueDates.map((date) => ({
    x: date,
    balance: calculateBalanceAtDate(processedTransactions, date, accountKeys),
    dailyAmount: calculateDailyAmount(processedTransactions, date),
  }));

  if (fromDate) {
    const boundaryDate = fromDate;
    const hasTransactionOnBoundaryDate = processedTransactions.some(
      (tx) => endOfDay(tx.transactionDate).getTime() === endOfDay(boundaryDate).getTime(),
    );

    if (!hasTransactionOnBoundaryDate) {
      const firstTransaction = processedTransactions[0]!;
      chartData.unshift({
        x: boundaryDate,
        balance: calculateOpeningBalance(processedTransactions, accountKeys),
        dailyAmount: 0,
      });
    }
  }

  const endBoundary = endOfDay(toDate ?? today);
  const hasTransactionToday = processedTransactions.some(
    (tx) => endOfDay(tx.transactionDate).getTime() === endBoundary.getTime(),
  );

  if (!hasTransactionToday) {
    chartData.push({
      x: endBoundary,
      balance: calculateBalanceAtDate(processedTransactions, endBoundary, accountKeys),
      dailyAmount: 0,
    });
  }

  return chartData;
}
