import { type EntityManager, LockMode } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import type { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { ExpenseGroup } from '@entity/ExpenseGroup';
import { ExpenseGroupExpense, ExpenseGroupSplitMethod } from '@entity/ExpenseGroupExpense';
import { ExpenseGroupMember } from '@entity/ExpenseGroupMember';
import { ExpenseGroupSettlement } from '@entity/ExpenseGroupSettlement';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionReimbursement } from '@entity/TransactionReimbursement';
import { TransactionSplit } from '@entity/TransactionSplit';
import { type AccountActor, assertAccountsWritable, isAccountVisibleTo, loadSharedAccountKeys } from '@service/account/account-access';
import { findAssignableCategory } from '@service/transaction/household-category';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { TRANSFER_TYPE_NAMES } from '@service/transaction/transaction-scope';
import { removeGroupShareLines, writeGroupShareLines } from '@service/transaction/transaction-split.service';
import { isExpiredStatusName } from '@service/transaction/transaction-status';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import { big, toNumber } from '@utils/money';

import { type BalanceExpense, type BalanceSettlement, computeBalances, computeShares, type CurrencyBalances, type ShareInput, type SplitMethod } from './expense-group-math';

/**
 * Expense groups: people who share costs, what each of them owes, and how they settle up.
 *
 * ## The model
 *
 * A group (`ExpenseGroup`) has members (`ExpenseGroupMember`): people of the household, linked to
 * their user, and people with no WonderMoney account, known by name. The member who creates a group
 * is in it. A cost is shared by splitting one of the household's transactions by person: each
 * share is a line of the transaction's split (`TransactionSplit.expenseGroupMemberKey`, written by
 * `transaction-split.service.ts`), and `ExpenseGroupExpense` records the group and who paid. The
 * payer is someone of the household: the money left one of its accounts. Paying each other back is
 * a settlement (`ExpenseGroupSettlement`), optionally linked to the transaction that moved the
 * money. Balances are computed on every read (`expense-group-math.ts`), per currency.
 *
 * ## Totals
 *
 * The household's totals count only its own people's shares: a share of someone outside the
 * household is money owed back, and a linked settlement is that money coming back (or going out to
 * pay a debt), so neither is spending or income (`expense-group-sql.ts`, `category-lines.ts`). To
 * keep every amount counted once, a transaction plays one part at a time: a shared expense, a
 * settlement, or a reimbursement (#41) with its links; and never a transfer between own accounts
 * or a loan repayment (409 `expense_group_transaction_conflict`). A transaction is shared in one
 * group at most.
 *
 * ## Tenancy and privacy
 *
 * Groups, members and settlements belong to the household and every member of it sees them. A
 * shared expense follows its transaction's account visibility (`account-access.ts`): one on a
 * private account the member does not see is neither listed nor counted in the balances that
 * member sees, and they cannot share, unshare or link it ("not found"). Sharing, unsharing, and
 * linking or unlinking a settlement change the transaction's totals, so they also need write
 * access to its account (403 `account_read_only` for a member who may only view it). So a member's view of a group is always the part they may see, and its
 * balances still add up to zero. A settlement linked to a transaction they cannot see shows no
 * transaction, and only the member who can see it may remove it. Everything is scoped to the
 * actor's household explicitly (another household's group is "not found"); viewers are read-only
 * through `blockViewerWrite`.
 *
 * ## Member attribution ("Spent by")
 *
 * A share is not an attribution. A shared transaction keeps its one "Spent by"
 * (`household/member-attribution.ts`: its own, else its account's owner, or Shared), and the
 * member filter keeps or drops it whole, at what it counts for the household: the shares of
 * everyone of the household together. A group member who is someone of the household changes
 * which shares count for the household, never whose spending the transaction is.
 *
 * Archiving hides a group from the lists clients offer for new expenses; it changes nothing else.
 * A group with shared expenses or settlements cannot be deleted (409 `expense_group_not_empty`),
 * and a member with any cannot be removed (409 `expense_group_member_in_use`).
 */

export interface ExpenseGroupDto {
  archived: boolean;
  createdAt: Date;
  currencyCode: string;
  expenseGroupKey: number;
  members: ExpenseGroupMemberDto[];
  name: string;
  /** The viewer's balance per currency (positive: they are owed); empty when they are not in the group. */
  yourBalances: { amount: number; currencyCode: string }[];
}

export interface ExpenseGroupMemberDto {
  /** The household member this person is; null for someone outside the household. */
  appuserKey: null | number;
  email: null | string;
  expenseGroupMemberKey: number;
  /** Whether their shares count in the household's totals. */
  isHouseholdMember: boolean;
  /** Whether this person is the viewer. */
  isYou: boolean;
  name: string;
  position: number;
}

export interface GroupBalancesDto {
  currencies: CurrencyBalances[];
  expenseGroupKey: number;
}

export interface GroupExpenseDto {
  /** The category every share is in; null when uncategorized. */
  categoryKey: null | number;
  currencyCode: null | string;
  expenseGroupExpenseKey: number;
  expenseGroupKey: number;
  paidByMemberKey: number;
  /** Signed like the transaction (money out is negative), in `currencyCode`; they add up to its amount. */
  shares: { amount: number; expenseGroupMemberKey: number }[];
  splitMethod: SplitMethod;
  transaction: GroupTransactionDto;
}

