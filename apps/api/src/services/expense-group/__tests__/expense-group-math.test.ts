import { describe, expect, it } from 'vitest';

import { computeBalances, computeShares, simplifyDebts } from '../expense-group-math';

/*
 * The arithmetic of a group: how a transaction's amount is shared out (equal, amounts,
 * percentages), and who owes whom from shares, payments and settlements. Every share adds up to
 * the transaction exactly, and every currency's balances add up to zero.
 */
describe('sharing a transaction out', () => {
  const amounts = (shares: { amount: number }[]) => shares.map((share) => share.amount);

  it('shares equally, the rounding remainder on the first person', () => {
    expect(amounts(computeShares(-100, 'equal', [{ memberKey: 1 }, { memberKey: 2 }, { memberKey: 3 }]))).toEqual([-33.34, -33.33, -33.33]);
    expect(amounts(computeShares(-60, 'equal', [{ memberKey: 1 }, { memberKey: 2 }, { memberKey: 3 }]))).toEqual([-20, -20, -20]);
  });

  it('keeps the transaction sign, so a shared refund is shared as money in', () => {
    expect(amounts(computeShares(30, 'equal', [{ memberKey: 1 }, { memberKey: 2 }]))).toEqual([15, 15]);
  });

  it('takes amounts as positive shares of the whole and gives them the transaction sign', () => {
    expect(computeShares(-50, 'amounts', [{ amount: 30.5, memberKey: 1 }, { amount: 19.5, memberKey: 2 }])).toEqual([{ amount: -30.5, memberKey: 1 }, { amount: -19.5, memberKey: 2 }]);
  });

  it('refuses amounts that do not add up, a zero share and too many decimals', () => {
    expect(() => computeShares(-50, 'amounts', [{ amount: 30, memberKey: 1 }, { amount: 10, memberKey: 2 }])).toThrow(/add up/);
    expect(() => computeShares(-50, 'amounts', [{ amount: 50, memberKey: 1 }, { amount: 0, memberKey: 2 }])).toThrow();
    expect(() => computeShares(-50, 'amounts', [{ amount: 49.99999, memberKey: 1 }, { amount: 0.00001, memberKey: 2 }])).toThrow();
    expect(() => computeShares(-50, 'amounts', [{ amount: -50, memberKey: 1 }])).toThrow();
  });

  it('shares by percentages that make exactly 100, rounding to cents with the remainder on the largest', () => {
    expect(amounts(computeShares(-99.99, 'percentages', [{ memberKey: 1, percentage: 50 }, { memberKey: 2, percentage: 25 }, { memberKey: 3, percentage: 25 }]))).toEqual([-49.99, -25, -25]);
    expect(amounts(computeShares(-10, 'percentages', [{ memberKey: 1, percentage: 33.33 }, { memberKey: 2, percentage: 33.33 }, { memberKey: 3, percentage: 33.34 }]))).toEqual([-3.33, -3.33, -3.34]);
    expect(() => computeShares(-10, 'percentages', [{ memberKey: 1, percentage: 50 }, { memberKey: 2, percentage: 49 }])).toThrow(/100/);
    expect(() => computeShares(-10, 'percentages', [{ memberKey: 1, percentage: 100 }, { memberKey: 2, percentage: 0 }])).toThrow();
  });

  it('always adds up to the transaction exactly', () => {
    for (const total of [-0.07, -1, -10.01, -333.33, -1000.0001, 12.34]) {
      for (const people of [1, 2, 3, 6, 7]) {
        const shares = computeShares(total, 'equal', Array.from({ length: people }, (_, index) => ({ memberKey: index + 1 })));
        const sum = shares.reduce((acc, share) => acc + Math.round(share.amount * 10_000), 0);
        expect(sum).toBe(Math.round(total * 10_000));
      }
    }
  });

  it('refuses a share that would round to nothing, nobody, and the same person twice', () => {
    expect(() => computeShares(-0.02, 'equal', [{ memberKey: 1 }, { memberKey: 2 }, { memberKey: 3 }])).toThrow();
    expect(() => computeShares(-10, 'equal', [])).toThrow();
    expect(() => computeShares(-10, 'equal', [{ memberKey: 1 }, { memberKey: 1 }])).toThrow(/twice/);
  });
});

