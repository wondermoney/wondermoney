import { type EntityManager, LockMode } from '@mikro-orm/core';
import { pick } from 'lodash-es';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import type { Category } from '@entity/Category';
import { ExpenseGroupExpense } from '@entity/ExpenseGroupExpense';
import type { ExpenseGroupMember } from '@entity/ExpenseGroupMember';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionSplit } from '@entity/TransactionSplit';
import { markUserCategorized } from '@service/transaction/categorization-confidence';
import { allocateProRata, categoryLinesOf, hasLiveSplits } from '@service/transaction/category-lines';
import { findAssignableCategory } from '@service/transaction/household-category';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import { big } from '@utils/money';

/**
 * Splitting a transaction over several categories, and keeping a split true to its transaction.
 *
 * ## The invariant
 *
 * A split has at least two lines; every line has the transaction's sign (none is zero); the lines
 * sum exactly to the transaction's effective settlement amount ({@link effectiveSettlementAmount}).
 * `PUT` checks it; {@link reconcileSplitsWithAmount} restores it whenever something changes the
 * amount afterwards.
 *
 * ## The transaction's own category
 *
 * While split, the transaction keeps one `AppuserTransactionCategory`: the largest line's
 * category (none when that line is uncategorized). Totals by category never read it for a split
 * transaction (they read the lines, `category-lines.ts`), but everything that shows "a category"
 * for a row (the mobile recent list, an older client) still shows a sensible one, and removing the
 * split leaves the transaction exactly there. Setting the lines does not teach the merchant's
 * learned category: a split says nothing about what the merchant usually is.
 *
 * ## When the amount changes later
 *
 * A bank sync, a pending row settling, or a user's amount edit can change the amount of a split
 * transaction. If the lines no longer add up, they are rescaled pro rata (cents, the largest line
 * taking the remainder) and the transaction goes back to the review inbox (`reviewed = false`).
 * When rescaling cannot keep the invariant (the amount is now zero or changed sign, or a line would
 * round to zero) the split is removed instead, leaving the largest line's category. An unchanged
 * amount leaves the split, and the review state, alone.
 *
 * Tags stay on the transaction, not on lines (a tag filter matches every line of a tagged
 * transaction); see the issue for the follow-up.
 *
 * ## Shares in an expense group
 *
 * A transaction shared in an expense group is split by person: every line carries the member whose
 * share it is (`expense-group/expense-group.service.ts` writes them through
 * {@link writeGroupShareLines}). Such a split is the group's: `PUT` and `DELETE` here refuse it (409
 * `transaction_in_expense_group`; change or remove the shares in the group), a category edit moves
 * every share to the new category instead of dropping the split, and an amount change rescales the
 * shares like any lines. When the split has to go (the amount became zero or changed sign), the
 * transaction leaves its group too. A group split may have a single line: someone else's share of
 * the whole amount.
 */

export interface SplitLineDto {
  /** In the settlement currency. */
  amount: number;
  /** The line's share of the transaction's amount in its owner's currency; null when that has none. */
  appuserAmount: null | number;
  category: CategoryDto | null;
  /** The person whose share this line is, for a transaction shared in an expense group. */
  expenseGroupMember: null | SplitLineMemberDto;
  notes: null | string;
  position: number;
  transactionSplitKey: number;
}

export interface SplitLineMemberDto {
  expenseGroupKey: number;
  expenseGroupMemberKey: number;
  /** Whether the person is a member of the household (their share counts in its totals). */
  isHouseholdMember: boolean;
  name: string;
}

/** One person's share, for {@link writeGroupShareLines}: signed like the transaction, in its settlement currency. */
export interface GroupShareLine {
  amount: number;
  category: Category | null;
  member: ExpenseGroupMember;
}

export interface SplitLineInput {
  amount: number;
  categoryKey: null | number;
  notes?: null | string;
}

