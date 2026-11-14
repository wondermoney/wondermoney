import { type EntityManager, LockMode, raw } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionReimbursement } from '@entity/TransactionReimbursement';
import { type AccountActor, assertAccountsWritable, isAccountVisibleTo, loadAccountAudiences, loadSharedAccountKeys, visibleAccountWhere } from '@service/account/account-access';
import { transactionsInExpenseGroups } from '@service/expense-group/expense-group-roles';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import { big, toNumber } from '@utils/money';

import { TransactionAuditService } from './transaction-audit.service';
import { notTransferSql, TRANSFER_TYPE_NAMES } from './transaction-scope';
import { excludeExpired, isExpiredStatusName } from './transaction-status';

/**
 * Linking a refund (money in) to the expense it offsets (money out), so net spending is right.
 *
 * The effect on totals is not here: it is read by every total through `category-lines.ts` (the
 * expense counts the linked amount less in its category, pro rata across a split; the refund
 * counts that much less income), from the links that count (`reimbursement-sql.ts`). Balances are
 * never touched. This module keeps the links valid:
 *
 * - **Directions.** The reimbursement is money in and the expense money out, by the sign of their
 *   effective settlement amounts (the user's edit wins). Neither is a transfer between own
 *   accounts; the expense is not a loan repayment (which already splits out what is spending).
 * - **Currency.** Both are settled in the same currency (v1). `amount` is in the expense's
 *   settlement currency, so the model is ready for links across currencies later.
 * - **Amounts.** `amount` is positive with at most 4 decimals, and the live links on either side
 *   never add up to more than that side's amount. Both transactions are locked while linking, so
 *   two concurrent links cannot together exceed one side. A later amount edit is not refused:
 *   totals then take off at most the whole amount (`netOfReimbursements`).
 * - **Tenancy and privacy.** Both sides are in the member's household and visible to them, and
 *   visible to the same members: both on shared accounts, or both on private accounts of the same
 *   owner. So a link never shows, or changes a total, for someone who cannot see both sides.
 *   Anything the member cannot see is "not found".
 * - **Expense groups.** Neither side is shared in an expense group or linked to a group
 *   settlement (409 `transaction_in_expense_group`): those already take their amount off the
 *   totals (`expense-group/expense-group-sql.ts`), and a reimbursement on top would count it twice.
 * - **One live link per pair.** Changing an amount is unlink then link.
 *
 * Linking and unlinking write a `user_edit` audit entry on both transactions. Deleting either
 * transaction removes its links ({@link removeReimbursementLinksOf}).
 */

export interface LinkedTransactionDto {
  accountKey: null | number;
  accountName: null | string;
  currencyCode: null | string;
  description: null | string;
  merchantName: null | string;
  /** Signed, the user's edit when there is one, in `currencyCode`. */
  settlementAmount: null | number;
  transactionDate: Date | null;
  transactionKey: number;
}

export interface ReimbursementLinkDto {
  /** Positive, in `currencyCode` (the expense's settlement currency). */
  amount: number;
  createdAt: Date;
  currencyCode: null | string;
  expense: LinkedTransactionDto;
  reimbursement: LinkedTransactionDto;
  transactionReimbursementKey: number;
}

export type ReimbursementRole = 'expense' | 'reimbursement';

export interface ReimbursementSuggestionDto extends LinkedTransactionDto {
  reason: 'amount' | 'merchant' | 'search';
  remainingAmount: number;
}

export interface TransactionReimbursementsDto {
  currencyCode: null | string;
  linkedAmount: number;
  links: ReimbursementLinkDto[];
  remainingAmount: number;
  role: null | ReimbursementRole;
}

type Actor = AccountActor;

/** How far apart a reimbursement and its expense are suggested: the refund within 60 days after the expense. */
export const SUGGESTION_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const AMOUNT_SCALE = 4;

const LINKED_TRANSACTION_POPULATE = ['accountKey', 'settlementCurrencyKey', 'transactionMerchantKey', 'transactionStatusKey', 'transactionTypeKey'] as const;
const LINK_POPULATE = [
  'expenseTransactionKey.accountKey',
  'expenseTransactionKey.settlementCurrencyKey',
  'expenseTransactionKey.transactionMerchantKey',
  'reimbursementTransactionKey.accountKey',
  'reimbursementTransactionKey.settlementCurrencyKey',
  'reimbursementTransactionKey.transactionMerchantKey',
] as const;

