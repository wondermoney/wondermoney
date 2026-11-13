import { Big } from 'big.js';

import { allocateProRata } from '@service/transaction/category-lines';
import { BadRequestError, ERROR_CODE } from '@utils/errors';
import { big, toNumber } from '@utils/money';

/**
 * The arithmetic of expense groups, free of the database: sharing a transaction's amount out
 * between people, the balances that follow from shares, payments and settlements, and the
 * payments that would clear them.
 *
 * ## Shares
 *
 * A share is signed like the transaction it is part of (money out is negative), in its settlement
 * currency, and the shares always add up to the transaction's amount exactly:
 *
 * - **equal**: the amount over the people, each rounded half away from zero to cents, the
 *   remainder on the first person (`allocateProRata`);
 * - **percentages**: each person's percentage (more than 0, at most 2 decimals, together exactly
 *   100) of the amount, rounded the same way, the remainder on the largest percentage;
 * - **amounts**: each person's amount as entered (positive, at most 4 decimals, the money columns'
 *   scale), which must add up to the whole; it takes the transaction's sign.
 *
 * No share may be zero, and nobody may appear twice.
 *
 * ## Balances
 *
 * Per currency, never converted: a member's balance is what they paid, less their share, plus
 * the settlements they paid, less the settlements they received. Positive means the group owes
 * them; negative, they owe the group. Every share is part of one transaction whose payer is
 * credited the whole amount, and every settlement moves the same amount between two members, so
 * each currency's balances add up to zero exactly.
 *
 * ## Simplifying debts
 *
 * {@link simplifyDebts} clears a currency's balances greedily: the member who owes the most pays
 * the member owed the most, as much as one of them needs, and again until everyone is square. It
 * takes at most one payment fewer than the people with a balance (the fewest payments in general
 * is a hard problem; this is the usual answer and never worse than everyone paying the payer).
 */

export interface BalanceExpense {
  currencyCode: string;
  paidByMemberKey: number;
  /** Signed like the transaction; they add up to its amount. */
  shares: ComputedShare[];
}

export interface BalanceSettlement {
  /** Positive. */
  amount: number;
  currencyCode: string;
  fromMemberKey: number;
  toMemberKey: number;
}

export interface ComputedShare {
  /** Signed like the transaction, in its settlement currency. */
  amount: number;
  memberKey: number;
}

export interface CurrencyBalances {
  currencyCode: string;
  members: MemberBalance[];
  /** The payments that would clear every balance in this currency ({@link simplifyDebts}). */
  payments: SuggestedPayment[];
}

export interface MemberBalance {
  /** Positive: the group owes them; negative: they owe the group. */
  balance: number;
  memberKey: number;
  /** What they paid for the group (a shared refund they received counts against it). */
  paid: number;
  settlementsPaid: number;
  settlementsReceived: number;
  /** Their part of what the group spent. */
  share: number;
}

export interface ShareInput {
  /** For `amounts`: positive, the person's part of the whole. */
  amount?: number;
  memberKey: number;
  /** For `percentages`: more than 0, at most 2 decimals; the percentages make 100. */
  percentage?: number;
}

export type SplitMethod = 'amounts' | 'equal' | 'percentages';

export interface SuggestedPayment {
  amount: number;
  fromMemberKey: number;
  toMemberKey: number;
}

const AMOUNT_SCALE = 4;
const SHARE_SCALE = 2;
const PERCENT_SCALE = 2;

const invalid = (message: string) => new BadRequestError(message, ERROR_CODE.EXPENSE_GROUP_SHARES_INVALID);

/** Share `total` (the transaction's signed amount) out between `shares` by `method`. See the module comment. */
export function computeShares(total: number, method: SplitMethod, shares: ShareInput[]): ComputedShare[] {
  const whole = big(total);
  if (whole.eq(0)) throw invalid('A transaction with no amount cannot be shared');
  if (shares.length === 0) throw invalid('Sharing needs at least one person');
  if (new Set(shares.map((share) => share.memberKey)).size !== shares.length) throw invalid('A person can only be in a share once, not twice');
  const sign = whole.s;

  let amounts: number[];
  if (method === 'equal') {
    amounts = allocateProRata(whole, shares.map(() => 1), SHARE_SCALE);
  } else if (method === 'percentages') {
    const percentages = shares.map((share) => {
      if (share.percentage === undefined) throw invalid('Every person needs a percentage');
      const value = big(share.percentage);
      if (value.lte(0) || value.gt(100) || !value.round(PERCENT_SCALE).eq(value)) throw invalid(`A percentage is more than 0 and at most 100, with at most ${PERCENT_SCALE} decimals`);
      return value;
    });
    if (!percentages.reduce((sum, value) => sum.plus(value), new Big(0)).eq(100)) throw invalid('The percentages must make 100');
    amounts = allocateProRata(whole, percentages, SHARE_SCALE);
  } else {
    amounts = shares.map((share) => {
      if (share.amount === undefined) throw invalid('Every person needs an amount');
      const value = big(share.amount);
      if (value.lte(0) || !value.round(AMOUNT_SCALE).eq(value)) throw invalid(`A share is more than zero, with at most ${AMOUNT_SCALE} decimals`);
      return toNumber(sign < 0 ? value.neg() : value, AMOUNT_SCALE);
    });
    const sum = amounts.reduce((acc, value) => acc.plus(big(value)), new Big(0));
    if (!sum.eq(whole)) throw invalid('The shares must add up to the transaction\'s amount');
  }

  if (amounts.some((amount) => big(amount).eq(0))) throw invalid('Every share must be more than zero');
  return shares.map((share, index) => ({ amount: amounts[index]!, memberKey: share.memberKey }));
}