export interface SplitTransactionDto {
  appuserSettlementAmount: null | number;
  appuserTransactionCategories: CategoryDto[];
  fxStatus: null | string;
  reviewed: boolean;
  /** The effective settlement amount the lines sum to. */
  settlementAmount: null | number;
  splits: SplitLineDto[];
  transactionKey: number;
}

interface Actor {
  appuserKey: number;
  tenantKey: number;
}

/** What {@link reconcileSplitsWithAmount} did. */
export type SplitReconciliation = 'none' | 'removed' | 'rescaled' | 'unchanged';

interface AuditContext {
  actorAppuserKey?: null | number;
  actorType: TransactionAuditActorType;
  source: string;
}

type CategoryDto = Pick<Category, 'bgColor' | 'categoryKey' | 'icon' | 'isSystemCategory' | 'name' | 'parentCategory' | 'textColor'>;

/** Amounts are stored as `numeric(18,4)`. */
const AMOUNT_SCALE = 4;
/** A rescaled line is rounded to cents; the largest line takes what is left. */
const RESCALE_SCALE = 2;
/** What `Transaction.splits` must be populated with to build {@link SplitLineDto}s. */
export const SPLIT_LINE_POPULATE = ['splits.categoryKey', 'splits.expenseGroupMemberKey'] as const;

/** The settlement amount the lines must sum to: the user's edit when there is one. */
export function effectiveSettlementAmount(transaction: Pick<Transaction, 'editedSettlementAmount' | 'settlementAmount'>): null | number {
  return transaction.editedSettlementAmount ?? transaction.settlementAmount ?? null;
}

const toCategoryDto = (category: Category): CategoryDto => pick(category, ['categoryKey', 'name', 'icon', 'bgColor', 'textColor', 'parentCategory', 'isSystemCategory']);

/** The live lines of a transaction for a list row or a response. Populate {@link SPLIT_LINE_POPULATE} first. */
export function toSplitLineDtos(transaction: Transaction): SplitLineDto[] {
  if (!hasLiveSplits(transaction)) return [];
  const lines = categoryLinesOf(transaction, transaction.appuserSettlementAmount ?? null);
  const byKey = new Map(transaction.splits.getItems().map((split) => [split.transactionSplitKey, split]));
  return lines.flatMap((line) => {
    const split = line.transactionSplitKey === null ? undefined : byKey.get(line.transactionSplitKey);
    if (!split) return [];
    const member = split.expenseGroupMemberKey;
    return [{
      amount: split.amount,
      appuserAmount: line.amount,
      category: line.category ? toCategoryDto(line.category) : null,
      expenseGroupMember: member
        ? { expenseGroupKey: member.expenseGroupKey.expenseGroupKey, expenseGroupMemberKey: member.expenseGroupMemberKey, isHouseholdMember: member.appuserKey != null, name: member.name }
        : null,
      notes: line.notes,
      position: split.position,
      transactionSplitKey: split.transactionSplitKey,
    }];
  });
}

/**
 * Replace a transaction's lines with `lines`. 404 when the member cannot see the transaction or a
 * category is not one the household can assign; 400 when the lines break the invariant; 409 for a
 * loan repayment. Sending the current lines again changes nothing.
 */