/** The effective settlement amount: the user's edit when there is one. */
function settlementOf(transaction: Pick<Transaction, 'editedSettlementAmount' | 'settlementAmount'>): null | number {
  const value = transaction.editedSettlementAmount ?? transaction.settlementAmount;
  return value == null ? null : toNumber(big(value), AMOUNT_SCALE);
}

/** Expense (money out) or reimbursement (money in), by the sign of the settlement amount; null for none or zero. */
export function reimbursementRoleOf(transaction: Pick<Transaction, 'editedSettlementAmount' | 'settlementAmount'>): null | ReimbursementRole {
  const amount = settlementOf(transaction);
  if (amount === null || amount === 0) return null;
  return amount < 0 ? 'expense' : 'reimbursement';
}

function isTransfer(transaction: Transaction): boolean {
  const type = transaction.transactionTypeKey?.name;
  return transaction.transferCounterpartKey != null || (type !== undefined && (TRANSFER_TYPE_NAMES as readonly string[]).includes(type));
}

/** Whether the member may see the transaction: same household, live, and on an account they see (`sharedAccountKeys`: the accounts shared with them). */
function isVisibleTo(transaction: Transaction, actor: Actor, sharedAccountKeys: ReadonlySet<number>): boolean {
  const account = transaction.accountKey;
  return (
    transaction.tenantKey?.tenantKey === actor.tenantKey &&
    !transaction.deletedAt &&
    !!account &&
    !account.deletedAt &&
    isAccountVisibleTo(account, actor.appuserKey, sharedAccountKeys)
  );
}

/** Whether the same members see both: both shared, or both private to the same owner. */
async function findVisible(em: EntityManager, actor: Actor, transactionKey: number, lock = false): Promise<Transaction> {
  const transaction = await em.findOne(
    Transaction,
    { deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey), transactionKey },
    { filters: { [HIDDEN_FILTER]: false }, populate: LINKED_TRANSACTION_POPULATE, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
  );
  if (!transaction || !isVisibleTo(transaction, actor, await loadSharedAccountKeys(em, actor)) || isExpiredStatusName(transaction.transactionStatusKey?.name)) throw new NotFoundError('Transaction not found');
  return transaction;
}

async function sameVisibility(em: EntityManager, a: Transaction, b: Transaction): Promise<boolean> {
  const first = a.accountKey;
  const second = b.accountKey;
  if (!first || !second) return false;
  const audiences = await loadAccountAudiences(em, [first.accountKey, second.accountKey]);
  const audience = audiences.get(first.accountKey);
  return audience !== undefined && audience === audiences.get(second.accountKey);
}

/** The live links on `transactions` in `role`, summed per transaction. */
async function audit(em: EntityManager, actor: Actor, transaction: Transaction, source: string, change: { from: unknown; to: unknown }): Promise<void> {
  await TransactionAuditService.log(em, {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: actor.appuserKey,
    actorType: TransactionAuditActorType.USER,
    appuserKey: transaction.appuserKey?.appuserKey ?? actor.appuserKey,
    changes: { reimbursement: change },
    eventType: TransactionAuditEventType.USER_EDIT,
    source,
    tenantKey: actor.tenantKey,
    transactionKey: transaction.transactionKey,
  }, { flush: false });
}

function auditValue(link: TransactionReimbursement) {
  return {
    amount: toNumber(big(link.amount), AMOUNT_SCALE),
    expenseTransactionKey: link.expenseTransactionKey.transactionKey,
    reimbursementTransactionKey: link.reimbursementTransactionKey.transactionKey,
    transactionReimbursementKey: link.transactionReimbursementKey,
  };
}

async function linkedTotals(em: EntityManager, transactions: Transaction[], role: ReimbursementRole): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  if (transactions.length === 0) return totals;
  const field = role === 'expense' ? 'expenseTransactionKey' : 'reimbursementTransactionKey';
  const links = await em.find(TransactionReimbursement, { deletedAt: null, [field]: { $in: transactions } });
  for (const link of links) {
    const key = link[field].transactionKey;
    totals.set(key, toNumber(big(totals.get(key) ?? 0).plus(big(link.amount)), AMOUNT_SCALE));
  }
  return totals;
}

