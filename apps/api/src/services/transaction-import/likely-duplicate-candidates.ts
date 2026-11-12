import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { roundMoney } from '@utils/money';

import { LIKELY_DUPLICATE_WINDOW_DAYS, type LikelyDuplicateCandidate } from './likely-duplicate-match';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AMOUNT_BATCH_SIZE = 500;

/**
 * The transactions a file's rows may repeat, for `matchLikelyDuplicates`: on the target
 * account only, and only while it is an account of the importing person in their household, so
 * another household's rows and the partner's private accounts never take part. Soft-deleted rows
 * are left out and hidden rows count, as for the exact match on ids
 * (`findImportedTransactionIds`): a hidden row is still the stored copy of that transaction.
 * Read with explicit tenant and owner predicates, since the parse job runs without a tenant
 * context. A transaction with no currency of its own is in the account's.
 */
export async function findLikelyDuplicateCandidates(
  em: EntityManager,
  scope: { appuserKey: number; tenantKey: number },
  accountKey: number,
  rows: readonly { amount: number; date: Date | string }[],
): Promise<LikelyDuplicateCandidate[]> {
  if (rows.length === 0) return [];
  const account = await em.findOne(Account, { accountKey, accountOwnerAppuserKey: { appuserKey: scope.appuserKey }, deletedAt: null, tenantKey: { tenantKey: scope.tenantKey } }, { filters: false, populate: ['currencyKey'] });
  if (!account) return [];
  const days = rows.map((row) => Math.floor(new Date(row.date).getTime() / MS_PER_DAY)).filter((day) => Number.isFinite(day));
  if (days.length === 0) return [];
  const from = new Date((Math.min(...days) - LIKELY_DUPLICATE_WINDOW_DAYS) * MS_PER_DAY);
  const to = new Date((Math.max(...days) + LIKELY_DUPLICATE_WINDOW_DAYS + 1) * MS_PER_DAY);
  const amounts = [...new Set(rows.map((row) => roundMoney(row.amount, 2)))];
  const found = new Map<number, Transaction>();
  for (let start = 0; start < amounts.length; start += AMOUNT_BATCH_SIZE) {
    const batch = amounts.slice(start, start + AMOUNT_BATCH_SIZE);
    const where = {
      $or: [{ settlementAmount: { $in: batch } }, { editedSettlementAmount: { $in: batch } }],
      accountKey: account.accountKey,
      deletedAt: null,
      tenantKey: scope.tenantKey,
      transactionDate: { $gte: from, $lt: to },
    } as FilterQuery<Transaction>;
    const transactions = await em.find(Transaction, where, { filters: { [HIDDEN_FILTER]: false }, orderBy: { transactionKey: 'asc' }, populate: ['settlementCurrencyKey', 'transactionMerchantKey'] });
    for (const transaction of transactions) found.set(transaction.transactionKey, transaction);
  }
  return [...found.values()].map((transaction) => ({
    amounts: [transaction.settlementAmount, transaction.editedSettlementAmount].filter((amount): amount is number => typeof amount === 'number'),
    currency: transaction.settlementCurrencyKey?.code ?? account.currencyKey.code,
    date: transaction.transactionDate ?? null,
    name: transaction.transactionMerchantKey?.name ?? transaction.description ?? transaction.descriptionDirty ?? null,
    transactionKey: transaction.transactionKey,
  }));
}
