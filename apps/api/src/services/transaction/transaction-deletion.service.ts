import { type EntityManager, LockMode, wrap } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { ConflictError, ERROR_CODE } from '@utils/errors';

import { isManualAccount, recalculateChainFromAccountBalance, removeFromChain } from './balance-chain.service';
import { TransactionAuditService } from './transaction-audit.service';
import { removeReimbursementLinksOf } from './transaction-reimbursement.service';
import { reconcileTransfers } from './transfer-matching.service';

/**
 * Deleting transactions.
 *
 * ## What can be deleted
 *
 * Rows a person entered or imported: manual entries, receipts read by OCR, CSV and statement rows.
 * Never a row the bank sent ({@link isBankSyncedTransaction}): the bank keeps reporting it, the
 * next sync would meet its id again, and the soft-deleted row would still hold that id's unique
 * key. Such a row can be hidden instead, which takes it out of every list and total.
 *
 * A bulk request with some bank-synced rows deletes the others and reports the bank-synced ones as
 * skipped (`reason: 'bank_synced'`), with their ids so the client can offer to hide them. It is
 * refused with a 409 (`transaction_bank_synced`) only when every selected row is bank-synced, so
 * nothing would happen. Skipping rather than refusing a mixed request is deliberate: "select all
 * matching" over a month mixes both kinds as a matter of course, and refusing would leave the
 * person to unpick the selection by hand.
 *
 * ## What deleting does
 *
 * In one database transaction, account by account under the account's row lock (the lock bank
 * sync, amount edits and recalculation take):
 *
 * - the account's running balances are rebuilt without the rows (`removeFromChain`), so each later
 *   row's balance, and a manual account's own balance, is what it would have been had the rows
 *   never been entered. A bank-linked account keeps the bank's balance and is rebuilt backwards
 *   from it, as sync does;
 * - each row is soft-deleted (`deletedAt`) and gets a `soft_deleted` audit entry with its amount
 *   and balance. The audit log keeps the record; there is no undo;
 * - a loan repayment link on the row is removed, so the loan stops counting a payment that is gone;
 * - a reimbursement link on either side is removed, so the other side counts in full again
 *   (`transaction-reimbursement.service.ts`).
 *
 * Afterwards transfer matching runs from the earliest deleted date: a pair one of whose rows was
 * deleted is dissolved and the other row gets its own type back.
 */

export const BANK_SYNCED_SKIP_REASON = 'bank_synced' as const;

export interface TransactionDeletionResult {
  deletedTransactionIds: number[];
  skipped: { reason: typeof BANK_SYNCED_SKIP_REASON; transactionIds: number[] }[];
}

interface Actor {
  appuserKey: number;
  tenantKey: number;
}

/**
 * Whether the bank sent this row, so it cannot be deleted. An Enable Banking id always says so. The
 * legacy provider column also holds a statement file's row id on an imported row, so it counts only
 * on an account linked to a bank. Needs `accountKey` loaded: an unloaded account cannot say.
 */
export function isBankSyncedTransaction(transaction: Pick<Transaction, 'accountKey' | 'enableBankingTransactionId' | 'nordigenInternalTransactionId'>): boolean {
  if (transaction.enableBankingTransactionId != null) return true;
  if (transaction.nordigenInternalTransactionId == null) return false;
  const account = transaction.accountKey;
  if (!account) return false;
  if (!wrap(account).isInitialized()) throw new Error('isBankSyncedTransaction needs the transaction\'s account loaded');
  return !isManualAccount(account);
}

const ascending = (a: number, b: number) => a - b;
const amount = (value: null | number | string | undefined) => (value == null ? null : Number(value));

/**
 * Delete `transactions` (already loaded through the request's tenant filter, with `accountKey`
 * populated), skipping the bank-synced ones. See the module comment for the rules.
 */