export async function setTransactionSplits(em: EntityManager, actor: Actor, transactionKey: number, lines: SplitLineInput[]): Promise<SplitTransactionDto> {
  await em.transactional(async (txEm) => {
    const transaction = await lockVisibleTransaction(txEm, actor, transactionKey);
    if (await txEm.count(LoanRepaymentLink, { deletedAt: null, transactionKey: transaction }) > 0) {
      throw new ConflictError('A loan repayment cannot be split', ERROR_CODE.TRANSACTION_HAS_LOAN_REPAYMENT);
    }
    assertValidLines(lines, effectiveSettlementAmount(transaction));
    const categories = await resolveCategories(txEm, actor.tenantKey, lines);

    const current = await liveSplits(txEm, transaction);
    assertNotGroupSplit(current);
    if (sameLines(current, lines)) return;

    const now = new Date();
    for (const line of current) line.deletedAt = now;
    lines.forEach((line, position) => {
      const split = new TransactionSplit();
      split.amount = line.amount;
      split.categoryKey = line.categoryKey === null ? null : categories.get(line.categoryKey)!;
      split.notes = line.notes ?? null;
      split.position = position;
      split.tenantKey = getRef(txEm, Tenant, actor.tenantKey);
      split.transactionKey = transaction;
      txEm.persist(split);
    });

    const largest = lines[largestIndex(lines.map((line) => line.amount))]!;
    const categoryChange = await mirrorAssignment(txEm, transaction, largest.categoryKey === null ? null : categories.get(largest.categoryKey)!, actor.appuserKey);
    markUserCategorized(transaction);
    await audit(txEm, transaction, { actorAppuserKey: actor.appuserKey, actorType: TransactionAuditActorType.USER, source: 'transaction-splits' }, {
      ...categoryChange,
      splits: { from: current.map(auditLine), to: lines.map((line) => ({ amount: line.amount, categoryKey: line.categoryKey })) },
    });
    await txEm.flush();
  });
  return loadSplitTransaction(em, actor, transactionKey);
}

/**
 * Remove a transaction's split; it keeps the largest line's category. Idempotent: a transaction
 * that is not split is returned unchanged. 404 when the member cannot see the transaction.
 */
export async function removeTransactionSplits(em: EntityManager, actor: Actor, transactionKey: number): Promise<SplitTransactionDto> {
  await em.transactional(async (txEm) => {
    const transaction = await lockVisibleTransaction(txEm, actor, transactionKey);
    const current = await liveSplits(txEm, transaction);
    if (current.length === 0) return;
    assertNotGroupSplit(current);
    await unsplit(txEm, transaction, current, { actorAppuserKey: actor.appuserKey, actorType: TransactionAuditActorType.USER, source: 'transaction-splits-remove' });
    await txEm.flush();
  });
  return loadSplitTransaction(em, actor, transactionKey);
}

/**
 * Drop the split of transactions a member is about to give `category` for their whole amount
 * (the category edit and bulk categorization). A transaction shared in an expense group keeps its
 * shares, each moved to `category`: the people sharing it have not changed. Audited per
 * transaction; the caller flushes.
 */
export async function removeSplitsBeforeCategorizing(em: EntityManager, transactions: Transaction[], actorAppuserKey: number, category: Category): Promise<void> {
  if (transactions.length === 0) return;
  const lines = await em.find(TransactionSplit, { transactionKey: { $in: transactions } }, { filters: { [HIDDEN_FILTER]: false } });
  const now = new Date();
  for (const transaction of transactions) {
    const current = sortLines(lines.filter((line) => line.transactionKey.transactionKey === transaction.transactionKey));
    if (current.length === 0) continue;
    const from = current.map(auditLine);
    if (current.some((line) => line.expenseGroupMemberKey)) {
      if (current.every((line) => line.categoryKey?.categoryKey === category.categoryKey)) continue;
      for (const line of current) line.categoryKey = category;
      await audit(em, transaction, { actorAppuserKey, actorType: TransactionAuditActorType.USER, source: 'expense-group-shares-categorize' }, { splits: { from, to: current.map(auditLine) } });
      continue;
    }
    for (const line of current) line.deletedAt = now;
    await audit(em, transaction, { actorAppuserKey, actorType: TransactionAuditActorType.USER, source: 'transaction-splits-remove' }, { splits: { from, to: [] } });
  }
}

/**
 * Replace the lines of `transaction` (locked by the caller) with one line per person's share in an
 * expense group. Checks the split invariant for shares: at least one line, each with the
 * transaction's sign and at most 4 decimals, summing exactly to the effective amount. The
 * transaction's own category becomes the largest share's. Audited; the caller flushes.
 */
