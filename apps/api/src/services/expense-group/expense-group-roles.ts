import type { EntityManager } from '@mikro-orm/core';

import { ExpenseGroupSettlement } from '@entity/ExpenseGroupSettlement';
import { TransactionSplit } from '@entity/TransactionSplit';

/**
 * Which of `transactionKeys` play a part in an expense group: shared in one (split by person) or
 * linked to a settlement. Such a transaction cannot also be a reimbursement link, and the other
 * way round, so no amount is taken off a transaction twice (`expense-group-sql.ts`).
 *
 * Reads with every filter off: the caller has already checked the member may see the
 * transactions, and a hidden or private role must still refuse.
 */
export async function transactionsInExpenseGroups(em: EntityManager, transactionKeys: number[]): Promise<Set<number>> {
  if (transactionKeys.length === 0) return new Set();
  const [shares, settlements] = await Promise.all([
    em.find(TransactionSplit, { deletedAt: null, expenseGroupMemberKey: { $ne: null }, transactionKey: { transactionKey: { $in: transactionKeys } } }, { fields: ['transactionKey'], filters: false }),
    em.find(ExpenseGroupSettlement, { deletedAt: null, transactionKey: { transactionKey: { $in: transactionKeys } } }, { fields: ['transactionKey'], filters: false }),
  ]);
  return new Set([...shares, ...settlements].flatMap((row) => (row.transactionKey ? [row.transactionKey.transactionKey] : [])));
}