function remainingOf(transaction: Transaction, linked: number): number {
  const amount = settlementOf(transaction);
  if (amount === null) return 0;
  const remaining = big(amount).abs().minus(big(linked));
  return remaining.lt(0) ? 0 : toNumber(remaining, AMOUNT_SCALE);
}

function toLinkDto(link: TransactionReimbursement): ReimbursementLinkDto {
  return {
    amount: toNumber(big(link.amount), AMOUNT_SCALE),
    createdAt: link.createdAt,
    currencyCode: link.expenseTransactionKey.settlementCurrencyKey?.code ?? null,
    expense: toLinkedTransactionDto(link.expenseTransactionKey),
    reimbursement: toLinkedTransactionDto(link.reimbursementTransactionKey),
    transactionReimbursementKey: link.transactionReimbursementKey,
  };
}

function toLinkedTransactionDto(transaction: Transaction): LinkedTransactionDto {
  return {
    accountKey: transaction.accountKey?.accountKey ?? null,
    accountName: transaction.accountKey?.accountName ?? null,
    currencyCode: transaction.settlementCurrencyKey?.code ?? null,
    description: transaction.description ?? null,
    merchantName: transaction.transactionMerchantKey?.name ?? null,
    settlementAmount: settlementOf(transaction),
    transactionDate: transaction.transactionDate ?? null,
    transactionKey: transaction.transactionKey,
  };
}

/**
 * Link `reimbursementTransactionKey` (money in) to `input.expenseTransactionKey` (money out) for
 * `input.amount`. See the module comment for every rule; 404 for anything the member cannot see.
 */
export async function linkReimbursement(em: EntityManager, actor: Actor, reimbursementTransactionKey: number, input: { amount: number; expenseTransactionKey: number }): Promise<ReimbursementLinkDto> {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.REIMBURSEMENT_INVALID);
  const amount = big(input.amount);
  if (amount.lte(0) || !amount.round(AMOUNT_SCALE).eq(amount)) throw invalid(`The amount must be positive, with at most ${AMOUNT_SCALE} decimals`);
  if (input.expenseTransactionKey === reimbursementTransactionKey) throw invalid('A transaction cannot reimburse itself');

  const linkKey = await em.transactional(async (tx) => {
    // Locked in key order, so two requests over the same pair never wait on each other in a cycle.
    const keys = [reimbursementTransactionKey, input.expenseTransactionKey].sort((a, b) => a - b);
    const locked: Transaction[] = [];
    for (const key of keys) locked.push(await findVisible(tx, actor, key, true));
    const [reimbursement, expense] = [reimbursementTransactionKey, input.expenseTransactionKey].map((key) => locked.find((row) => row.transactionKey === key));
    if (!reimbursement || !expense) throw new NotFoundError('Transaction not found');

    if (reimbursementRoleOf(reimbursement) !== 'reimbursement') throw invalid('Only money coming in can be a reimbursement');
    if (reimbursementRoleOf(expense) !== 'expense') throw invalid('Only money going out can be reimbursed');
    if (isTransfer(reimbursement) || isTransfer(expense)) throw invalid('A transfer between your own accounts cannot be a reimbursement');
    if (await tx.count(LoanRepaymentLink, { deletedAt: null, transactionKey: expense }) > 0) throw invalid('A loan repayment cannot be reimbursed');
    // A shared expense's other people are paid back through settlements, never a reimbursement too.
    if ((await transactionsInExpenseGroups(tx, [expense.transactionKey, reimbursement.transactionKey])).size > 0) {
      throw new ConflictError('A transaction shared in an expense group or settling one cannot be a reimbursement', ERROR_CODE.TRANSACTION_IN_EXPENSE_GROUP);
    }
    if (!expense.settlementCurrencyKey || expense.settlementCurrencyKey.currencyKey !== reimbursement.settlementCurrencyKey?.currencyKey) {
      throw new BadRequestError('A reimbursement can only be linked to an expense in the same currency', ERROR_CODE.REIMBURSEMENT_CURRENCY_MISMATCH);
    }
    if (!(await sameVisibility(tx, expense, reimbursement))) {
      throw new BadRequestError('A transaction on a private account can only be linked to another one seen by the same members', ERROR_CODE.REIMBURSEMENT_VISIBILITY_MISMATCH);
    }
    // A link changes both sides' totals, so the member must be able to change both accounts.
    await assertAccountsWritable(tx, [expense.accountKey, reimbursement.accountKey].filter((account) => account !== undefined), actor);
    if (await tx.count(TransactionReimbursement, { deletedAt: null, expenseTransactionKey: expense, reimbursementTransactionKey: reimbursement }) > 0) {
      throw new ConflictError('These transactions are already linked', ERROR_CODE.REIMBURSEMENT_LINK_EXISTS);
    }

    const expenseRemaining = remainingOf(expense, (await linkedTotals(tx, [expense], 'expense')).get(expense.transactionKey) ?? 0);
    const reimbursementRemaining = remainingOf(reimbursement, (await linkedTotals(tx, [reimbursement], 'reimbursement')).get(reimbursement.transactionKey) ?? 0);
    if (amount.gt(big(expenseRemaining)) || amount.gt(big(reimbursementRemaining))) {
      throw new BadRequestError(`At most ${Math.min(expenseRemaining, reimbursementRemaining)} can still be linked`, ERROR_CODE.REIMBURSEMENT_AMOUNT_EXCEEDED);
    }

    const link = tx.create(TransactionReimbursement, {
      amount: toNumber(amount, AMOUNT_SCALE),
      expenseTransactionKey: expense,
      linkedByAppuserKey: getRef(tx, Appuser, actor.appuserKey),
      reimbursementTransactionKey: reimbursement,
      tenantKey: getRef(tx, Tenant, actor.tenantKey),
    }, { partial: true });
    await tx.flush();
    for (const side of [expense, reimbursement]) await audit(tx, actor, side, 'transaction-reimbursement', { from: null, to: auditValue(link) });
    await tx.flush();
    return link.transactionReimbursementKey;
  });

  const link = await em.findOneOrFail(TransactionReimbursement, { transactionReimbursementKey: linkKey }, { filters: { [HIDDEN_FILTER]: false }, populate: LINK_POPULATE, refresh: true });
  return toLinkDto(link);
}

