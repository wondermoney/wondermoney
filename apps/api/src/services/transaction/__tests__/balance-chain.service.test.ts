import { describe, expect, it, vi } from 'vitest';

import type { Account } from '@entity/Account';

import {
  accumulateChain,
  type ChainRow,
  isSettledStatusName,
  loadChainRows,
  openingFromTail,
  recalculateChainFromAccountBalance,
  SETTLED_TRANSACTION_STATUSES,
} from '../balance-chain.service';

function row(settlementAmount: number, appuserSettlementAmount?: number): ChainRow {
  return appuserSettlementAmount === undefined ? { settlementAmount } : { appuserSettlementAmount, settlementAmount };
}

describe('balance chain — accumulateChain', () => {
  it('accumulates each row onto the opening balance and returns the tail', () => {
    const rows = [row(10), row(-4), row(20)];
    const tail = accumulateChain(rows, { appuserCurrencyBalance: 0, balance: 0 });
    expect(rows.map((r) => r.balance)).toEqual([10, 6, 26]);
    expect(tail).toEqual({ appuserCurrencyBalance: 26, balance: 26 });
  });

  it('returns the opening unchanged for an empty chain', () => {
    expect(accumulateChain([], { appuserCurrencyBalance: 5, balance: 3 })).toEqual({ appuserCurrencyBalance: 5, balance: 3 });
  });

  it('tracks the appuser-currency chain separately when the amounts differ', () => {
    const rows = [row(10, 20), row(5, 11)];
    accumulateChain(rows, { appuserCurrencyBalance: 100, balance: 50 });
    expect(rows.map((r) => r.balance)).toEqual([60, 65]);
    expect(rows.map((r) => r.appuserCurrencyBalance)).toEqual([120, 131]);
  });

  it('falls back to the settlement amount when a row has no appuser amount', () => {
    const rows = [row(10)];
    accumulateChain(rows, { appuserCurrencyBalance: 0, balance: 0 });
    expect(rows[0]?.appuserCurrencyBalance).toBe(10);
  });

  it('treats a missing amount as zero rather than breaking the chain', () => {
    const rows: ChainRow[] = [{}, row(7)];
    accumulateChain(rows, { appuserCurrencyBalance: 0, balance: 4 });
    expect(rows.map((r) => r.balance)).toEqual([4, 11]);
  });
});

describe('balance chain — openingFromTail', () => {
  it('is the exact inverse of accumulateChain', () => {
    const rows = [row(10, 12), row(-4, -5), row(20, 21)];
    const tail = { appuserCurrencyBalance: 400, balance: 326 };
    const opening = openingFromTail(rows, tail);
    expect(accumulateChain(rows, opening)).toEqual(tail);
  });

  it('returns the tail itself for an empty chain', () => {
    expect(openingFromTail([], { appuserCurrencyBalance: 2, balance: 1 })).toEqual({ appuserCurrencyBalance: 2, balance: 1 });
  });
});

describe('balance chain — membership', () => {
  it('counts only settled statuses', () => {
    expect(SETTLED_TRANSACTION_STATUSES).toEqual(['BOOKED']);
    expect(isSettledStatusName('BOOKED')).toBe(true);
    // A pending authorisation has not settled and an expired one never will, so neither moved money.
    expect(isSettledStatusName('PENDING')).toBe(false);
    expect(isSettledStatusName('EXPIRED')).toBe(false);
    expect(isSettledStatusName(undefined)).toBe(false);
  });

  it('loads settled rows only, hidden rows included (RAD-25), in chain order', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), flush: vi.fn() };
    await loadChainRows(em, { accountKey: 11 } as unknown as Account, { transactionDate: { $ne: null } });
    const [, where, options] = em.find.mock.calls[0] ?? [];
    expect(where).toMatchObject({ accountKey: { accountKey: 11 }, transactionDate: { $ne: null }, transactionStatusKey: { name: { $in: ['BOOKED'] } } });
    expect(options).toMatchObject({ filters: { hidden: false }, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' } });
  });
});

