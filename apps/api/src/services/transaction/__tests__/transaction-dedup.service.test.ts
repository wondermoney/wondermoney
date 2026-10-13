/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked(em.findOne).mockResolvedValue() returns the mock itself; the rule can't see through the call. */
import { generateInternalTransactionId } from '@wondermoney/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Transaction } from '@entity/Transaction';

import { mockEm } from '../../../__tests__/__helpers__/mock-em';
import { findExistingTransaction, findExistingTransactionWithProvenance, findManualDuplicate, isPossibleManualDuplicate } from '../transaction-dedup.service';

describe('findExistingTransaction', () => {
  it('returns null without querying when no identity criteria are supplied', async () => {
    const em = mockEm();
    const result = await findExistingTransaction(em, { accountKey: 5 });
    expect(result).toBeNull();
    expect(em.findOne).not.toHaveBeenCalled();
  });

  it('excludes the synthetic fingerprint branch when a provider id is present (RAD-393)', async () => {
    const existing = { transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);

    const result = await findExistingTransaction(em, {
      accountKey: 5,
      externalTransactionId: 'ext-1',
      internalTransactionId: 'fp-1',
      nordigenInternalTransactionId: 'nord-1',
    });

    expect(result).toBe(existing);
    // The date+amount fingerprint is authoritative only for provider-id-less rows; external +
    // nordigen are present here, so `internalTransactionId` must NOT be in the $or — otherwise a
    // fingerprint collision would skip a distinct-bank-id transaction (the class-A data-loss case).
    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ externalTransactionId: 'ext-1' }, { nordigenInternalTransactionId: 'nord-1' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  it('uses the fingerprint branch only when no provider id is supplied (manual/CSV)', async () => {
    const existing = { transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);

    await findExistingTransaction(em, { accountKey: 5, internalTransactionId: 'fp-1' });

    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ internalTransactionId: 'fp-1' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  it('omits null/undefined ids from the $or', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);

    await findExistingTransaction(em, { accountKey: 5, externalTransactionId: null, internalTransactionId: 'fp-1', nordigenInternalTransactionId: undefined });

    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ internalTransactionId: 'fp-1' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  // Phase 1d: Enable Banking's replacement identity for `nordigenInternalTransactionId`.
  it('queries on enableBankingTransactionId and treats it as a provider id (excludes the fingerprint branch)', async () => {
    const existing = { transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);

    const result = await findExistingTransaction(em, { accountKey: 5, enableBankingTransactionId: 'eb-1', internalTransactionId: 'fp-1' });

    expect(result).toBe(existing);
    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ enableBankingTransactionId: 'eb-1' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  it('never mixes enableBankingTransactionId and nordigenInternalTransactionId terms with the same value by accident', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);

    await findExistingTransaction(em, { accountKey: 5, enableBankingTransactionId: 'shared-value', nordigenInternalTransactionId: undefined });

    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ enableBankingTransactionId: 'shared-value' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });
});

describe('findExistingTransactionWithProvenance', () => {
  it('returns null when nothing matches (single $or query, no extra lookups)', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, externalTransactionId: 'ext-1', internalTransactionId: 'fp-1', nordigenInternalTransactionId: 'nord-1' });
    expect(result).toBeNull();
    expect(em.findOne).toHaveBeenCalledTimes(1);
  });

  it('reports externalTransactionId when the matched row shares the external id', async () => {
    const existing = { externalTransactionId: 'ext-1', internalTransactionId: 'fp-1', nordigenInternalTransactionId: 'nord-1', transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, externalTransactionId: 'ext-1', internalTransactionId: 'fp-1', nordigenInternalTransactionId: 'nord-1' });
    expect(result).toEqual({ existing, matchedOn: 'externalTransactionId' });
    expect(em.findOne).toHaveBeenCalledTimes(1);
  });

  it('falls through to nordigenInternalTransactionId when the external id differs on the stored row', async () => {
    const existing = { externalTransactionId: 'other', nordigenInternalTransactionId: 'nord-1', transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, externalTransactionId: 'ext-1', nordigenInternalTransactionId: 'nord-1' });
    expect(result).toEqual({ existing, matchedOn: 'nordigenInternalTransactionId' });
  });

  it('does not let the fingerprint match a distinct-bank-id row — the RAD-393 fix (no false skip)', async () => {
    // A second real charge (external bank-B) that shares the date+amount fingerprint with an
    // existing row (bank-A). Because a provider id is present, the fingerprint branch is excluded
    // from the query, so it cannot match the bank-A row — the new charge is created, not skipped.
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, externalTransactionId: 'bank-B', internalTransactionId: 'fp-1', nordigenInternalTransactionId: 'nord-B' });
    expect(result).toBeNull();
    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ externalTransactionId: 'bank-B' }, { nordigenInternalTransactionId: 'nord-B' }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  it('still reports internalTransactionId provenance for a provider-id-less (manual) fingerprint match', async () => {
    const existing = { internalTransactionId: 'fp-1', transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, internalTransactionId: 'fp-1' });
    expect(result).toEqual({ existing, matchedOn: 'internalTransactionId' });
  });

  it('reports enableBankingTransactionId provenance for an Enable Banking match', async () => {
    const existing = { enableBankingTransactionId: 'eb-1', transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);
    const result = await findExistingTransactionWithProvenance(em, { accountKey: 5, enableBankingTransactionId: 'eb-1', internalTransactionId: 'fp-1' });
    expect(result).toEqual({ existing, matchedOn: 'enableBankingTransactionId' });
  });
});