export interface GroupSettlementDto {
  /** Positive, in `currencyCode`. */
  amount: number;
  createdAt: Date;
  currencyCode: string;
  expenseGroupKey: number;
  expenseGroupSettlementKey: number;
  fromMemberKey: number;
  /** Whether the settlement is linked to a transaction, seen or not. */
  isLinked: boolean;
  notes: null | string;
  settledOn: string;
  toMemberKey: number;
  /** The linked transaction, when the viewer may see it. */
  transaction: GroupTransactionDto | null;
}

export interface GroupTransactionDto {
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

export interface MemberInput {
  appuserKey?: null | number;
  email?: null | string;
  name: string;
}

export interface SettlementInput {
  amount: number;
  /** The group's currency when left out. */
  currencyCode?: string;
  fromMemberKey: number;
  notes?: null | string;
  /** `YYYY-MM-DD`. */
  settledOn: string;
  toMemberKey: number;
  transactionKey?: null | number;
}

export interface SettlementSuggestionDto extends GroupTransactionDto {
  /** What is left to link on it, positive. */
  remainingAmount: number;
}

export interface ShareExpenseInput {
  /** The category every share goes in; the transaction's current one when left out. */
  categoryKey?: null | number;
  method: SplitMethod;
  paidByMemberKey: number;
  shares: ShareInput[];
  transactionKey: number;
}

/** The member asking; `householdRole` caps a viewer at read (`account-access.ts`). */
type Actor = AccountActor;

const AMOUNT_SCALE = 4;
const SPLIT_METHODS: Record<SplitMethod, ExpenseGroupSplitMethod> = {
  amounts: ExpenseGroupSplitMethod.AMOUNTS,
  equal: ExpenseGroupSplitMethod.EQUAL,
  percentages: ExpenseGroupSplitMethod.PERCENTAGES,
};
/** How far back settlement suggestions look. */
const SUGGESTION_WINDOW_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSACTION_POPULATE = ['accountKey', 'settlementCurrencyKey', 'transactionMerchantKey', 'transactionStatusKey', 'transactionTypeKey'] as const;

// ---------------------------------------------------------------------------------------------
// Groups and members
// ---------------------------------------------------------------------------------------------

/** The household's groups, newest first, with their members and the viewer's balances. */
export async function getExpenseGroup(em: EntityManager, actor: Actor, expenseGroupKey: number): Promise<ExpenseGroupDto> {
  const group = await findGroup(em, actor, expenseGroupKey);
  return toGroupDto(group, actor, await balancesOf(em, actor, group));
}

export async function listExpenseGroups(em: EntityManager, actor: Actor): Promise<ExpenseGroupDto[]> {
  const groups = await em.find(ExpenseGroup, { deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey) }, { filters: false, orderBy: { createdAt: 'desc', expenseGroupKey: 'desc' }, populate: ['currencyKey', 'members'] });
  return Promise.all(groups.map(async (group) => toGroupDto(group, actor, await balancesOf(em, actor, group))));
}

/** Create a group; the creator is its first member, then `members` in order. */
export async function createExpenseGroup(em: EntityManager, actor: Actor, input: { currencyCode: string; members?: MemberInput[]; name: string }): Promise<ExpenseGroupDto> {
  const key = await em.transactional(async (tx) => {
    const currency = await findCurrency(tx, input.currencyCode);
    const creator = await tx.findOneOrFail(Appuser, { appuserKey: actor.appuserKey }, { filters: false });
    const group = tx.create(ExpenseGroup, {
      archived: false,
      createdByAppuserKey: creator,
      currencyKey: currency,
      name: input.name.trim(),
      tenantKey: getRef(tx, Tenant, actor.tenantKey),
    }, { partial: true });
    const others = (input.members ?? []).filter((member) => member.appuserKey !== actor.appuserKey);
    const people: MemberInput[] = [{ appuserKey: actor.appuserKey, name: displayName(creator) }, ...others];
    const seen = new Set<number>();
    for (const [position, person] of people.entries()) {
      if (person.appuserKey != null) {
        if (seen.has(person.appuserKey)) throw new BadRequestError('A household member can only be in a group once', ERROR_CODE.EXPENSE_GROUP_MEMBER_INVALID);
        seen.add(person.appuserKey);
      }
      await addMemberRow(tx, actor, group, person, position);
    }
    await tx.flush();
    return group.expenseGroupKey;
  });
  return getExpenseGroup(em, actor, key);
}

export async function updateExpenseGroup(em: EntityManager, actor: Actor, expenseGroupKey: number, input: { archived?: boolean; currencyCode?: string; name?: string }): Promise<ExpenseGroupDto> {
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    if (input.name !== undefined) group.name = input.name.trim();
    if (input.currencyCode !== undefined) group.currencyKey = await findCurrency(tx, input.currencyCode);
    if (input.archived !== undefined) group.archived = input.archived;
    await tx.flush();
  });
  return getExpenseGroup(em, actor, expenseGroupKey);
}

/** Delete an empty group (no shared expenses, no settlements, whoever can see them); 409 otherwise. */
export async function addExpenseGroupMember(em: EntityManager, actor: Actor, expenseGroupKey: number, input: MemberInput): Promise<ExpenseGroupMemberDto> {
  const memberKey = await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey, true);
    const live = liveMembers(group);
    if (input.appuserKey != null && live.some((member) => member.appuserKey?.appuserKey === input.appuserKey)) {
      throw new BadRequestError('This household member is already in the group', ERROR_CODE.EXPENSE_GROUP_MEMBER_INVALID);
    }
    const position = live.reduce((max, member) => Math.max(max, member.position + 1), 0);
    const member = await addMemberRow(tx, actor, group, input, position);
    await tx.flush();
    return member.expenseGroupMemberKey;
  });
  const group = await findGroup(em, actor, expenseGroupKey);
  return toMemberDto(liveMembers(group).find((member) => member.expenseGroupMemberKey === memberKey)!, actor);
}