/**
 * The balances of `memberKeys` from `expenses` and `settlements`, per currency: only currencies
 * with something in them, the group's `defaultCurrencyCode` first, then by code.
 */
export function computeBalances(memberKeys: number[], expenses: BalanceExpense[], settlements: BalanceSettlement[], defaultCurrencyCode: string): CurrencyBalances[] {
  interface Running { paid: Big; settlementsPaid: Big; settlementsReceived: Big; share: Big }
  const byCurrency = new Map<string, Map<number, Running>>();
  const entry = (currencyCode: string, memberKey: number): Running => {
    let members = byCurrency.get(currencyCode);
    if (!members) {
      members = new Map(memberKeys.map((key) => [key, { paid: new Big(0), settlementsPaid: new Big(0), settlementsReceived: new Big(0), share: new Big(0) }]));
      byCurrency.set(currencyCode, members);
    }
    let running = members.get(memberKey);
    if (!running) {
      running = { paid: new Big(0), settlementsPaid: new Big(0), settlementsReceived: new Big(0), share: new Big(0) };
      members.set(memberKey, running);
    }
    return running;
  };

  for (const expense of expenses) {
    if (expense.shares.length === 0) continue;
    const total = expense.shares.reduce((sum, share) => sum.plus(big(share.amount)), new Big(0));
    const payer = entry(expense.currencyCode, expense.paidByMemberKey);
    // Money out is negative: the payer paid its opposite, each person's share is the opposite of their line.
    payer.paid = payer.paid.minus(total);
    for (const share of expense.shares) {
      const running = entry(expense.currencyCode, share.memberKey);
      running.share = running.share.minus(big(share.amount));
    }
  }
  for (const settlement of settlements) {
    const from = entry(settlement.currencyCode, settlement.fromMemberKey);
    from.settlementsPaid = from.settlementsPaid.plus(big(settlement.amount));
    const to = entry(settlement.currencyCode, settlement.toMemberKey);
    to.settlementsReceived = to.settlementsReceived.plus(big(settlement.amount));
  }

  const codes = [...byCurrency.keys()].sort((a, b) => (a === defaultCurrencyCode ? -1 : b === defaultCurrencyCode ? 1 : a.localeCompare(b)));
  return codes.map((currencyCode) => {
    const members = [...byCurrency.get(currencyCode)!.entries()].map(([memberKey, running]) => ({
      balance: toNumber(running.paid.minus(running.share).plus(running.settlementsPaid).minus(running.settlementsReceived), AMOUNT_SCALE),
      memberKey,
      paid: toNumber(running.paid, AMOUNT_SCALE),
      settlementsPaid: toNumber(running.settlementsPaid, AMOUNT_SCALE),
      settlementsReceived: toNumber(running.settlementsReceived, AMOUNT_SCALE),
      share: toNumber(running.share, AMOUNT_SCALE),
    }));
    return { currencyCode, members, payments: simplifyDebts(members) };
  });
}

/** The payments that clear `balances` (one currency's). See the module comment. */
export function simplifyDebts(balances: Pick<MemberBalance, 'balance' | 'memberKey'>[]): SuggestedPayment[] {
  const owed = balances.filter((member) => big(member.balance).gt(0)).map((member) => ({ left: big(member.balance), memberKey: member.memberKey }));
  const owing = balances.filter((member) => big(member.balance).lt(0)).map((member) => ({ left: big(member.balance).neg(), memberKey: member.memberKey }));
  const largestFirst = (a: { left: Big; memberKey: number }, b: { left: Big; memberKey: number }) => b.left.cmp(a.left) || a.memberKey - b.memberKey;
  const payments: SuggestedPayment[] = [];
  for (;;) {
    owed.sort(largestFirst);
    owing.sort(largestFirst);
    const creditor = owed[0];
    const debtor = owing[0];
    if (!creditor || !debtor || creditor.left.eq(0) || debtor.left.eq(0)) break;
    const amount = creditor.left.lt(debtor.left) ? creditor.left : debtor.left;
    payments.push({ amount: toNumber(amount, AMOUNT_SCALE), fromMemberKey: debtor.memberKey, toMemberKey: creditor.memberKey });
    creditor.left = creditor.left.minus(amount);
    debtor.left = debtor.left.minus(amount);
    if (creditor.left.eq(0)) owed.shift();
    if (debtor.left.eq(0)) owing.shift();
  }
  return payments;
}
