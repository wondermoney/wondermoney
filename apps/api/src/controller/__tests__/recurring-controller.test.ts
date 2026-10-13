import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Category } from '@entity/Category';

const mocked = vi.hoisted(() => ({
  detectRecurringCandidatesForTenant: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((schema: { parseAsync: (req: unknown) => Promise<unknown> }, req: unknown) => schema.parseAsync(req)),
}));

vi.mock('../../app.js', () => ({
  DI: {
    em: {
      find: mocked.find,
      findOne: mocked.findOne,
      flush: mocked.flush,
      getRepository: vi.fn(),
    },
  },
}));

vi.mock('@entity/RecurringSeries', () => ({
  RecurringSeries: {},
}));

vi.mock('@entity/Category', () => ({
  Category: {},
}));

vi.mock('@entity/AppuserTenant', () => ({
  AppuserTenant: {},
}));

vi.mock('@service/recurring/recurring-detection.service', () => ({
  detectRecurringCandidatesForTenant: mocked.detectRecurringCandidatesForTenant,
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { confirmRecurringSeries, detectRecurring, dismissRecurringSeries, getRecurringItems, getRecurringSummary, updateRecurringSeries } from '../recurring';

type RecurringRequest = Parameters<typeof getRecurringSummary>[0];

function response() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const sendStatus = vi.fn();
  return { json, sendStatus, status };
}

describe('recurring controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes confirmed and high-confidence candidates in summary totals', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, expectedAmount: 10, status: 'confirmed' },
      { amountType: 'variable', cadence: 'monthly', confidenceScore: 95, expectedAmountMax: 15, expectedAmountMin: 5, status: 'candidate' },
    ]);

    const res = response();

    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(mocked.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: null, tenantKey: 1 }),
      expect.objectContaining({ populate: ['currencyKey'] }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currencyTotals: { unknown: expect.objectContaining({ count: 2, monthlyTotal: 25 }) },
        detectedIncludedCount: 2,
        fixedTotal: 10,
        monthlyTotal: 25,
        variableMaxTotal: 15,
        variableMinTotal: 5,
      }),
    );
  });

  it('normalizes cadence totals to monthly equivalents', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'weekly', confidenceScore: 100, expectedAmount: 12, status: 'confirmed' },
      { amountType: 'fixed', cadence: 'yearly', confidenceScore: 100, expectedAmount: 120, status: 'confirmed' },
    ]);

    const res = response();
    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fixedTotal: 62, monthlyTotal: 62 }));
  });

  it('excludes medium-confidence candidates from totals and counts as needs review', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 80, expectedAmount: 20, status: 'candidate' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 91, expectedAmount: 30, status: 'candidate' },
    ]);

    const res = response();

    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedIncludedCount: 1,
        monthlyTotal: 30,
        needsReviewCount: 1,
      }),
    );
  });

  it('excludes high-confidence dismissed paused and ended series from summary totals', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 99, expectedAmount: 50, status: 'dismissed' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 99, expectedAmount: 60, status: 'paused' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 99, expectedAmount: 70, status: 'ended' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 99, expectedAmount: 80, status: 'candidate' },
    ]);

    const res = response();

    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedIncludedCount: 1,
        fixedTotal: 80,
        monthlyTotal: 80,
      }),
    );
  });

  it('groups summary totals by currency', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, currencyKey: { code: 'EUR', currencyKey: 1 }, expectedAmount: 10, status: 'confirmed' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, currencyKey: { code: 'USD', currencyKey: 2 }, expectedAmount: 20, status: 'confirmed' },
    ]);

    const res = response();
    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currencyTotals: {
          EUR: expect.objectContaining({ monthlyTotal: 10 }),
          USD: expect.objectContaining({ monthlyTotal: 20 }),
        },
      }),
    );
    expect(mocked.find).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ deletedAt: null, tenantKey: 1 }), expect.objectContaining({ populate: ['currencyKey'] }));
  });

  it('reports honest subscription bill and monthly ranges', async () => {
    mocked.find.mockResolvedValueOnce([
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, expectedAmount: 10.99, status: 'confirmed', type: 'subscription' },
      { amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, expectedAmount: 1200, status: 'confirmed', type: 'bill' },
      { amountType: 'variable', cadence: 'monthly', confidenceScore: 100, expectedAmountMax: 60, expectedAmountMin: 40, status: 'confirmed', type: 'bill' },
    ]);

    const res = response();
    await getRecurringSummary(Object.assign(mockReq(), { tenant: { tenantKey: 1 } }), mockRes({ json: res.json, status: res.status }));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      billMaxTotal: 1260,
      billMinTotal: 1240,
      monthlyMaxTotal: 1270.99,
      monthlyMinTotal: 1250.99,
      subscriptionMaxTotal: 10.99,
      subscriptionMinTotal: 10.99,
    }));
  });

  it('reports the last completed detection run rather than a series edit time', async () => {
    const lastRunAt = new Date('2026-07-15T09:00:00.000Z');
    mocked.find.mockResolvedValueOnce([
      {
        amountType: 'fixed',
        cadence: 'monthly',
        confidenceScore: 100,
        expectedAmount: 10,
        status: 'confirmed',
        updatedAt: new Date('2026-07-15T10:00:00.000Z'),
      },
    ]);
    mocked.findOne.mockResolvedValueOnce({
      recurringDetectionLastRunAt: lastRunAt,
    });

    const res = response();
    await getRecurringSummary(
      Object.assign(mockReq(), { tenant: { tenantKey: 1 } }),
      mockRes({ json: res.json, status: res.status }),
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ lastDetectedAt: lastRunAt }),
    );
  });

  it('resolves tenant from appuserTenant when req.tenant is missing', async () => {
    mocked.findOne.mockResolvedValueOnce({ tenantKey: { tenantKey: 1 } });
    mocked.find.mockResolvedValueOnce([{ amountType: 'fixed', cadence: 'monthly', confidenceScore: 100, expectedAmount: 10, status: 'confirmed' }]);

    const res = response();

    await getRecurringSummary({ appuser: { appuserKey: 11 } } as unknown as RecurringRequest, mockRes({ json: res.json, status: res.status }));

    expect(mocked.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: null, tenantKey: 1 }),
      expect.objectContaining({ populate: ['currencyKey'] }),
    );
  });

  it('detects recurring candidates using resolved tenant key', async () => {
    mocked.findOne.mockResolvedValueOnce({ tenantKey: { tenantKey: 1 } });
    mocked.detectRecurringCandidatesForTenant.mockResolvedValueOnce({ created: 2, skipped: 3, updated: 1 });

    const res = response();

    await detectRecurring({ appuser: { appuserKey: 11 } } as unknown as RecurringRequest, mockRes({ json: res.json }));

    expect(mocked.detectRecurringCandidatesForTenant).toHaveBeenCalledWith(1);
    expect(res.json).toHaveBeenCalledWith({ created: 2, skipped: 3, updated: 1 });
  });

  it('maps fromDate and toDate to nextExpectedAt bounds', async () => {
    mocked.find.mockResolvedValueOnce([]);

    const res = response();

    await getRecurringItems(
      Object.assign(mockReq({ query: { fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-01-31T23:59:59.999Z' } }), { tenant: { tenantKey: 1 } }),
      mockRes({ json: res.json }),
    );

    const lastCall = mocked.find.mock.calls.at(-1) as [unknown, Record<string, unknown>, unknown];
    expect(lastCall[1]).toEqual(
      expect.objectContaining({
        nextExpectedAt: {
          $gte: new Date('2026-01-01T00:00:00.000Z'),
          $lte: new Date('2026-01-31T23:59:59.999Z'),
        },
      }),
    );
    const where = lastCall[1];
    expect(where).not.toHaveProperty('fromDate');
    expect(where).not.toHaveProperty('toDate');
  });

  it('confirms a recurring series and flushes', async () => {
    const series = { recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne.mockResolvedValueOnce(series);

    const res = response();

    await confirmRecurringSeries(Object.assign(mockReq({ params: { recurringSeriesId: '7' } }), { tenant: { tenantKey: 1 } }), mockRes({ sendStatus: res.sendStatus, status: res.status }));

    expect(series.status).toBe('confirmed');
    expect(mocked.findOne).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: null, recurringSeriesKey: 7, tenantKey: 1 }),
    );
    expect(mocked.flush).toHaveBeenCalled();
  });

  it('dismisses a recurring series and flushes', async () => {
    const series = { recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne.mockResolvedValueOnce(series);

    await dismissRecurringSeries(Object.assign(mockReq({ params: { recurringSeriesId: '7' } }), { tenant: { tenantKey: 1 } }), mockRes());

    expect(series.status).toBe('dismissed');
    expect(mocked.findOne).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: null, recurringSeriesKey: 7, tenantKey: 1 }),
    );
    expect(mocked.flush).toHaveBeenCalled();
  });

  it('looks up recurring series by key tenant and deletedAt null when updating', async () => {
    const series = { recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne.mockResolvedValueOnce(series);

    await updateRecurringSeries(
      Object.assign(mockReq({ body: { displayName: 'Netflix', status: 'confirmed' } }), { params: { recurringSeriesId: 7 }, tenant: { tenantKey: 1 } }),
      mockRes(),
    );

    expect(mocked.findOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ deletedAt: null, recurringSeriesKey: 7, tenantKey: 1 }));
  });

  it('loads a same-tenant category with an explicit active household/global predicate', async () => {
    const series = { categoryKey: undefined, recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne.mockResolvedValueOnce(series).mockResolvedValueOnce({ bgColor: '#111', categoryKey: 3, deletedAt: null, icon: 'tv', isSystemCategory: false, name: 'Netflix', tenantKey: 1, textColor: '#fff' });

    await updateRecurringSeries({ appuser: { appuserKey: 11 }, body: { categoryKey: 3 }, params: { recurringSeriesId: 7 }, tenant: { tenantKey: 1 } } as unknown as RecurringRequest, mockRes());

    expect(mocked.findOne).toHaveBeenNthCalledWith(
      2,
      Category,
      {
        $or: [
          { isSystemCategory: false, tenantKey: { tenantKey: 1 } },
          { isSystemCategory: true, tenantKey: null },
        ],
        categoryKey: 3,
        deletedAt: undefined,
      },
    );
    expect(series.categoryKey).toMatchObject({ categoryKey: 3 });
    expect(mocked.flush).toHaveBeenCalled();
  });

  it('allows a global system category parent when resolving tenant through the existing resolver', async () => {
    const series = { categoryKey: undefined, recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne
      .mockResolvedValueOnce({ tenantKey: { tenantKey: 1 } })
      .mockResolvedValueOnce(series)
      .mockResolvedValueOnce({ tenantKey: { tenantKey: 1 } })
      .mockResolvedValueOnce({ bgColor: '#111', categoryKey: 3, deletedAt: null, icon: 'tv', isSystemCategory: true, name: 'Netflix', tenantKey: null, textColor: '#fff' });

    await updateRecurringSeries(Object.assign(mockReq({ body: { categoryKey: 3 } }), { params: { recurringSeriesId: 7 }, user: { appuserKey: 11 } }), mockRes());

    expect(mocked.findOne).toHaveBeenNthCalledWith(
      4,
      Category,
      {
        $or: [
          { isSystemCategory: false, tenantKey: { tenantKey: 1 } },
          { isSystemCategory: true, tenantKey: null },
        ],
        categoryKey: 3,
        deletedAt: undefined,
      },
    );
    expect(series.categoryKey).toMatchObject({ categoryKey: 3, isSystemCategory: true });
    expect(mocked.flush).toHaveBeenCalled();
  });

  it.each(['foreign-tenant', 'deleted'])('rejects a %s category without mutation or flush', async (_kind) => {
    const previousCategory = { categoryKey: 99 };
    const series = { categoryKey: previousCategory, recurringSeriesKey: 7, status: 'candidate' };
    mocked.findOne.mockResolvedValueOnce(series).mockResolvedValueOnce(null);

    await expect(
      updateRecurringSeries({ appuser: { appuserKey: 11 }, body: { categoryKey: 3 }, params: { recurringSeriesId: 7 }, tenant: { tenantKey: 1 } } as unknown as RecurringRequest, mockRes()),
    ).rejects.toThrow('Category not found');
    expect(series.categoryKey).toBe(previousCategory);
    expect(mocked.findOne).toHaveBeenNthCalledWith(
      2,
      Category,
      {
        $or: [
          { isSystemCategory: false, tenantKey: { tenantKey: 1 } },
          { isSystemCategory: true, tenantKey: null },
        ],
        categoryKey: 3,
        deletedAt: undefined,
      },
    );
    expect(mocked.flush).not.toHaveBeenCalled();
  });
});