export async function deleteExpenseGroup(em: EntityManager, actor: Actor, expenseGroupKey: number): Promise<void> {
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey, true);
    const [expenses, settlements] = await Promise.all([
      tx.count(ExpenseGroupExpense, { deletedAt: null, expenseGroupKey: group }, { filters: false }),
      tx.count(ExpenseGroupSettlement, { deletedAt: null, expenseGroupKey: group }, { filters: false }),
    ]);
    if (expenses + settlements > 0) throw new ConflictError('This group has shared expenses or settlements; archive it instead', ERROR_CODE.EXPENSE_GROUP_NOT_EMPTY);
    const now = new Date();
    group.deletedAt = now;
    for (const member of group.members.getItems()) member.deletedAt ??= now;
    await tx.flush();
  });
}

/** Rename a member or change their email. Whether they are of the household is fixed. */
export async function updateExpenseGroupMember(em: EntityManager, actor: Actor, expenseGroupKey: number, expenseGroupMemberKey: number, input: { email?: null | string; name?: string }): Promise<ExpenseGroupMemberDto> {
  return em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    const member = memberOf(group, expenseGroupMemberKey);
    if (input.name !== undefined) member.name = input.name.trim();
    if (input.email !== undefined) member.email = input.email?.trim() || null;
    await tx.flush();
    return toMemberDto(member, actor);
  });
}

/** Remove a member with no shares, payments or settlements; 409 otherwise. */
export async function removeExpenseGroupMember(em: EntityManager, actor: Actor, expenseGroupKey: number, expenseGroupMemberKey: number): Promise<void> {
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey, true);
    const member = memberOf(group, expenseGroupMemberKey);
    const [shares, payments, settlements] = await Promise.all([
      tx.count(TransactionSplit, { deletedAt: null, expenseGroupMemberKey: member }, { filters: false }),
      tx.count(ExpenseGroupExpense, { deletedAt: null, paidByMemberKey: member }, { filters: false }),
      tx.count(ExpenseGroupSettlement, { $or: [{ fromMemberKey: member }, { toMemberKey: member }], deletedAt: null }, { filters: false }),
    ]);
    if (shares + payments + settlements > 0) throw new ConflictError('This person has shares, payments or settlements in the group', ERROR_CODE.EXPENSE_GROUP_MEMBER_IN_USE);
    member.deletedAt = new Date();
    await tx.flush();
  });
}

// ---------------------------------------------------------------------------------------------
// Shared expenses
// ---------------------------------------------------------------------------------------------

/** The group's shared expenses the viewer may see, newest first. */
export async function getGroupExpense(em: EntityManager, actor: Actor, expenseGroupKey: number, transactionKey: number): Promise<GroupExpenseDto> {
  const group = await findGroup(em, actor, expenseGroupKey);
  const found = (await loadVisibleExpenses(em, actor, group, transactionKey))[0];
  if (!found) throw new NotFoundError('Shared expense not found');
  return toExpenseDto(found.expense, found.lines);
}

export async function listGroupExpenses(em: EntityManager, actor: Actor, expenseGroupKey: number): Promise<GroupExpenseDto[]> {
  const group = await findGroup(em, actor, expenseGroupKey);
  const loaded = await loadVisibleExpenses(em, actor, group);
  return loaded
    .sort((a, b) => (b.expense.transactionKey.transactionDate?.getTime() ?? 0) - (a.expense.transactionKey.transactionDate?.getTime() ?? 0) || b.expense.expenseGroupExpenseKey - a.expense.expenseGroupExpenseKey)
    .map(({ expense, lines }) => toExpenseDto(expense, lines));
}

/**
 * Share a transaction in the group, or change how it is shared: each person's share becomes a line
 * of its split, in one category, and `paidByMemberKey` paid it. See the module comment for what may
 * be shared; 404 for a transaction the member cannot see.
 */
export async function shareGroupExpense(em: EntityManager, actor: Actor, expenseGroupKey: number, input: ShareExpenseInput): Promise<GroupExpenseDto> {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.EXPENSE_GROUP_SHARES_INVALID);
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    const transaction = await findVisibleTransaction(tx, actor, input.transactionKey, true);
    await assertTransactionAccountWritable(tx, transaction, actor);
    await assertFreeForGroup(tx, transaction, { allowShared: true });

    const existing = await tx.findOne(ExpenseGroupExpense, { deletedAt: null, transactionKey: transaction }, { filters: false });
    if (existing && existing.expenseGroupKey.expenseGroupKey !== group.expenseGroupKey) {
      throw new ConflictError('This transaction is already shared in another group', ERROR_CODE.EXPENSE_GROUP_TRANSACTION_CONFLICT);
    }

    const payer = memberOf(group, input.paidByMemberKey, invalid);
    if (payer.appuserKey == null) throw invalid('The payer is someone of the household: the money left one of its accounts');
    const members = input.shares.map((share) => memberOf(group, share.memberKey, invalid));

    const amount = settlementOf(transaction);
    if (amount === null || amount === 0) throw invalid('A transaction with no amount cannot be shared');
    const computed = computeShares(amount, input.method, input.shares);

    const category = await resolveCategory(tx, actor, transaction, input.categoryKey);
    await writeGroupShareLines(tx, transaction, computed.map((share, index) => ({ amount: share.amount, category, member: members[index]! })), {
      actorAppuserKey: actor.appuserKey,
      actorType: TransactionAuditActorType.USER,
      source: 'expense-group-shares',
    });

    if (existing) {
      existing.paidByMemberKey = payer;
      existing.splitMethod = SPLIT_METHODS[input.method];
    } else {
      tx.create(ExpenseGroupExpense, {
        expenseGroupKey: group,
        paidByMemberKey: payer,
        splitMethod: SPLIT_METHODS[input.method],
        tenantKey: getRef(tx, Tenant, actor.tenantKey),
        transactionKey: transaction,
      }, { partial: true });
    }
    await tx.flush();
  });
  return getGroupExpense(em, actor, expenseGroupKey, input.transactionKey);
}