describe('group balances', () => {
  const YOU = 1;
  const ALICE = 2;
  const BOB = 3;
  const members = [YOU, ALICE, BOB];
  const of = (balances: ReturnType<typeof computeBalances>, currencyCode: string) => {
    const currency = balances.find((entry) => entry.currencyCode === currencyCode);
    return Object.fromEntries((currency?.members ?? []).map((member) => [member.memberKey, member.balance]));
  };

  it('credits the payer with what they paid and debits everyone their share', () => {
    const balances = computeBalances(members, [{ currencyCode: 'EUR', paidByMemberKey: YOU, shares: [{ amount: -20, memberKey: YOU }, { amount: -20, memberKey: ALICE }, { amount: -20, memberKey: BOB }] }], [], 'EUR');
    expect(of(balances, 'EUR')).toEqual({ [ALICE]: -20, [BOB]: -20, [YOU]: 40 });
    const you = balances[0]!.members.find((member) => member.memberKey === YOU)!;
    expect(you).toMatchObject({ paid: 60, settlementsPaid: 0, settlementsReceived: 0, share: 20 });
  });

  it('a settlement moves both people towards zero', () => {
    const expense = { currencyCode: 'EUR', paidByMemberKey: YOU, shares: [{ amount: -20, memberKey: YOU }, { amount: -20, memberKey: ALICE }, { amount: -20, memberKey: BOB }] };
    const balances = computeBalances(members, [expense], [{ amount: 20, currencyCode: 'EUR', fromMemberKey: ALICE, toMemberKey: YOU }], 'EUR');
    expect(of(balances, 'EUR')).toEqual({ [ALICE]: 0, [BOB]: -20, [YOU]: 20 });
  });

  it('handles uneven shares and a refund shared back', () => {
    const balances = computeBalances(members, [
      { currencyCode: 'EUR', paidByMemberKey: ALICE, shares: [{ amount: -33.34, memberKey: YOU }, { amount: -33.33, memberKey: ALICE }, { amount: -33.33, memberKey: BOB }] },
      { currencyCode: 'EUR', paidByMemberKey: ALICE, shares: [{ amount: 5, memberKey: YOU }, { amount: 5, memberKey: BOB }] },
    ], [], 'EUR');
    expect(of(balances, 'EUR')).toEqual({ [ALICE]: 56.67, [BOB]: -28.33, [YOU]: -28.34 });
  });

  it('keeps each currency apart, each adding up to zero, the group currency first', () => {
    const balances = computeBalances(members, [
      { currencyCode: 'USD', paidByMemberKey: YOU, shares: [{ amount: -10, memberKey: YOU }, { amount: -10, memberKey: BOB }] },
      { currencyCode: 'EUR', paidByMemberKey: BOB, shares: [{ amount: -7.5, memberKey: YOU }, { amount: -7.5, memberKey: ALICE }] },
    ], [{ amount: 2.5, currencyCode: 'GBP', fromMemberKey: ALICE, toMemberKey: BOB }], 'EUR');
    expect(balances.map((entry) => entry.currencyCode)).toEqual(['EUR', 'GBP', 'USD']);
    expect(of(balances, 'USD')).toEqual({ [ALICE]: 0, [BOB]: -10, [YOU]: 10 });
    expect(of(balances, 'EUR')).toEqual({ [ALICE]: -7.5, [BOB]: 15, [YOU]: -7.5 });
    expect(of(balances, 'GBP')).toEqual({ [ALICE]: 2.5, [BOB]: -2.5, [YOU]: 0 });
    for (const entry of balances) expect(entry.members.reduce((sum, member) => sum + Math.round(member.balance * 10_000), 0)).toBe(0);
  });

  it('lists every member, at zero when they have nothing yet', () => {
    expect(computeBalances(members, [], [], 'EUR')).toEqual([]);
    const balances = computeBalances(members, [{ currencyCode: 'EUR', paidByMemberKey: YOU, shares: [{ amount: -5, memberKey: ALICE }] }], [], 'EUR');
    expect(of(balances, 'EUR')).toEqual({ [ALICE]: -5, [BOB]: 0, [YOU]: 5 });
  });
});

describe('simplifying debts', () => {
  const total = (payments: { amount: number }[]) => payments.reduce((sum, payment) => sum + payment.amount, 0);

  it('clears every balance with at most one payment fewer than the people owed or owing', () => {
    const payments = simplifyDebts([{ balance: 40, memberKey: 1 }, { balance: -20, memberKey: 2 }, { balance: -20, memberKey: 3 }]);
    expect(payments).toEqual([{ amount: 20, fromMemberKey: 2, toMemberKey: 1 }, { amount: 20, fromMemberKey: 3, toMemberKey: 1 }]);
  });

  it('pays the largest debt to the largest credit first, so chains collapse', () => {
    // 1 owes 2 ten, 2 owes 3 ten: 1 pays 3 directly.
    expect(simplifyDebts([{ balance: -10, memberKey: 1 }, { balance: 0, memberKey: 2 }, { balance: 10, memberKey: 3 }])).toEqual([{ amount: 10, fromMemberKey: 1, toMemberKey: 3 }]);
    const payments = simplifyDebts([{ balance: 50, memberKey: 1 }, { balance: 25.5, memberKey: 2 }, { balance: -60, memberKey: 3 }, { balance: -15.5, memberKey: 4 }]);
    expect(payments.length).toBeLessThanOrEqual(3);
    expect(total(payments)).toBeCloseTo(75.5, 4);
    const after = new Map([[1, 50], [2, 25.5], [3, -60], [4, -15.5]]);
    for (const payment of payments) {
      after.set(payment.fromMemberKey, after.get(payment.fromMemberKey)! + payment.amount);
      after.set(payment.toMemberKey, after.get(payment.toMemberKey)! - payment.amount);
    }
    for (const value of after.values()) expect(Math.abs(value)).toBeLessThan(0.00005);
  });

  it('suggests nothing when everyone is square', () => {
    expect(simplifyDebts([{ balance: 0, memberKey: 1 }, { balance: 0, memberKey: 2 }])).toEqual([]);
  });
});
