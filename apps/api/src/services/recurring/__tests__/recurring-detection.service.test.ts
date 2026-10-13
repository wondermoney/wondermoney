import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  persist: vi.fn().mockReturnThis(),
  transactional: vi.fn(),
}));

const ref = (entity: string, key: number) => ({ entity, key });

vi.mock('@app/app', () => ({ DI: { em: { create: mocks.create, find: mocks.find, findOne: mocks.findOne, flush: mocks.flush, getConnection: vi.fn(() => ({ execute: mocks.execute })), getReference: vi.fn((entity: unknown, input: unknown) => {
  const key = typeof input === 'object' && input
    ? (input as Record<string, number>)['tenantKey'] ?? (input as Record<string, number>)['accountKey'] ?? (input as Record<string, number>)['currencyKey']
    : input;
  return ref(String(entity), Number(key));
}), persist: mocks.persist, transactional: mocks.transactional } } }));
vi.mock('@entity/RecurringOccurrence', () => ({ RecurringOccurrence: {} }));
vi.mock('@entity/RecurringSeries', () => ({ RecurringSeries: {} }));
vi.mock('@entity/Tenant', () => ({ Tenant: {} }));
vi.mock('@entity/Transaction', () => ({ Transaction: {} }));

import { buildRecurringCandidatesFromTransactions, detectRecurringCandidatesForTenant } from '../recurring-detection.service';
import { RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '../recurring-types';

describe('recurring detection service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation((_: unknown, data: unknown) => ({ ...(data as object) }));
    mocks.find.mockResolvedValue([]);
    mocks.findOne.mockResolvedValue(null);
    mocks.transactional.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => cb({ create: mocks.create, find: mocks.find, findOne: mocks.findOne, flush: mocks.flush, getConnection: vi.fn(() => ({ execute: mocks.execute })), getReference: vi.fn((entity: unknown, input: unknown) => {
      const key = typeof input === 'object' && input ? (input as Record<string, number>)['tenantKey'] ?? (input as Record<string, number>)['accountKey'] ?? (input as Record<string, number>)['currencyKey'] : input;
      return ref(String(entity), Number(key));
    }), persist: mocks.persist }) );
  });

  const tx = (overrides: Record<string, unknown>) => ({
    description: 'Spotify',
    settlementAmount: -10.99,
    transactionDate: new Date('2026-01-05'),
    transactionKey: 1,
    ...overrides,
  });

  it('builds a fixed candidate with full shape', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ transactionDate: new Date('2026-04-05'), transactionKey: 4 }),
    ], { referenceDate: new Date('2026-04-20') });

    expect(candidates[0]).toMatchObject({ amountType: RecurringAmountType.fixed, averageAmount: 10.99, cadence: RecurringCadence.monthly, expectedAmount: 10.99, lastAmount: 10.99, nextExpectedAt: new Date('2026-05-05'), occurrenceCount: 4, status: RecurringSeriesStatus.candidate, transactionKeys: [1, 2, 3, 4], type: RecurringSeriesType.subscription });
  });

  it('builds a variable bill candidate', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ description: 'EDP', settlementAmount: -10, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ description: 'EDP', settlementAmount: -20, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ description: 'EDP', settlementAmount: -30, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);

    expect(candidates[0]).toMatchObject({ amountType: RecurringAmountType.variable, expectedAmountMax: 30, expectedAmountMin: 10, type: RecurringSeriesType.bill });
  });

  it('classifies fixed rent and groceries as bills instead of subscriptions', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ description: 'Monthly Rent', settlementAmount: -1200, transactionDate: new Date('2026-01-01'), transactionKey: 1 }),
      tx({ description: 'Monthly Rent', settlementAmount: -1200, transactionDate: new Date('2026-02-01'), transactionKey: 2 }),
      tx({ description: 'Monthly Rent', settlementAmount: -1200, transactionDate: new Date('2026-03-01'), transactionKey: 3 }),
      tx({ description: 'Pingo Doce', settlementAmount: -27.36, transactionDate: new Date('2026-01-02'), transactionKey: 4 }),
      tx({ description: 'Pingo Doce', settlementAmount: -27.36, transactionDate: new Date('2026-01-09'), transactionKey: 5 }),
      tx({ description: 'Pingo Doce', settlementAmount: -27.36, transactionDate: new Date('2026-01-16'), transactionKey: 6 }),
    ], { referenceDate: new Date('2026-03-02') });

    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Monthly Rent', type: RecurringSeriesType.bill }),
      expect.objectContaining({ displayName: 'Pingo Doce', type: RecurringSeriesType.bill }),
    ]));
  });

  it('rolls an expected date forward until it is current', () => {
    const [candidate] = buildRecurringCandidatesFromTransactions([
      tx({ description: 'Spotify', transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ description: 'Spotify', transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ description: 'Spotify', transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ], { referenceDate: new Date('2026-07-15') });

    expect(candidate?.nextExpectedAt).toEqual(new Date('2026-08-05'));
  });

  it('uses appuser amount with appuser currency when present', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 },
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 },
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 },
    ]);

    expect(candidates[0]).toMatchObject({ currencyKey: 3, lastAmount: 9.99, normalizedMerchantKey: 'spotify' });
  });

  it('skips invalid groups', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ description: '', transactionKey: 1 }),
      tx({ description: '', transactionDate: null, transactionKey: 2 }),
      tx({ description: '', settlementAmount: 10.99, transactionKey: 3 }),
    ]);

    expect(candidates).toHaveLength(0);
  });

  it('prefers appuser settlement amount over settlement amount', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-01-05'), transactionKey: 1 },
      { appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-02-05'), transactionKey: 2 },
      { appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-03-05'), transactionKey: 3 },
    ]);

    expect(candidates[0]?.lastAmount).toBe(9.99);
  });

  it('is deterministic by recency ordering', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
    ]);

    expect(candidates[0]?.transactionKeys).toEqual([1, 2, 3]);
  });

  it('groups by account and currency identity', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 4 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-02-05'), transactionKey: 5 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-03-05'), transactionKey: 6 }),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.transactionKeys)).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('groups appuser amount transactions together despite different settlement currencies', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -10.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 },
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -11.99, settlementCurrencyKey: { currencyKey: 4 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 },
      { appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, description: 'Spotify', settlementAmount: -12.99, settlementCurrencyKey: { currencyKey: 5 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ currencyKey: 3, transactionKeys: [1, 2, 3] });
  });

  it('predicts month end dates', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ transactionDate: new Date('2026-01-31'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-28'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-31'), transactionKey: 3 }),
    ], { referenceDate: new Date('2026-04-01') });

    expect(candidates[0]?.nextExpectedAt).toEqual(new Date('2026-04-30'));
  });

  it('scores cadence confidence', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);

    expect(candidates[0]?.cadenceConfidence).toBeGreaterThan(0);
  });

  it('keeps latest fixed amount behavior', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      tx({ settlementAmount: -10.1, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ settlementAmount: -10.2, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ settlementAmount: -10.3, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ settlementAmount: -10.4, transactionDate: new Date('2026-04-05'), transactionKey: 4 }),
    ]);

    expect(candidates[0]?.expectedAmount).toBe(10.4);
  });

  it('creates new series and occurrences from detected candidate', async () => {
    mocks.find.mockResolvedValueOnce([
      tx({ tenantKey: { tenantKey: 1 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ tenantKey: { tenantKey: 1 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ tenantKey: { tenantKey: 1 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ tenantKey: { tenantKey: 1 }, transactionDate: new Date('2026-04-05'), transactionKey: 4 }),
    ]);

    const result = await detectRecurringCandidatesForTenant(1, { referenceDate: new Date('2026-04-20') });

    expect(mocks.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deletedAt: null, tenantKey: expect.objectContaining({ key: 1 }) }), expect.objectContaining({ populate: ['transactionMerchantKey', 'accountKey', 'settlementCurrencyKey', 'appuserCurrencyKey'] }));
    expect(mocks.create).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ tenantKey: expect.objectContaining({ key: 1 }) }), { partial: true });
    expect(mocks.create).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ amount: 10.99, matchStatus: RecurringOccurrenceMatchStatus.matched, occurrenceDate: new Date('2026-01-05') }));
    expect(result).toEqual({ created: 1, skipped: 0, updated: 0 });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith('select pg_advisory_xact_lock(?)', [1]);
  });

  it('updates existing non-dismissed candidate without creating duplicate', async () => {
    const existing = { recurringSeriesKey: 9, status: RecurringSeriesStatus.candidate };
    mocks.find.mockResolvedValueOnce([
      tx({ accountKey: { accountKey: 7 }, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 1, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ accountKey: { accountKey: 7 }, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-02-05'), transactionKey: 2, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ accountKey: { accountKey: 7 }, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-03-05'), transactionKey: 3, transactionMerchantKey: { name: 'Merchant' } }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    const result = await detectRecurringCandidatesForTenant(1);

    expect(result).toEqual({ created: 0, skipped: 0, updated: 1 });
    expect(existing.status).toBe(RecurringSeriesStatus.candidate);
  });

  it('preserves paused status on existing series', async () => {
    const existing = { recurringSeriesKey: 9, status: RecurringSeriesStatus.paused };
    mocks.find.mockResolvedValueOnce([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    await detectRecurringCandidatesForTenant(1);

    expect(existing.status).toBe(RecurringSeriesStatus.paused);
  });

  it('keeps confirmed status when updating existing confirmed series', async () => {
    const existing = { recurringSeriesKey: 9, status: RecurringSeriesStatus.confirmed };
    mocks.find.mockResolvedValueOnce([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    await detectRecurringCandidatesForTenant(1);

    expect(existing.status).toBe(RecurringSeriesStatus.confirmed);
  });

  it('advances confirmed predictions across a due date while preserving overrides', async () => {
    const existing = {
      cadence: RecurringCadence.monthly,
      displayName: 'My custom name',
      expectedAmount: 42,
      nextExpectedAt: new Date('2026-04-05'),
      recurringSeriesKey: 9,
      status: RecurringSeriesStatus.confirmed,
    };
    mocks.find.mockResolvedValueOnce([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    await detectRecurringCandidatesForTenant(1, {
      referenceDate: new Date('2026-07-15'),
    });

    expect(existing.nextExpectedAt).toEqual(new Date('2026-08-05'));
    expect(existing.displayName).toBe('My custom name');
    expect(existing.expectedAmount).toBe(42);
  });

  it('preserves confirmed custom fields on update', async () => {
    const existing = { displayName: 'Custom', expectedAmount: 42, recurringSeriesKey: 9, status: RecurringSeriesStatus.confirmed, type: RecurringSeriesType.bill };
    mocks.find.mockResolvedValueOnce([
      tx({ description: '', transactionDate: new Date('2026-01-05'), transactionKey: 1, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ description: '', transactionDate: new Date('2026-02-05'), transactionKey: 2, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ description: '', transactionDate: new Date('2026-03-05'), transactionKey: 3, transactionMerchantKey: { name: 'Merchant' } }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    await detectRecurringCandidatesForTenant(1);

    expect(existing.displayName).toBe('Custom');
    expect(existing.expectedAmount).toBe(42);
    expect(existing.type).toBe(RecurringSeriesType.bill);
  });

  it('preserves user_created custom fields on update', async () => {
    const existing = { displayName: 'Manual', expectedAmount: 55, recurringSeriesKey: 9, source: RecurringSeriesSource.user_created, status: RecurringSeriesStatus.candidate, type: RecurringSeriesType.bill };
    mocks.find.mockResolvedValueOnce([
      tx({ description: '', transactionDate: new Date('2026-01-05'), transactionKey: 1, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ description: '', transactionDate: new Date('2026-02-05'), transactionKey: 2, transactionMerchantKey: { name: 'Merchant' } }),
      tx({ description: '', transactionDate: new Date('2026-03-05'), transactionKey: 3, transactionMerchantKey: { name: 'Merchant' } }),
    ]);
    mocks.findOne.mockResolvedValue(existing);

    await detectRecurringCandidatesForTenant(1);

    expect(existing.displayName).toBe('Manual');
    expect(existing.expectedAmount).toBe(55);
    expect(existing.type).toBe(RecurringSeriesType.bill);
  });

  it('skips dismissed matching series', async () => {
    mocks.find.mockResolvedValueOnce([
      tx({ description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValue({ recurringSeriesKey: 9, status: RecurringSeriesStatus.dismissed });

    const result = await detectRecurringCandidatesForTenant(1);

    expect(result).toEqual({ created: 0, skipped: 1, updated: 0 });
  });

  it('records an honest scan timestamp even when no series are found', async () => {
    const referenceDate = new Date('2026-07-15T10:30:00.000Z');

    const result = await detectRecurringCandidatesForTenant(1, {
      referenceDate,
    });

    expect(result).toEqual({ created: 0, skipped: 0, updated: 0 });
    expect(mocks.execute).toHaveBeenCalledWith(
      'update "tenant" set "recurring_detection_last_run_at" = ? where "tenant_key" = ?',
      [referenceDate, 1],
    );
  });

  it('persists occurrences with per-transaction date and amount and avoids duplicates', async () => {
    mocks.find.mockResolvedValueOnce([
      { description: 'Spotify', settlementAmount: -10.1, transactionDate: new Date('2026-01-05'), transactionKey: 1 },
      { description: 'Spotify', settlementAmount: -10.2, transactionDate: new Date('2026-02-05'), transactionKey: 2 },
      { description: 'Spotify', settlementAmount: -10.3, transactionDate: new Date('2026-03-05'), transactionKey: 3 },
    ]);
    mocks.findOne.mockResolvedValueOnce(null);

    await detectRecurringCandidatesForTenant(1);

    expect(mocks.create).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ amount: 10.1, occurrenceDate: new Date('2026-01-05') }));
    expect(mocks.create).toHaveBeenNthCalledWith(3, {}, expect.objectContaining({ amount: 10.2, occurrenceDate: new Date('2026-02-05') }));
    const createdOccurrenceDates = mocks.create.mock.calls
      .map(([, data]) => data as Record<string, unknown>)
      .filter((data) => data['occurrenceDate'] instanceof Date)
      .map((data) => (data['occurrenceDate'] as Date).getTime());
    expect(createdOccurrenceDates).toContain(new Date('2026-01-05').getTime());
    expect(createdOccurrenceDates).toContain(new Date('2026-02-05').getTime());
    expect(createdOccurrenceDates).toContain(new Date('2026-03-05').getTime());
    expect(mocks.persist).toHaveBeenCalled();
  });

  it('is idempotent across repeated runs', async () => {
    mocks.find.mockResolvedValue([
      tx({ transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ recurringSeriesKey: 9, status: RecurringSeriesStatus.candidate });

    const first = await detectRecurringCandidatesForTenant(1);
    const second = await detectRecurringCandidatesForTenant(1);

    expect(first).toEqual({ created: 1, skipped: 0, updated: 0 });
    expect(second).toEqual({ created: 0, skipped: 0, updated: 1 });
  });

  it('keeps separate series for same merchant across account and currency identity', async () => {
    mocks.find.mockResolvedValueOnce([
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 1 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 4 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-02-05'), transactionKey: 5 }),
      tx({ accountKey: 1, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-03-05'), transactionKey: 6 }),
    ]);
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await detectRecurringCandidatesForTenant(1);

    expect(result).toEqual({ created: 2, skipped: 0, updated: 0 });
    const seriesLookups = mocks.findOne.mock.calls.filter(([, query]) => query && 'normalizedMerchantKey' in (query as object));
    expect(seriesLookups[0]?.[1]).toEqual(expect.objectContaining({ accountKey: expect.objectContaining({ key: 1 }), currencyKey: expect.objectContaining({ key: 1 }), normalizedMerchantKey: 'spotify', tenantKey: expect.objectContaining({ key: 1 }) }));
    expect(seriesLookups[1]?.[1]).toEqual(expect.objectContaining({ accountKey: expect.objectContaining({ key: 1 }), currencyKey: expect.objectContaining({ key: 2 }), normalizedMerchantKey: 'spotify', tenantKey: expect.objectContaining({ key: 1 }) }));
  });

  it('uses appuser currency for lookup and persistence when appuser amount is present', async () => {
    mocks.find.mockResolvedValueOnce([
      tx({ appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ appuserCurrencyKey: { currencyKey: 3 }, appuserSettlementAmount: -9.99, settlementCurrencyKey: { currencyKey: 2 }, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await detectRecurringCandidatesForTenant(1);
    await detectRecurringCandidatesForTenant(1);

    const seriesLookups = mocks.findOne.mock.calls.filter(([, query]) => query && 'normalizedMerchantKey' in (query as object));
    expect(seriesLookups[0]?.[1]).toEqual(expect.objectContaining({ currencyKey: expect.objectContaining({ key: 3 }), normalizedMerchantKey: 'spotify', tenantKey: expect.objectContaining({ key: 1 }) }));
    expect(mocks.create).toHaveBeenCalledWith({}, expect.objectContaining({ currencyKey: expect.objectContaining({ key: 3 }) }));
  });

  it('does not create zero-valued account refs when account is absent', async () => {
    mocks.find.mockResolvedValueOnce([
      tx({ accountKey: null, settlementCurrencyKey: null, transactionDate: new Date('2026-01-05'), transactionKey: 1 }),
      tx({ accountKey: null, settlementCurrencyKey: null, transactionDate: new Date('2026-02-05'), transactionKey: 2 }),
      tx({ accountKey: null, settlementCurrencyKey: null, transactionDate: new Date('2026-03-05'), transactionKey: 3 }),
    ]);
    mocks.findOne.mockResolvedValueOnce(null);

    await detectRecurringCandidatesForTenant(1);

    expect(mocks.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountKey: null, currencyKey: null, tenantKey: expect.objectContaining({ key: 1 }) }));
    expect(mocks.create).not.toHaveBeenCalledWith({}, expect.objectContaining({ accountKey: expect.objectContaining({ key: 0 }) }));
    expect(mocks.create).not.toHaveBeenCalledWith({}, expect.objectContaining({ currencyKey: expect.objectContaining({ key: 0 }) }));
  });

  it('builds candidate from transaction merchant name when description is absent', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { settlementAmount: -10.99, transactionDate: new Date('2026-01-05'), transactionKey: 1, transactionMerchantKey: { name: 'Spotify' } },
      { settlementAmount: -10.99, transactionDate: new Date('2026-02-05'), transactionKey: 2, transactionMerchantKey: { name: 'Spotify' } },
      { settlementAmount: -10.99, transactionDate: new Date('2026-03-05'), transactionKey: 3, transactionMerchantKey: { name: 'Spotify' } },
    ]);

    expect(candidates[0]?.normalizedMerchantKey).toBe('spotify');
    expect(candidates[0]?.accountKey).toBeUndefined();
  });

  it('prefers merchant name over blank description for display name', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { description: '   ', settlementAmount: -10.99, transactionDate: new Date('2026-01-05'), transactionKey: 1, transactionMerchantKey: { name: 'Merchant Name' } },
      { description: '   ', settlementAmount: -10.99, transactionDate: new Date('2026-02-05'), transactionKey: 2, transactionMerchantKey: { name: 'Merchant Name' } },
      { description: '   ', settlementAmount: -10.99, transactionDate: new Date('2026-03-05'), transactionKey: 3, transactionMerchantKey: { name: 'Merchant Name' } },
    ]);

    expect(candidates[0]?.displayName).toBe('Merchant Name');
  });

  it('keeps existing recurring candidate shape tests', () => {
    const candidates = buildRecurringCandidatesFromTransactions([
      { description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-01-05'), transactionKey: 1 },
      { description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-02-05'), transactionKey: 2 },
      { description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-03-05'), transactionKey: 3 },
      { description: 'Spotify', settlementAmount: -10.99, transactionDate: new Date('2026-04-05'), transactionKey: 4 },
    ], { referenceDate: new Date('2026-04-20') });

    expect(candidates[0]).toMatchObject({ amountType: RecurringAmountType.fixed, cadence: RecurringCadence.monthly, status: RecurringSeriesStatus.candidate, type: RecurringSeriesType.subscription });
  });
});