/** Stop sharing a transaction: it is no longer split, and keeps the shares' category. */
export async function unshareGroupExpense(em: EntityManager, actor: Actor, expenseGroupKey: number, transactionKey: number): Promise<void> {
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    const transaction = await findVisibleTransaction(tx, actor, transactionKey, true, { allowExpired: true });
    await assertTransactionAccountWritable(tx, transaction, actor);
    const expense = await tx.findOne(ExpenseGroupExpense, { deletedAt: null, expenseGroupKey: group, transactionKey: transaction }, { filters: false });
    if (!expense) throw new NotFoundError('Shared expense not found');
    await removeGroupShareLines(tx, transaction, { actorAppuserKey: actor.appuserKey, actorType: TransactionAuditActorType.USER, source: 'expense-group-shares-remove' });
    expense.deletedAt ??= new Date();
    await tx.flush();
  });
}

// ---------------------------------------------------------------------------------------------
// Settlements and balances
// ---------------------------------------------------------------------------------------------

/** Who owes whom, per currency, from what the viewer may see, with the payments that would clear it. */
export async function getGroupBalances(em: EntityManager, actor: Actor, expenseGroupKey: number): Promise<GroupBalancesDto> {
  const group = await findGroup(em, actor, expenseGroupKey);
  return { currencies: await balancesOf(em, actor, group), expenseGroupKey: group.expenseGroupKey };
}

/** The group's settlements, newest first. */
export async function listGroupSettlements(em: EntityManager, actor: Actor, expenseGroupKey: number): Promise<GroupSettlementDto[]> {
  const group = await findGroup(em, actor, expenseGroupKey);
  const settlements = await loadSettlements(em, group);
  const shared = await loadSharedAccountKeys(em, actor);
  return settlements
    .sort((a, b) => b.settledOn.localeCompare(a.settledOn) || b.expenseGroupSettlementKey - a.expenseGroupSettlementKey)
    .map((settlement) => toSettlementDto(settlement, actor, shared));
}

/**
 * Record that `fromMemberKey` paid `toMemberKey` back, optionally linking the household
 * transaction that moved the money (see `ExpenseGroupSettlement` for what can be linked).
 */
export async function recordGroupSettlement(em: EntityManager, actor: Actor, expenseGroupKey: number, input: SettlementInput): Promise<GroupSettlementDto> {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.EXPENSE_GROUP_SETTLEMENT_INVALID);
  const key = await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    const from = memberOf(group, input.fromMemberKey, invalid);
    const to = memberOf(group, input.toMemberKey, invalid);
    if (from.expenseGroupMemberKey === to.expenseGroupMemberKey) throw invalid('Someone cannot pay themselves back');
    const amount = big(input.amount);
    if (amount.lte(0) || !amount.round(AMOUNT_SCALE).eq(amount)) throw invalid(`The amount must be positive, with at most ${AMOUNT_SCALE} decimals`);
    const currency = input.currencyCode ? await findCurrency(tx, input.currencyCode) : group.currencyKey;

    let transaction: null | Transaction = null;
    if (input.transactionKey != null) {
      transaction = await findVisibleTransaction(tx, actor, input.transactionKey, true);
      // A linked settlement changes the transaction's totals: the member must be able to change its account.
      await assertTransactionAccountWritable(tx, transaction, actor);
      await assertFreeForGroup(tx, transaction, { allowShared: false });
      const household = (member: ExpenseGroupMember) => member.appuserKey != null;
      if (household(from) === household(to)) throw invalid('Only a payment between someone of the household and someone outside it can be linked to a transaction');
      const direction = settlementOf(transaction) ?? 0;
      if (household(to) && direction <= 0) throw invalid('Money paid to the household is money coming in');
      if (household(from) && direction >= 0) throw invalid('Money the household paid is money going out');
      if (transaction.settlementCurrencyKey?.currencyKey !== currency.currencyKey) {
        throw new BadRequestError('A settlement can only be linked to a transaction in its currency', ERROR_CODE.EXPENSE_GROUP_CURRENCY_MISMATCH);
      }
      const remaining = await remainingToSettle(tx, transaction);
      if (amount.gt(big(remaining))) throw new BadRequestError(`At most ${remaining} can still be linked`, ERROR_CODE.EXPENSE_GROUP_AMOUNT_EXCEEDED);
    }

    const settlement = tx.create(ExpenseGroupSettlement, {
      amount: toNumber(amount, AMOUNT_SCALE),
      currencyKey: currency,
      expenseGroupKey: group,
      fromMemberKey: from,
      notes: input.notes?.trim() || null,
      recordedByAppuserKey: getRef(tx, Appuser, actor.appuserKey),
      settledOn: input.settledOn,
      tenantKey: getRef(tx, Tenant, actor.tenantKey),
      toMemberKey: to,
      transactionKey: transaction,
    }, { partial: true });
    await tx.flush();
    if (transaction) await auditSettlement(tx, actor, transaction, 'expense-group-settlement', { from: null, to: auditValue(settlement) });
    await tx.flush();
    return settlement.expenseGroupSettlementKey;
  });
  const settlement = (await loadSettlements(em, await findGroup(em, actor, expenseGroupKey))).find((row) => row.expenseGroupSettlementKey === key)!;
  return toSettlementDto(settlement, actor, await loadSharedAccountKeys(em, actor));
}