export async function writeGroupShareLines(em: EntityManager, transaction: Transaction, shares: GroupShareLine[], context: AuditContext & { actorAppuserKey: number }): Promise<void> {
  assertValidShareAmounts(shares.map((share) => share.amount), effectiveSettlementAmount(transaction));
  const current = await liveSplits(em, transaction);
  const now = new Date();
  for (const line of current) line.deletedAt = now;
  const written = shares.map((share, position) => {
    const split = new TransactionSplit();
    split.amount = share.amount;
    split.categoryKey = share.category;
    split.expenseGroupMemberKey = share.member;
    split.notes = null;
    split.position = position;
    split.tenantKey = transaction.tenantKey!;
    split.transactionKey = transaction;
    em.persist(split);
    return split;
  });
  const largest = shares[largestIndex(shares.map((share) => share.amount))]!;
  const categoryChange = await mirrorAssignment(em, transaction, largest.category, context.actorAppuserKey);
  markUserCategorized(transaction);
  await audit(em, transaction, context, { ...categoryChange, splits: { from: sortLines(current).map(auditLine), to: written.map(auditLine) } });
}

/**
 * Remove the expense-group shares of `transaction` (locked by the caller): it is no longer split,
 * and keeps the largest share's category. Audited; the caller flushes.
 */
export async function removeGroupShareLines(em: EntityManager, transaction: Transaction, context: AuditContext): Promise<void> {
  const current = await liveSplits(em, transaction);
  if (current.length === 0) return;
  await unsplit(em, transaction, current, context);
}

/**
 * After a transaction's amount changed (sync, pending settling, user edit): rescale its lines so
 * they sum to the new amount again and mark it unreviewed, or remove the split when it cannot be
 * kept. Does nothing for a transaction that is not split or whose lines still add up. Flushes.
 *
 * Reads with the hidden filter off: a hidden transaction's split must follow its amount too.
 */
export async function reconcileSplitsWithAmount(em: EntityManager, transaction: Transaction, context: AuditContext): Promise<SplitReconciliation> {
  const current = sortLines(await liveSplits(em, transaction));
  if (current.length === 0) return 'none';
  const target = effectiveSettlementAmount(transaction);
  const linesTotal = current.reduce((sum, line) => sum.plus(big(line.amount)), big(0));
  if (target !== null && big(target).eq(linesTotal)) return 'unchanged';

  const rescaled = target === null || big(target).eq(0) || Math.sign(target) !== linesTotal.s ? null : allocateProRata(target, current.map((line) => line.amount), RESCALE_SCALE);
  if (!rescaled || rescaled.some((amount) => amount === 0 || Math.sign(amount) !== Math.sign(target!))) {
    await unsplit(em, transaction, current, context);
    transaction.reviewed = false;
    await em.flush();
    return 'removed';
  }

  const from = current.map(auditLine);
  current.forEach((line, index) => {
    line.amount = rescaled[index]!;
  });
  const wasReviewed = transaction.reviewed;
  transaction.reviewed = false;
  await audit(em, transaction, context, { ...(wasReviewed ? { reviewed: { from: true, to: false } } : {}), splits: { from, to: current.map(auditLine) } });
  await em.flush();
  return 'rescaled';
}

/** Whether a transaction is split (has live lines). Reads through the caller's filters. */
export async function isSplit(em: EntityManager, transaction: Transaction): Promise<boolean> {
  return (await em.count(TransactionSplit, { transactionKey: transaction }, { filters: { [HIDDEN_FILTER]: false } })) > 0;
}

function assertNotGroupSplit(current: TransactionSplit[]): void {
  if (current.some((line) => line.expenseGroupMemberKey)) {
    throw new ConflictError('This transaction is shared in an expense group; change its shares there', ERROR_CODE.TRANSACTION_IN_EXPENSE_GROUP);
  }
}

