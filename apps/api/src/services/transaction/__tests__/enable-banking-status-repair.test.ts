import { describe, expect, it } from 'vitest';

import { planStatusRepair, type ReportedRow, type StoredStatusRow } from '../enable-banking-status-repair.service';

/*
 * Rows from an older Enable Banking sync may be stored as BOOKED whatever their provider status,
 * with no status recorded. The provider is the only witness: re-fetch the account and compare.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const coverageFrom = day('2026-03-01');

function reported(overrides: Partial<ReportedRow> & Pick<ReportedRow, 'id'>): ReportedRow {
  return { classification: 'booked', providerStatus: 'BOOK', ...overrides };
}

function stored(overrides: Partial<StoredStatusRow> & Pick<StoredStatusRow, 'enableBankingTransactionId' | 'transactionKey'>): StoredStatusRow {
  return { createdAt: day('2026-03-10'), currencyCode: 'EUR', hasUserEdits: false, settlementAmount: -12.5, status: 'BOOKED', transactionDate: day('2026-03-05'), ...overrides };
}

describe('planStatusRepair', () => {
  it('moves a row stored as booked back to pending while the provider still reports it pending', () => {
    const plan = planStatusRepair({ coverageFrom, reported: [reported({ classification: 'pending', id: 'a', providerStatus: 'PDNG' })], stored: [stored({ enableBankingTransactionId: 'a', transactionKey: 1 })] });
    expect(plan.changes).toEqual([{ reason: 'provider_status:PDNG', to: 'PENDING', transactionKey: 1 }]);
  });

  it.each(['RJCT', 'CNCL'])('expires a stored row the provider reports as %s, booked or pending', (providerStatus) => {
    const plan = planStatusRepair({
      coverageFrom,
      reported: [reported({ classification: 'voided', id: 'a', providerStatus }), reported({ classification: 'voided', id: 'b', providerStatus })],
      stored: [stored({ enableBankingTransactionId: 'a', transactionKey: 1 }), stored({ enableBankingTransactionId: 'b', status: 'PENDING', transactionKey: 2 })],
    });
    expect(plan.changes).toEqual([
      { reason: `provider_status:${providerStatus}`, to: 'EXPIRED', transactionKey: 1 },
      { reason: `provider_status:${providerStatus}`, to: 'EXPIRED', transactionKey: 2 },
    ]);
  });

  it('leaves rows the provider reports as booked, and rows already right, alone', () => {
    const plan = planStatusRepair({
      coverageFrom,
      reported: [reported({ id: 'a' }), reported({ classification: 'pending', id: 'b', providerStatus: 'PDNG' }), reported({ classification: 'voided', id: 'c', providerStatus: 'RJCT' })],
      stored: [stored({ enableBankingTransactionId: 'a', transactionKey: 1 }), stored({ enableBankingTransactionId: 'b', status: 'PENDING', transactionKey: 2 }), stored({ enableBankingTransactionId: 'c', status: 'EXPIRED', transactionKey: 3 })],
    });
    expect(plan).toEqual({ changes: [], review: [] });
  });

  describe('a booked row the provider no longer reports', () => {
    // The ex-pending ghost: stored as BOOKED from a PDNG row, then the booked version arrived under
    // a different id and was stored as a second row. Only the second is still reported.
    const ghost = stored({ createdAt: day('2026-03-05'), enableBankingTransactionId: 'pdng-id', transactionDate: day('2026-03-04'), transactionKey: 1 });
    const booked = stored({ createdAt: day('2026-03-07'), enableBankingTransactionId: 'book-id', transactionDate: day('2026-03-06'), transactionKey: 2 });

    it('expires it as a duplicate when exactly one later, still-reported booked row has its amount within five days', () => {
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' })], stored: [ghost, booked] });
      expect(plan.changes).toEqual([{ reason: 'duplicate_of:2', to: 'EXPIRED', transactionKey: 1 }]);
      expect(plan.review).toEqual([]);
    });

    it('only flags it for review when no booked counterpart matches', () => {
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' })], stored: [ghost, { ...booked, settlementAmount: -13 }] });
      expect(plan.changes).toEqual([]);
      expect(plan.review).toEqual([{ reason: 'not_reported_no_counterpart', transactionKey: 1 }]);
    });

    it('only flags it for review when the counterpart is ambiguous', () => {
      const twin = { ...booked, enableBankingTransactionId: 'book-id-2', transactionKey: 3 };
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' }), reported({ id: 'book-id-2' })], stored: [ghost, booked, twin] });
      expect(plan.changes).toEqual([]);
      expect(plan.review).toEqual([{ reason: 'not_reported_ambiguous_counterpart', transactionKey: 1 }]);
    });

    it('does not pair it with a booked row ingested before it, a different currency, or one more than five days away', () => {
      const plan = planStatusRepair({
        coverageFrom,
        reported: [reported({ id: 'older' }), reported({ id: 'usd' }), reported({ id: 'far' })],
        stored: [
          ghost,
          { ...booked, createdAt: day('2026-03-04'), enableBankingTransactionId: 'older', transactionKey: 2 },
          { ...booked, currencyCode: 'USD', enableBankingTransactionId: 'usd', transactionKey: 3 },
          { ...booked, enableBankingTransactionId: 'far', transactionDate: day('2026-03-10'), transactionKey: 4 },
        ],
      });
      expect(plan.changes).toEqual([]);
      expect(plan.review).toEqual([{ reason: 'not_reported_no_counterpart', transactionKey: 1 }]);
    });

    it('lets one booked row account for one ghost only', () => {
      const secondGhost = { ...ghost, enableBankingTransactionId: 'pdng-id-2', transactionKey: 5 };
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' })], stored: [ghost, secondGhost, booked] });
      expect(plan.changes).toEqual([]);
      expect(plan.review.map((row) => row.transactionKey).sort()).toEqual([1, 5]);
    });

    it('never changes a row the user edited; it goes to review instead', () => {
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' })], stored: [{ ...ghost, hasUserEdits: true }, booked] });
      expect(plan.changes).toEqual([]);
      expect(plan.review).toEqual([{ reason: 'not_reported_user_edited', transactionKey: 1 }]);
    });

    it('judges nothing dated on or before the first day the re-fetch covers', () => {
      const plan = planStatusRepair({ coverageFrom: day('2026-03-04'), reported: [reported({ id: 'book-id' })], stored: [ghost, booked] });
      expect(plan).toEqual({ changes: [], review: [] });
    });

    it('ignores rows that are not booked', () => {
      const plan = planStatusRepair({ coverageFrom, reported: [reported({ id: 'book-id' })], stored: [{ ...ghost, status: 'PENDING' }, { ...ghost, status: 'EXPIRED', transactionKey: 9 }, booked] });
      expect(plan).toEqual({ changes: [], review: [] });
    });
  });
});