/**
 * Remove a settlement. 404 when it is not in the group, or is linked to a transaction the member
 * cannot see (it is not theirs to remove: its totals are someone else's).
 */
export async function deleteGroupSettlement(em: EntityManager, actor: Actor, expenseGroupKey: number, expenseGroupSettlementKey: number): Promise<void> {
  await em.transactional(async (tx) => {
    const group = await findGroup(tx, actor, expenseGroupKey);
    const settlement = await tx.findOne(
      ExpenseGroupSettlement,
      { deletedAt: null, expenseGroupKey: group, expenseGroupSettlementKey },
      { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!settlement) throw new NotFoundError('Settlement not found');
    let linked: null | Transaction = null;
    if (settlement.transactionKey) {
      linked = await tx.findOne(Transaction, { transactionKey: settlement.transactionKey.transactionKey }, { filters: false, populate: ['accountKey'] });
      if (linked && !linked.deletedAt) {
        if (!isVisibleTo(linked, actor, await loadSharedAccountKeys(tx, actor))) throw new NotFoundError('Settlement not found');
        await assertTransactionAccountWritable(tx, linked, actor);
      }
    }
    settlement.deletedAt = new Date();
    if (linked && !linked.deletedAt) await auditSettlement(tx, actor, linked, 'expense-group-settlement-remove', { from: auditValue(settlement), to: null });
    await tx.flush();
  });
}

/**
 * Transactions that could be the money behind a settlement from `fromMemberKey` to
 * `toMemberKey`: money in when someone outside the household pays it back, money out when the
 * household pays someone; in `currencyCode` (the group's by default), from the last 120 days or
 * matching `search`, with something left to link, and free of any other part (see the module comment).
 */
export async function suggestSettlementTransactions(em: EntityManager, actor: Actor, expenseGroupKey: number, input: { currencyCode?: string; fromMemberKey: number; limit: number; search?: string; toMemberKey: number }): Promise<SettlementSuggestionDto[]> {
  const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.EXPENSE_GROUP_SETTLEMENT_INVALID);
  const group = await findGroup(em, actor, expenseGroupKey);
  const from = memberOf(group, input.fromMemberKey, invalid);
  const to = memberOf(group, input.toMemberKey, invalid);
  if ((from.appuserKey != null) === (to.appuserKey != null)) return [];
  const moneyIn = to.appuserKey != null;
  const currency = input.currencyCode ? await findCurrency(em, input.currencyCode) : group.currencyKey;
  const sign = moneyIn ? { $gt: 0 } : { $lt: 0 };
  const search = input.search?.trim();
  const candidates = await em.find(Transaction, {
    $and: [
      { $or: [{ editedSettlementAmount: sign }, { editedSettlementAmount: null, settlementAmount: sign }] },
      ...(search ? [{ $or: [{ description: { $ilike: `%${escapeLike(search)}%` } }, { transactionMerchantKey: { name: { $ilike: `%${escapeLike(search)}%` } } }] }] : [{ transactionDate: { $gte: new Date(Date.now() - SUGGESTION_WINDOW_DAYS * DAY_MS) } }]),
    ],
    deletedAt: null,
    settlementCurrencyKey: currency,
    tenantKey: getRef(em, Tenant, actor.tenantKey),
  }, { filters: false, limit: 200, orderBy: { transactionDate: 'desc', transactionKey: 'desc' }, populate: TRANSACTION_POPULATE });

  const sharedWithActor = await loadSharedAccountKeys(em, actor);
  const visible = candidates.filter((transaction) => isVisibleTo(transaction, actor, sharedWithActor) && !isExpiredStatusName(transaction.transactionStatusKey?.name) && !isTransfer(transaction));
  const keys = visible.map((transaction) => transaction.transactionKey);
  if (keys.length === 0) return [];
  const [shared, reimbursements, repayments, settled] = await Promise.all([
    em.find(TransactionSplit, { deletedAt: null, expenseGroupMemberKey: { $ne: null }, transactionKey: { transactionKey: { $in: keys } } }, { fields: ['transactionKey'], filters: false }),
    em.find(TransactionReimbursement, { $or: [{ expenseTransactionKey: { transactionKey: { $in: keys } } }, { reimbursementTransactionKey: { transactionKey: { $in: keys } } }], deletedAt: null }, { fields: ['expenseTransactionKey', 'reimbursementTransactionKey'], filters: false }),
    em.find(LoanRepaymentLink, { deletedAt: null, transactionKey: { transactionKey: { $in: keys } } }, { fields: ['transactionKey'], filters: false }),
    em.find(ExpenseGroupSettlement, { deletedAt: null, transactionKey: { transactionKey: { $in: keys } } }, { fields: ['amount', 'transactionKey'], filters: false }),
  ]);
  const taken = new Set<number>([
    ...shared.map((row) => row.transactionKey.transactionKey),
    ...reimbursements.flatMap((row) => [row.expenseTransactionKey.transactionKey, row.reimbursementTransactionKey.transactionKey]),
    ...repayments.map((row) => row.transactionKey.transactionKey),
  ]);
  const settledTotals = new Map<number, number>();
  for (const row of settled) {
    const key = row.transactionKey?.transactionKey;
    if (key !== undefined) settledTotals.set(key, toNumber(big(settledTotals.get(key) ?? 0).plus(big(row.amount)), AMOUNT_SCALE));
  }
  return visible
    .filter((transaction) => !taken.has(transaction.transactionKey))
    .map((transaction) => ({ ...toTransactionDto(transaction), remainingAmount: remainingOf(transaction, settledTotals.get(transaction.transactionKey) ?? 0) }))
    .filter((suggestion) => suggestion.remainingAmount > 0)
    .slice(0, input.limit);
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

async function addMemberRow(em: EntityManager, actor: Actor, group: ExpenseGroup, input: MemberInput, position: number): Promise<ExpenseGroupMember> {
  let appuser: Appuser | null = null;
  if (input.appuserKey != null) {
    const membership = await em.findOne(AppuserTenant, { appuserKey: { appuserKey: input.appuserKey }, recordActive: true, tenantKey: { tenantKey: actor.tenantKey } }, { filters: false, populate: ['appuserKey'] });
    if (!membership) throw new BadRequestError('Only a member of this household can be linked', ERROR_CODE.EXPENSE_GROUP_MEMBER_INVALID);
    appuser = membership.appuserKey;
  }
  const name = input.name.trim() || (appuser ? displayName(appuser) : '');
  if (!name) throw new BadRequestError('A person needs a name', ERROR_CODE.EXPENSE_GROUP_MEMBER_INVALID);
  const member = em.create(ExpenseGroupMember, {
    appuserKey: appuser,
    email: input.email?.trim() || null,
    expenseGroupKey: group,
    name,
    position,
    tenantKey: group.tenantKey,
  }, { partial: true });
  group.members.add(member);
  return member;
}

/** Whether nothing else already takes this transaction's amount off the totals. See the module comment. */
async function assertFreeForGroup(em: EntityManager, transaction: Transaction, options: { allowShared: boolean }): Promise<void> {
  const conflict = (message: string) => new ConflictError(message, ERROR_CODE.EXPENSE_GROUP_TRANSACTION_CONFLICT);
  if (isTransfer(transaction)) throw conflict('A transfer between your own accounts cannot be shared or settle a debt');
  const [repayments, reimbursements, settlements, shares] = await Promise.all([
    em.count(LoanRepaymentLink, { deletedAt: null, transactionKey: transaction }, { filters: false }),
    em.count(TransactionReimbursement, { $or: [{ expenseTransactionKey: transaction }, { reimbursementTransactionKey: transaction }], deletedAt: null }, { filters: false }),
    em.count(ExpenseGroupSettlement, { deletedAt: null, transactionKey: transaction }, { filters: false }),
    options.allowShared ? Promise.resolve(0) : em.count(TransactionSplit, { deletedAt: null, expenseGroupMemberKey: { $ne: null }, transactionKey: transaction }, { filters: false }),
  ]);
  if (repayments > 0) throw conflict('A loan repayment cannot be shared or settle a debt');
  if (reimbursements > 0) throw conflict('A transaction linked as a reimbursement cannot be shared or settle a debt');
  if (settlements > 0 && options.allowShared) throw conflict('A transaction that settles a debt cannot be shared');
  if (shares > 0) throw conflict('A shared expense cannot also settle a debt');
}

async function auditSettlement(em: EntityManager, actor: Actor, transaction: Transaction, source: string, change: { from: unknown; to: unknown }): Promise<void> {
  await TransactionAuditService.log(em, {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: actor.appuserKey,
    actorType: TransactionAuditActorType.USER,
    appuserKey: transaction.appuserKey?.appuserKey ?? actor.appuserKey,
    changes: { expenseGroupSettlement: change },
    eventType: TransactionAuditEventType.USER_EDIT,
    source,
    tenantKey: actor.tenantKey,
    transactionKey: transaction.transactionKey,
  }, { flush: false });
}

function auditValue(settlement: ExpenseGroupSettlement) {
  return {
    amount: toNumber(big(settlement.amount), AMOUNT_SCALE),
    expenseGroupKey: settlement.expenseGroupKey.expenseGroupKey,
    expenseGroupSettlementKey: settlement.expenseGroupSettlementKey,
    fromMemberKey: settlement.fromMemberKey.expenseGroupMemberKey,
    toMemberKey: settlement.toMemberKey.expenseGroupMemberKey,
  };
}

async function balancesOf(em: EntityManager, actor: Actor, group: ExpenseGroup): Promise<CurrencyBalances[]> {
  const [expenses, settlements] = await Promise.all([loadVisibleExpenses(em, actor, group), loadSettlements(em, group)]);
  const balanceExpenses: BalanceExpense[] = expenses.flatMap(({ expense, lines }) => {
    const currencyCode = expense.transactionKey.settlementCurrencyKey?.code;
    if (!currencyCode) return [];
    return [{
      currencyCode,
      paidByMemberKey: expense.paidByMemberKey.expenseGroupMemberKey,
      shares: lines.map((line) => ({ amount: line.amount, memberKey: line.expenseGroupMemberKey!.expenseGroupMemberKey })),
    }];
  });
  const balanceSettlements: BalanceSettlement[] = settlements.map((settlement) => ({
    amount: settlement.amount,
    currencyCode: settlement.currencyKey.code,
    fromMemberKey: settlement.fromMemberKey.expenseGroupMemberKey,
    toMemberKey: settlement.toMemberKey.expenseGroupMemberKey,
  }));
  return computeBalances(liveMembers(group).map((member) => member.expenseGroupMemberKey), balanceExpenses, balanceSettlements, group.currencyKey.code);
}

function displayName(appuser: Appuser): string {
  const name = [appuser.firstName, appuser.lastName].filter((part) => part?.trim()).join(' ').trim();
  return (name || appuser.emailAddress.split('@')[0] || 'You').slice(0, 100);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function findCurrency(em: EntityManager, code: string): Promise<Currency> {
  const currency = await em.findOne(Currency, { code: code.toUpperCase() }, { filters: false });
  if (!currency) throw new BadRequestError('Unknown currency');
  return currency;
}

/** The household's live group, its members and currency loaded. 404 for anything else. */
async function findGroup(em: EntityManager, actor: Actor, expenseGroupKey: number, lock = false): Promise<ExpenseGroup> {
  const group = await em.findOne(
    ExpenseGroup,
    { deletedAt: null, expenseGroupKey, tenantKey: getRef(em, Tenant, actor.tenantKey) },
    { filters: false, populate: ['currencyKey', 'members', 'members.appuserKey'], ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
  );
  if (!group) throw new NotFoundError('Expense group not found');
  return group;
}

async function findVisibleTransaction(em: EntityManager, actor: Actor, transactionKey: number, lock: boolean, options: { allowExpired?: boolean } = {}): Promise<Transaction> {
  const transaction = await em.findOne(
    Transaction,
    { deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey), transactionKey },
    { filters: false, populate: TRANSACTION_POPULATE, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
  );
  if (!transaction || !isVisibleTo(transaction, actor, await loadSharedAccountKeys(em, actor))) throw new NotFoundError('Transaction not found');
  if (!options.allowExpired && isExpiredStatusName(transaction.transactionStatusKey?.name)) throw new NotFoundError('Transaction not found');
  return transaction;
}

function isTransfer(transaction: Transaction): boolean {
  const type = transaction.transactionTypeKey?.name;
  return transaction.transferCounterpartKey != null || (type !== undefined && (TRANSFER_TYPE_NAMES as readonly string[]).includes(type));
}

/**
 * Whether the member may see the transaction: same household, live, on a live account they see
 * (`account-access.ts`: shared, their own, or shared with them; `sharedAccountKeys` from
 * `loadSharedAccountKeys`).
 */
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

/** 403 `account_read_only` when the member may only view the transaction's account. */
async function assertTransactionAccountWritable(em: EntityManager, transaction: Transaction, actor: Actor): Promise<void> {
  if (transaction.accountKey) await assertAccountsWritable(em, [transaction.accountKey], actor);
}

function liveMembers(group: ExpenseGroup): ExpenseGroupMember[] {
  return group.members.getItems().filter((member) => !member.deletedAt).sort((a, b) => a.position - b.position || a.expenseGroupMemberKey - b.expenseGroupMemberKey);
}

async function loadSettlements(em: EntityManager, group: ExpenseGroup): Promise<ExpenseGroupSettlement[]> {
  return em.find(ExpenseGroupSettlement, { deletedAt: null, expenseGroupKey: group }, {
    filters: false,
    populate: ['currencyKey', 'transactionKey.accountKey', 'transactionKey.settlementCurrencyKey', 'transactionKey.transactionMerchantKey'],
  });
}

/**
 * The group's shared expenses the viewer may see, each with its live share lines: the transaction
 * is live, not EXPIRED (it never moved money), and not on another member's private account. A
 * hidden transaction still counts: hiding keeps it out of spending, not out of who owes whom.
 */
async function loadVisibleExpenses(em: EntityManager, actor: Actor, group: ExpenseGroup, transactionKey?: number): Promise<{ expense: ExpenseGroupExpense; lines: TransactionSplit[] }[]> {
  const expenses = await em.find(
    ExpenseGroupExpense,
    { deletedAt: null, expenseGroupKey: group, ...(transactionKey === undefined ? {} : { transactionKey: { transactionKey } }) },
    { filters: false, populate: TRANSACTION_POPULATE.map((path) => `transactionKey.${path}` as const) },
  );
  const shared = await loadSharedAccountKeys(em, actor);
  const visible = expenses.filter((expense) => isVisibleTo(expense.transactionKey, actor, shared) && !isExpiredStatusName(expense.transactionKey.transactionStatusKey?.name));
  if (visible.length === 0) return [];
  const lines = await em.find(
    TransactionSplit,
    { deletedAt: null, expenseGroupMemberKey: { $ne: null }, transactionKey: { $in: visible.map((expense) => expense.transactionKey) } },
    { filters: false, orderBy: { position: 'asc', transactionSplitKey: 'asc' } },
  );
  return visible
    .map((expense) => ({ expense, lines: lines.filter((line) => line.transactionKey.transactionKey === expense.transactionKey.transactionKey) }))
    .filter(({ lines: own }) => own.length > 0);
}

function memberOf(group: ExpenseGroup, expenseGroupMemberKey: number, error: (message: string) => Error = (message) => new NotFoundError(message)): ExpenseGroupMember {
  const member = liveMembers(group).find((candidate) => candidate.expenseGroupMemberKey === expenseGroupMemberKey);
  if (!member) throw error('This person is not in the group');
  return member;
}

function remainingOf(transaction: Transaction, linked: number): number {
  const amount = settlementOf(transaction);
  if (amount === null) return 0;
  const remaining = big(amount).abs().minus(big(linked));
  return remaining.lt(0) ? 0 : toNumber(remaining, AMOUNT_SCALE);
}

async function remainingToSettle(em: EntityManager, transaction: Transaction): Promise<number> {
  const linked = await em.find(ExpenseGroupSettlement, { deletedAt: null, transactionKey: transaction }, { fields: ['amount'], filters: false });
  return remainingOf(transaction, linked.reduce((sum, row) => toNumber(big(sum).plus(big(row.amount)), AMOUNT_SCALE), 0));
}

async function resolveCategory(em: EntityManager, actor: Actor, transaction: Transaction, categoryKey: null | number | undefined): Promise<Category | null> {
  if (categoryKey === null) return null;
  if (categoryKey !== undefined) {
    const category = await findAssignableCategory(em, actor.tenantKey, categoryKey);
    if (!category) throw new NotFoundError('Category not found');
    return category;
  }
  await em.populate(transaction, ['appuserTransactionCategories.categoryKey'], { filters: false });
  return transaction.appuserTransactionCategories.getItems().find((assignment) => !assignment.deletedAt)?.categoryKey ?? null;
}

/** The effective settlement amount: the user's edit when there is one. */
function settlementOf(transaction: Pick<Transaction, 'editedSettlementAmount' | 'settlementAmount'>): null | number {
  const value = transaction.editedSettlementAmount ?? transaction.settlementAmount;
  return value == null ? null : toNumber(big(value), AMOUNT_SCALE);
}

function toExpenseDto(expense: ExpenseGroupExpense, lines: TransactionSplit[]): GroupExpenseDto {
  return {
    categoryKey: lines[0]?.categoryKey?.categoryKey ?? null,
    currencyCode: expense.transactionKey.settlementCurrencyKey?.code ?? null,
    expenseGroupExpenseKey: expense.expenseGroupExpenseKey,
    expenseGroupKey: expense.expenseGroupKey.expenseGroupKey,
    paidByMemberKey: expense.paidByMemberKey.expenseGroupMemberKey,
    shares: lines.map((line) => ({ amount: toNumber(big(line.amount), AMOUNT_SCALE), expenseGroupMemberKey: line.expenseGroupMemberKey!.expenseGroupMemberKey })),
    splitMethod: expense.splitMethod,
    transaction: toTransactionDto(expense.transactionKey),
  };
}

function toGroupDto(group: ExpenseGroup, actor: Actor, balances: CurrencyBalances[]): ExpenseGroupDto {
  const members = liveMembers(group);
  const you = new Set(members.filter((member) => member.appuserKey?.appuserKey === actor.appuserKey).map((member) => member.expenseGroupMemberKey));
  return {
    archived: group.archived,
    createdAt: group.createdAt,
    currencyCode: group.currencyKey.code,
    expenseGroupKey: group.expenseGroupKey,
    members: members.map((member) => toMemberDto(member, actor)),
    name: group.name,
    yourBalances: you.size === 0 ? [] : balances.map((currency) => ({
      amount: toNumber(currency.members.filter((member) => you.has(member.memberKey)).reduce((sum, member) => sum.plus(big(member.balance)), big(0)), AMOUNT_SCALE),
      currencyCode: currency.currencyCode,
    })),
  };
}

function toMemberDto(member: ExpenseGroupMember, actor: Actor): ExpenseGroupMemberDto {
  const appuserKey = member.appuserKey?.appuserKey ?? null;
  return {
    appuserKey,
    email: member.email ?? null,
    expenseGroupMemberKey: member.expenseGroupMemberKey,
    isHouseholdMember: appuserKey !== null,
    isYou: appuserKey === actor.appuserKey,
    name: member.name,
    position: member.position,
  };
}

function toSettlementDto(settlement: ExpenseGroupSettlement, actor: Actor, sharedAccountKeys: ReadonlySet<number>): GroupSettlementDto {
  const linked = settlement.transactionKey;
  const shown = linked && !linked.deletedAt && isVisibleTo(linked, actor, sharedAccountKeys) ? toTransactionDto(linked) : null;
  return {
    amount: toNumber(big(settlement.amount), AMOUNT_SCALE),
    createdAt: settlement.createdAt,
    currencyCode: settlement.currencyKey.code,
    expenseGroupKey: settlement.expenseGroupKey.expenseGroupKey,
    expenseGroupSettlementKey: settlement.expenseGroupSettlementKey,
    fromMemberKey: settlement.fromMemberKey.expenseGroupMemberKey,
    isLinked: !!linked && !linked.deletedAt,
    notes: settlement.notes ?? null,
    settledOn: settlement.settledOn,
    toMemberKey: settlement.toMemberKey.expenseGroupMemberKey,
    transaction: shown,
  };
}

function toTransactionDto(transaction: Transaction): GroupTransactionDto {
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