function assertValidLines(lines: SplitLineInput[], target: null | number): void {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.SPLIT_INVALID);
  if (target === null || target === 0) throw invalid('A transaction with no amount cannot be split');
  if (lines.length < 2) throw invalid('A split needs at least two lines');
  for (const line of lines) {
    const amount = big(line.amount);
    if (!amount.round(AMOUNT_SCALE).eq(amount)) throw invalid(`A line amount has at most ${AMOUNT_SCALE} decimals`);
    if (amount.eq(0) || Math.sign(line.amount) !== Math.sign(target)) throw invalid('Every line must have the transaction\'s sign');
  }
  const total = lines.reduce((sum, line) => sum.plus(big(line.amount)), big(0));
  if (!total.eq(big(target))) throw invalid('The lines must add up to the transaction\'s amount');
}

function assertValidShareAmounts(amounts: number[], target: null | number): void {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.EXPENSE_GROUP_SHARES_INVALID);
  if (target === null || target === 0) throw invalid('A transaction with no amount cannot be shared');
  if (amounts.length === 0) throw invalid('Sharing needs at least one share');
  for (const value of amounts) {
    const amount = big(value);
    if (!amount.round(AMOUNT_SCALE).eq(amount)) throw invalid(`A share has at most ${AMOUNT_SCALE} decimals`);
    if (amount.eq(0) || Math.sign(value) !== Math.sign(target)) throw invalid('Every share must be more than zero');
  }
  const total = amounts.reduce((sum, value) => sum.plus(big(value)), big(0));
  if (!total.eq(big(target))) throw invalid('The shares must add up to the transaction\'s amount');
}

function liveSplits(em: EntityManager, transaction: Transaction): Promise<TransactionSplit[]> {
  return em.find(TransactionSplit, { transactionKey: transaction }, { filters: { [HIDDEN_FILTER]: false }, orderBy: { position: 'asc', transactionSplitKey: 'asc' } });
}

async function loadSplitTransaction(em: EntityManager, actor: Actor, transactionKey: number): Promise<SplitTransactionDto> {
  const transaction = await em.findOneOrFail(
    Transaction,
    { tenantKey: getRef(em, Tenant, actor.tenantKey), transactionKey },
    { filters: { [HIDDEN_FILTER]: false }, populate: ['appuserTransactionCategories.categoryKey', ...SPLIT_LINE_POPULATE], refresh: true },
  );
  return {
    appuserSettlementAmount: transaction.appuserSettlementAmount ?? null,
    appuserTransactionCategories: transaction.appuserTransactionCategories.getItems().map((assignment) => toCategoryDto(assignment.categoryKey)),
    fxStatus: transaction.fxStatus ?? null,
    reviewed: transaction.reviewed,
    settlementAmount: effectiveSettlementAmount(transaction),
    splits: toSplitLineDtos(transaction),
    transactionKey: transaction.transactionKey,
  };
}

async function lockVisibleTransaction(em: EntityManager, actor: Actor, transactionKey: number): Promise<Transaction> {
  // The tenant filter (and its private-account carve-out) stays on: a member can only split what
  // they can see. Only the hidden filter is off, so a revealed hidden transaction can be split.
  const transaction = await em.findOne(
    Transaction,
    { deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey), transactionKey },
    { filters: { [HIDDEN_FILTER]: false }, lockMode: LockMode.PESSIMISTIC_WRITE },
  );
  if (!transaction) throw new NotFoundError('Transaction not found');
  return transaction;
}

async function resolveCategories(em: EntityManager, tenantKey: number, lines: SplitLineInput[]): Promise<Map<number, Category>> {
  const keys = [...new Set(lines.flatMap((line) => (line.categoryKey === null ? [] : [line.categoryKey])))];
  const categories = new Map<number, Category>();
  for (const key of keys) {
    const category = await findAssignableCategory(em, tenantKey, key);
    if (!category) throw new NotFoundError('Category not found');
    categories.set(key, category);
  }
  return categories;
}

function sameLines(current: TransactionSplit[], lines: SplitLineInput[]): boolean {
  if (current.length !== lines.length) return false;
  return sortLines(current).every((split, index) => {
    const line = lines[index]!;
    return big(split.amount).eq(big(line.amount)) && (split.categoryKey?.categoryKey ?? null) === line.categoryKey && (split.notes ?? null) === (line.notes ?? null);
  });
}