/**
 * Remove the link `transactionReimbursementKey` from `transactionKey` (either side). 404 when the
 * member cannot see the transaction, or the link is not on it.
 */
export async function unlinkReimbursement(em: EntityManager, actor: Actor, transactionKey: number, transactionReimbursementKey: number): Promise<void> {
  await em.transactional(async (tx) => {
    const transaction = await findVisible(tx, actor, transactionKey);
    const link = await tx.findOne(
      TransactionReimbursement,
      { $or: [{ expenseTransactionKey: transaction }, { reimbursementTransactionKey: transaction }], deletedAt: null, tenantKey: getRef(tx, Tenant, actor.tenantKey), transactionReimbursementKey },
      { filters: { [HIDDEN_FILTER]: false }, lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!link) throw new NotFoundError('Reimbursement link not found');
    const other = link.expenseTransactionKey.transactionKey === transaction.transactionKey ? link.reimbursementTransactionKey : link.expenseTransactionKey;
    const counterpart = await tx.findOne(Transaction, { transactionKey: other.transactionKey }, { filters: { [HIDDEN_FILTER]: false }, populate: ['accountKey'] });
    // A link whose other side the member cannot see (the account went private since) is not theirs to remove.
    if (!counterpart || !isVisibleTo(counterpart, actor, await loadSharedAccountKeys(tx, actor))) throw new NotFoundError('Reimbursement link not found');
    await assertAccountsWritable(tx, [transaction.accountKey, counterpart.accountKey].filter((account) => account !== undefined), actor);
    link.deletedAt = new Date();
    for (const side of [transaction, counterpart]) await audit(tx, actor, side, 'transaction-reimbursement-remove', { from: auditValue(link), to: null });
    await tx.flush();
  });
}

/** The links of one transaction, either role, and how much is left to link on it. */
export async function getTransactionReimbursements(em: EntityManager, actor: Actor, transactionKey: number): Promise<TransactionReimbursementsDto> {
  const transaction = await findVisible(em, actor, transactionKey);
  const role = reimbursementRoleOf(transaction);
  const links = (await loadReimbursementLinks(em, actor, [transaction])).get(transaction.transactionKey) ?? [];
  const linked = role === null ? 0 : ((await linkedTotals(em, [transaction], role)).get(transaction.transactionKey) ?? 0);
  return {
    currencyCode: transaction.settlementCurrencyKey?.code ?? null,
    linkedAmount: linked,
    links,
    remainingAmount: role === null ? 0 : remainingOf(transaction, linked),
    role,
  };
}

/**
 * The live links on `transactions` (either side) whose other side the member can also see, keyed by
 * transaction. One query for a page of rows.
 */
export async function loadReimbursementLinks(em: EntityManager, actor: Actor, transactions: Transaction[]): Promise<Map<number, ReimbursementLinkDto[]>> {
  const byTransaction = new Map<number, ReimbursementLinkDto[]>();
  if (transactions.length === 0) return byTransaction;
  const links = await em.find(
    TransactionReimbursement,
    { $or: [{ expenseTransactionKey: { $in: transactions } }, { reimbursementTransactionKey: { $in: transactions } }], deletedAt: null, tenantKey: { tenantKey: actor.tenantKey } },
    { filters: { [HIDDEN_FILTER]: false }, orderBy: { transactionReimbursementKey: 'asc' }, populate: LINK_POPULATE },
  );
  const keys = new Set(transactions.map((transaction) => transaction.transactionKey));
  const shared = await loadSharedAccountKeys(em, actor);
  for (const link of links) {
    if (!isVisibleTo(link.expenseTransactionKey, actor, shared) || !isVisibleTo(link.reimbursementTransactionKey, actor, shared)) continue;
    const dto = toLinkDto(link);
    for (const side of [link.expenseTransactionKey.transactionKey, link.reimbursementTransactionKey.transactionKey]) {
      if (!keys.has(side)) continue;
      byTransaction.set(side, [...(byTransaction.get(side) ?? []), dto]);
    }
  }
  return byTransaction;
}

/**
 * What the other side of a link could be, for `transactionKey`. For a reimbursement: expenses
 * dated up to {@link SUGGESTION_WINDOW_DAYS} days before it, from the same merchant or for at
 * least its amount. For an expense: incoming transactions up to that many days after it, from the
 * same merchant or for no more than its amount. Always the same currency, visible to the same
 * members, with something left to link, and not already linked to it. With `search`, the window
 * and the merchant-or-amount rule give way to the text, matched in the description or the
 * merchant's name. Same merchant first, then the closest in time.
 */
export async function suggestReimbursementCounterparts(em: EntityManager, actor: Actor, transactionKey: number, options: { limit: number; search?: string }): Promise<ReimbursementSuggestionDto[]> {
  const anchor = await findVisible(em, actor, transactionKey);
  const role = reimbursementRoleOf(anchor);
  if (role === null || isTransfer(anchor) || !anchor.settlementCurrencyKey || !anchor.accountKey) return [];
  const anchorAmount = big(settlementOf(anchor) ?? 0).abs();
  const anchorRemaining = remainingOf(anchor, (await linkedTotals(em, [anchor], role)).get(anchor.transactionKey) ?? 0);
  if (anchorRemaining <= 0) return [];
  const wantedRole: ReimbursementRole = role === 'expense' ? 'reimbursement' : 'expense';
  const search = options.search?.trim();

  const settlement = (alias: string) => `coalesce("${alias}"."edited_settlement_amount", "${alias}"."settlement_amount")`;
  const conditions: Record<string, unknown>[] = [
    { [raw((alias: string) => `(${settlement(alias)} ${wantedRole === 'expense' ? '<' : '>'} 0)`)]: true },
    { [raw((alias: string) => `(${notTransferSql(alias)})`)]: true },
    { [raw((alias: string) => `("${alias}"."transfer_counterpart_key" is null)`)]: true },
  ];
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
    conditions.push({ $or: [{ description: { $ilike: pattern } }, { transactionMerchantKey: { name: { $ilike: pattern } } }] });
  } else if (anchor.transactionDate) {
    const window = SUGGESTION_WINDOW_DAYS * DAY_MS;
    const date = anchor.transactionDate.getTime();
    conditions.push({ transactionDate: wantedRole === 'expense' ? { $gte: new Date(date - window), $lte: anchor.transactionDate } : { $gte: anchor.transactionDate, $lte: new Date(date + window) } });
    const amountRule = { [raw((alias: string) => `(abs(${settlement(alias)}) ${wantedRole === 'expense' ? '>=' : '<='} ${anchorAmount.toFixed(AMOUNT_SCALE)})`)]: true };
    conditions.push(anchor.transactionMerchantKey ? { $or: [{ transactionMerchantKey: anchor.transactionMerchantKey }, amountRule] } : amountRule);
  } else {
    return [];
  }

  const account = anchor.accountKey;
  const candidates = await em.find(
    Transaction,
    excludeExpired({
      $and: conditions,
      accountKey: { $and: [visibleAccountWhere(actor.appuserKey), { deletedAt: null, isPrivate: account.isPrivate, tenantKey: getRef(em, Tenant, actor.tenantKey) }] },
      deletedAt: null,
      settlementCurrencyKey: anchor.settlementCurrencyKey,
      tenantKey: getRef(em, Tenant, actor.tenantKey),
      transactionKey: { $ne: anchor.transactionKey },
    }),
    { limit: Math.max(options.limit * 3, 30), orderBy: { transactionDate: wantedRole === 'expense' ? 'desc' : 'asc', transactionKey: 'desc' }, populate: LINKED_TRANSACTION_POPULATE },
  );
  if (candidates.length === 0) return [];

  const linkedOnCandidates = await linkedTotals(em, candidates, wantedRole);
  const alreadyLinked = new Set(
    (await em.find(TransactionReimbursement, {
      deletedAt: null,
      ...(role === 'expense' ? { expenseTransactionKey: anchor, reimbursementTransactionKey: { $in: candidates } } : { expenseTransactionKey: { $in: candidates }, reimbursementTransactionKey: anchor }),
    })).map((link) => (role === 'expense' ? link.reimbursementTransactionKey : link.expenseTransactionKey).transactionKey),
  );
  const anchorMerchant = anchor.transactionMerchantKey?.transactionMerchantKey;
  const anchorTime = anchor.transactionDate?.getTime() ?? 0;
  const shared = await loadSharedAccountKeys(em, actor);
  // Only accounts seen by exactly the same members as the anchor's (see `reimbursement-sql.ts`).
  const audiences = await loadAccountAudiences(em, [account.accountKey, ...candidates.flatMap((candidate) => (candidate.accountKey ? [candidate.accountKey.accountKey] : []))]);
  const anchorAudience = audiences.get(account.accountKey);
  return candidates
    .filter((candidate) => !alreadyLinked.has(candidate.transactionKey) && isVisibleTo(candidate, actor, shared)
      && candidate.accountKey !== undefined && audiences.get(candidate.accountKey.accountKey) === anchorAudience)
    .map((candidate) => {
      const sameMerchant = anchorMerchant !== undefined && candidate.transactionMerchantKey?.transactionMerchantKey === anchorMerchant;
      const reason: ReimbursementSuggestionDto['reason'] = search ? 'search' : sameMerchant ? 'merchant' : 'amount';
      return { ...toLinkedTransactionDto(candidate), reason, remainingAmount: remainingOf(candidate, linkedOnCandidates.get(candidate.transactionKey) ?? 0) };
    })
    .filter((suggestion) => suggestion.remainingAmount > 0)
    .sort((a, b) => Number(b.reason === 'merchant') - Number(a.reason === 'merchant')
      || Math.abs((a.transactionDate?.getTime() ?? 0) - anchorTime) - Math.abs((b.transactionDate?.getTime() ?? 0) - anchorTime)
      || b.transactionKey - a.transactionKey)
    .slice(0, options.limit);
}

/**
 * Remove the live links of transactions being deleted, on either side, with an audit entry on the
 * other side (the deleted row has its own `soft_deleted` entry). The caller flushes. Totals stop
 * counting a link whose side is deleted anyway (`reimbursement-sql.ts`); this keeps the stored
 * links true too, so the other side can be linked again in full.
 */
export async function removeReimbursementLinksOf(em: EntityManager, actor: Actor, transactions: Transaction[], now: Date): Promise<void> {
  if (transactions.length === 0) return;
  const links = await em.find(
    TransactionReimbursement,
    { $or: [{ expenseTransactionKey: { $in: transactions } }, { reimbursementTransactionKey: { $in: transactions } }], deletedAt: null },
    { filters: { [HIDDEN_FILTER]: false }, populate: ['expenseTransactionKey.accountKey', 'reimbursementTransactionKey.accountKey'] },
  );
  const deleted = new Set(transactions.map((transaction) => transaction.transactionKey));
  for (const link of links) {
    link.deletedAt = now;
    for (const side of [link.expenseTransactionKey, link.reimbursementTransactionKey]) {
      if (deleted.has(side.transactionKey)) continue;
      await audit(em, actor, side, 'transaction-delete', { from: auditValue(link), to: null });
    }
  }
}