describe('balance chain — recalculateChainFromAccountBalance', () => {
  it('rebuilds every row backwards from account.balance and lands the tail on it', async () => {
    const rows = [row(10), row(-4), row(20)];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    const account = { appuserCurrencyBalance: 26, balance: 26 } as unknown as Account;

    const { changed, tail } = await recalculateChainFromAccountBalance(em, account);

    expect(rows.map((r) => r.balance)).toEqual([10, 6, 26]);
    expect(changed).toBe(3);
    expect(tail).toEqual({ appuserCurrencyBalance: 26, balance: 26 });
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('never writes account.balance — the provider owns it', async () => {
    const rows = [row(10)];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    const account = { appuserCurrencyBalance: 999, balance: 500 } as { appuserCurrencyBalance: number; balance: number };

    await recalculateChainFromAccountBalance(em, account as unknown as Account);

    expect(account.balance).toBe(500);
    expect(account.appuserCurrencyBalance).toBe(999);
    expect(rows[0]?.balance).toBe(500);
  });

  it('is idempotent — a second run rewrites nothing', async () => {
    const rows = [row(10), row(5)];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    const account = { appuserCurrencyBalance: 20, balance: 20 } as unknown as Account;

    await recalculateChainFromAccountBalance(em, account);
    expect((await recalculateChainFromAccountBalance(em, account)).changed).toBe(0);
  });

  it('does nothing on an account with no chain rows', async () => {
    const em = { find: vi.fn().mockResolvedValue([]), flush: vi.fn() };
    expect((await recalculateChainFromAccountBalance(em, { balance: 10 } as unknown as Account)).changed).toBe(0);
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('falls back to account.balance when the account has no appuser-currency balance', async () => {
    const rows = [row(10)];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    await recalculateChainFromAccountBalance(em, { balance: 40 } as unknown as Account);
    expect(rows[0]?.appuserCurrencyBalance).toBe(40);
  });

  it('ignores sub-half-cent float noise when counting rewritten rows', async () => {
    const rows: ChainRow[] = [{ balance: 9.999_999_9, settlementAmount: 10 }];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    expect((await recalculateChainFromAccountBalance(em, { balance: 10 } as unknown as Account)).changed).toBe(0);
  });
});

describe('balance chain — recalculateChainFromAccountBalance anchored on an edited row', () => {
  it('recomputes only the suffix from the anchor and leaves every earlier row untouched', async () => {
    // A real-ish chain: several rows, settlement and appuser-settlement amounts differing, stored
    // balances deliberately inconsistent before the anchor so "untouched" is provable.
    const rows = [
      { appuserCurrencyBalance: 222, appuserSettlementAmount: 100, balance: 111, settlementAmount: 100, transactionKey: 1 },
      { appuserCurrencyBalance: 444, appuserSettlementAmount: 60, balance: 333, settlementAmount: 50, transactionKey: 2 },
      { appuserCurrencyBalance: 888, appuserSettlementAmount: -35, balance: 999, settlementAmount: -30, transactionKey: 3 },
      { appuserCurrencyBalance: 666, appuserSettlementAmount: 12, balance: 777, settlementAmount: 10, transactionKey: 4 },
    ];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };

    const { changed, tail } = await recalculateChainFromAccountBalance(em, { appuserCurrencyBalance: 0, balance: 0 } as unknown as Account, { transactionKey: 3 });

    // Rows before the anchor are never written, whatever value they hold.
    expect(rows[0]).toMatchObject({ appuserCurrencyBalance: 222, balance: 111 });
    expect(rows[1]).toMatchObject({ appuserCurrencyBalance: 444, balance: 333 });
    // The suffix opens on the anchor's predecessor (row 2) verbatim, then accumulates exactly.
    expect(rows[2]).toMatchObject({ appuserCurrencyBalance: 409, balance: 303 });
    expect(rows[3]).toMatchObject({ appuserCurrencyBalance: 421, balance: 313 });
    expect(rows.map((r) => r.transactionKey)).toEqual([1, 2, 3, 4]);
    expect(changed).toBe(2);
    expect(tail).toEqual({ appuserCurrencyBalance: 421, balance: 313 });
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('anchors on the oldest row with a zero opening when there is no predecessor', async () => {
    const rows = [
      { appuserSettlementAmount: 30, balance: 999, settlementAmount: 25, transactionKey: 1 },
      { balance: 888, settlementAmount: 5, transactionKey: 2 },
    ];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };

    const { tail } = await recalculateChainFromAccountBalance(em, { balance: 0 } as unknown as Account, { transactionKey: 1 });

    expect(rows[0]).toMatchObject({ appuserCurrencyBalance: 30, balance: 25 });
    expect(rows[1]).toMatchObject({ appuserCurrencyBalance: 35, balance: 30 });
    expect(tail).toEqual({ appuserCurrencyBalance: 35, balance: 30 });
  });

  it('falls back to the whole-account tail anchor when the anchor row is not a chain member', async () => {
    const rows = [row(10), row(-4), row(20)];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };

    const { changed } = await recalculateChainFromAccountBalance(em, { appuserCurrencyBalance: 26, balance: 26 } as unknown as Account, { transactionKey: 99 });

    expect(rows.map((r) => r.balance)).toEqual([10, 6, 26]);
    expect(changed).toBe(3);
  });

  it('never writes account.balance in anchor mode', async () => {
    const rows = [{ balance: 0, settlementAmount: 10, transactionKey: 1 }];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };
    const account = { appuserCurrencyBalance: 500, balance: 500 };

    await recalculateChainFromAccountBalance(em, account as unknown as Account, { transactionKey: 1 });

    expect(account.balance).toBe(500);
    expect(account.appuserCurrencyBalance).toBe(500);
    expect(rows[0]?.balance).toBe(10);
  });

  it('is idempotent for an anchored suffix — a second run rewrites nothing', async () => {
    const rows = [
      { balance: 100, settlementAmount: 100, transactionKey: 1 },
      { balance: 150, settlementAmount: 50, transactionKey: 2 },
      { balance: 120, settlementAmount: -30, transactionKey: 3 },
    ];
    const em = { find: vi.fn().mockResolvedValue(rows), flush: vi.fn() };

    expect((await recalculateChainFromAccountBalance(em, { balance: 0 } as unknown as Account, { transactionKey: 2 })).changed).toBe(0);
  });
});