describe('findManualDuplicate', () => {
  const FLAG = 'TRANSACTION_DEDUP_ENABLED';
  const date = new Date('2026-07-30T00:00:00.000Z');

  beforeEach(() => { vi.stubEnv(FLAG, 'true'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns null without querying when the dedup flag is disabled', async () => {
    vi.stubEnv(FLAG, 'false');
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue({ transactionKey: 1 } as Transaction);
    expect(await findManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date })).toBeNull();
    expect(em.findOne).not.toHaveBeenCalled();
  });

  it('reports the internalTransactionId fingerprint branch when a manual entry collides', async () => {
    const existing = { internalTransactionId: generateInternalTransactionId(date, 10), transactionKey: 99 } as Transaction;
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(existing);
    const result = await findManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date });
    expect(result).toEqual({ existing, matchedOn: 'internalTransactionId' });
    expect(em.findOne).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing matches', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);
    expect(await findManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date })).toBeNull();
  });
});

describe('isPossibleManualDuplicate', () => {
  const FLAG = 'TRANSACTION_DEDUP_ENABLED';
  const date = new Date('2026-07-30T00:00:00.000Z');

  beforeEach(() => { vi.stubEnv(FLAG, 'true'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns false without querying when the dedup flag is disabled', async () => {
    vi.stubEnv(FLAG, 'false');
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue({ transactionKey: 1 } as Transaction);
    expect(await isPossibleManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date })).toBe(false);
    expect(em.findOne).not.toHaveBeenCalled();
  });

  it('returns true when an existing transaction shares the date+amount fingerprint', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue({ transactionKey: 1 } as Transaction);
    const result = await isPossibleManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date });
    expect(result).toBe(true);
    expect(em.findOne).toHaveBeenCalledWith(Transaction, {
      $or: [{ internalTransactionId: generateInternalTransactionId(date, 10) }],
      accountKey: 5,
      deletedAt: undefined,
    });
  });

  it('returns false when no existing transaction matches', async () => {
    const em = mockEm();
    vi.mocked(em.findOne).mockResolvedValue(null);
    expect(await isPossibleManualDuplicate(em, { accountKey: 5, amount: 10, transactionDate: date })).toBe(false);
  });
});
/* eslint-enable @typescript-eslint/unbound-method */