function sortLines(lines: TransactionSplit[]): TransactionSplit[] {
  return [...lines].sort((a, b) => a.position - b.position || a.transactionSplitKey - b.transactionSplitKey);
}

/** The line that keeps the transaction's category: largest absolute amount, the first on a tie (as in `allocateProRata`). */
function largestIndex(amounts: number[]): number {
  let largest = 0;
  amounts.forEach((amount, index) => {
    if (big(amount).abs().gt(big(amounts[largest]).abs())) largest = index;
  });
  return largest;
}

async function unsplit(em: EntityManager, transaction: Transaction, current: TransactionSplit[], context: AuditContext): Promise<void> {
  const ordered = sortLines(current);
  const largest = ordered[largestIndex(ordered.map((line) => line.amount))]!;
  const now = new Date();
  for (const line of ordered) line.deletedAt = now;
  // Without its shares, a transaction is no longer in its expense group.
  if (ordered.some((line) => line.expenseGroupMemberKey)) {
    const shared = await em.find(ExpenseGroupExpense, { deletedAt: null, transactionKey: transaction }, { filters: false });
    for (const row of shared) row.deletedAt = now;
  }
  const categoryChange = await mirrorAssignment(em, transaction, largest.categoryKey ?? null, context.actorAppuserKey ?? transaction.appuserKey?.appuserKey ?? null);
  await audit(em, transaction, context, { ...categoryChange, splits: { from: ordered.map(auditLine), to: [] } });
}

/**
 * Make `category` the transaction's single category assignment (none when null), without
 * touching merchant statistics. Returns the audit change when it moved.
 */
async function audit(em: EntityManager, transaction: Transaction, context: AuditContext, changes: Record<string, { from: unknown; to: unknown }>): Promise<void> {
  const tenantKey = transaction.tenantKey?.tenantKey;
  const appuserKey = transaction.appuserKey?.appuserKey ?? context.actorAppuserKey;
  if (tenantKey === undefined || appuserKey == null) return;
  await TransactionAuditService.log(em, {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: context.actorAppuserKey ?? null,
    actorType: context.actorType,
    appuserKey,
    changes,
    eventType: context.actorType === TransactionAuditActorType.USER ? TransactionAuditEventType.USER_EDIT : TransactionAuditEventType.SYSTEM_EDIT,
    source: context.source,
    tenantKey,
    transactionKey: transaction.transactionKey,
  }, { flush: false });
}

function auditLine(line: TransactionSplit) {
  const member = line.expenseGroupMemberKey?.expenseGroupMemberKey;
  return { amount: line.amount, categoryKey: line.categoryKey?.categoryKey ?? null, ...(member === undefined ? {} : { expenseGroupMemberKey: member }) };
}

async function mirrorAssignment(em: EntityManager, transaction: Transaction, category: Category | null, appuserKey: null | number): Promise<{ categoryKey?: { from: null | number; to: null | number } }> {
  const assignments = await em.find(AppuserTransactionCategory, { transactionKey: transaction }, { filters: { [HIDDEN_FILTER]: false }, orderBy: { appuserTransactionCategoryKey: 'asc' } });
  const [first, ...rest] = assignments;
  const from = first?.categoryKey.categoryKey ?? null;
  const to = category?.categoryKey ?? null;
  if (category === null) {
    for (const assignment of assignments) em.remove(assignment);
  } else if (first) {
    first.categoryKey = category;
    for (const assignment of rest) em.remove(assignment);
  } else if (appuserKey !== null) {
    const created = new AppuserTransactionCategory();
    created.appuserKey = getRef(em, Appuser, appuserKey);
    created.categoryKey = category;
    created.source = Source.USER;
    created.transactionKey = transaction;
    em.persist(created);
  }
  return from === to ? {} : { categoryKey: { from, to } };
}