export async function deleteTransactions(em: EntityManager, actor: Actor, transactions: Transaction[]): Promise<TransactionDeletionResult> {
  const synced = transactions.filter(isBankSyncedTransaction).map((row) => row.transactionKey).sort(ascending);
  const deletable = transactions.filter((row) => !isBankSyncedTransaction(row));
  const skipped: TransactionDeletionResult['skipped'] = synced.length > 0 ? [{ reason: BANK_SYNCED_SKIP_REASON, transactionIds: synced }] : [];
  if (deletable.length === 0 && synced.length > 0) {
    throw new ConflictError('Bank-synced transactions cannot be deleted: the bank would send them again. Hide them instead.', ERROR_CODE.TRANSACTION_BANK_SYNCED);
  }
  if (deletable.length === 0) return { deletedTransactionIds: [], skipped };

  const byAccount = new Map<null | number, number[]>();
  for (const row of deletable) {
    const accountKey = row.accountKey?.accountKey ?? null;
    byAccount.set(accountKey, [...(byAccount.get(accountKey) ?? []), row.transactionKey]);
  }

  const deleted: number[] = [];
  let earliest: Date | undefined;
  await em.transactional(async (tx) => {
    const now = new Date();
    // Accounts in key order, so two requests over the same accounts lock them in the same order.
    const accountKeys = [...byAccount.keys()].sort((a, b) => (a ?? 0) - (b ?? 0));
    for (const accountKey of accountKeys) {
      const keys = byAccount.get(accountKey) ?? [];
      const account = accountKey === null ? null : await tx.findOneOrFail(Account, { accountKey, tenantKey: { tenantKey: actor.tenantKey } }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      // Read again under the lock: a row deleted meanwhile is left out, never deleted twice.
      const rows = await tx.find(
        Transaction,
        { deletedAt: null, tenantKey: { tenantKey: actor.tenantKey }, transactionKey: { $in: keys } },
        { filters: { [HIDDEN_FILTER]: false }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (rows.length === 0) continue;
      const removed = new Set(rows.map((row) => row.transactionKey));
      const before = new Map(rows.map((row) => [row.transactionKey, { balance: amount(row.balance), settlementAmount: amount(row.settlementAmount) }]));

      // A manual account's chain is rebuilt from the row before the first deleted one, and its
      // balance is the new tail. Read before the rows are marked deleted: they say where it changes.
      const manualTail = account && isManualAccount(account) ? await removeFromChain(tx, account, removed) : null;

      for (const row of rows) {
        row.deletedAt = now;
        if (row.transactionDate && (!earliest || row.transactionDate < earliest)) earliest = row.transactionDate;
        const was = before.get(row.transactionKey);
        await TransactionAuditService.log(
          tx,
          {
            accountKey,
            actorAppuserKey: actor.appuserKey,
            actorType: TransactionAuditActorType.USER,
            appuserKey: row.appuserKey?.appuserKey ?? actor.appuserKey,
            changes: { balance: { from: was?.balance ?? null, to: null }, settlementAmount: { from: was?.settlementAmount ?? null, to: null } },
            eventType: TransactionAuditEventType.SOFT_DELETED,
            source: 'transaction-delete',
            tenantKey: actor.tenantKey,
            transactionKey: row.transactionKey,
          },
          { flush: false },
        );
        deleted.push(row.transactionKey);
      }

      const links = await tx.find(LoanRepaymentLink, { deletedAt: null, transactionKey: { $in: rows } });
      for (const link of links) link.deletedAt = now;
      await removeReimbursementLinksOf(tx, actor, rows, now);
      await tx.flush();

      if (account && manualTail) {
        account.balance = manualTail.tail.balance;
        account.appuserCurrencyBalance = manualTail.tail.appuserCurrencyBalance;
        if (manualTail.tail.appuserCurrencyBalance === null) account.fxStatus = FxStatus.MISSING;
      } else if (account && !isManualAccount(account)) {
        // The bank owns this account's balance: the chain is rebuilt backwards from it, as sync does.
        await recalculateChainFromAccountBalance(tx, account);
      }
      await tx.flush();
    }
  });

  if (earliest) {
    const from = earliest;
    await em.transactional((tx) => reconcileTransfers(tx, { actorType: TransactionAuditActorType.SYSTEM, apply: true, from, source: 'transfer-matching', tenantKey: actor.tenantKey }));
  }

  return { deletedTransactionIds: deleted.sort(ascending), skipped };
}
