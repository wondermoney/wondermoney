import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));

import { buildBudgetVsActualCsv, getBudgetVsActualReport } from '../budgetVsActual.service';
import { REPORT_DEFAULT_TIME_ZONE } from '../report-months';

describe('buildBudgetVsActualCsv', () => {
  it('emits the contract column order with 2-decimal amounts', () => {
    const csv = buildBudgetVsActualCsv([
      { actual: 300, budgeted: 300, categoryKey: '10', color: '#f3f3f3', name: 'Food', percentUsed: 100, variance: 0 },
    ]);

    expect(csv).toBe('﻿categoryKey,name,color,budgeted,actual,variance,percentUsed\n10,Food,#f3f3f3,300.00,300.00,0.00,100.00\n');
  });
});

/**
 * RAD-565 — the covered-month set is built from `fromDate`/`toDate`, which are
 * *instants*, and joined against `BudgetTemplateCategory.year`/`.month`, which
 * are plain integers. Two ways that went wrong: the set was computed in UTC (so
 * a UTC+1 caller picked up the month before their selection), and the key was
 * unpadded (so it had to stay unpadded on both sides to match at all).
 */
describe('getBudgetVsActualReport covered months', () => {
  const CATEGORY = { bgColor: '#f3f3f3', categoryKey: 10, name: 'Food' };

  const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
    ({
      filters: { includePending: false, includeTransfers: false, timezone: REPORT_DEFAULT_TIME_ZONE, ...overrides } as ReportFilters,
      tenant: { tenantKey: 113 },
      user: { appuserKey: 71 },
    }) as unknown as ReportServiceInput;

  /** One budget, one template per `[year, month]`, and no transactions. */
  const givenTemplatesFor = (...months: [number, number][]) => {
    const templates = months.map(([year, month]) => ({
      accounts: { getItems: () => [] },
      amountBudgeted: 100,
      categoryKey: CATEGORY,
      month,
      year,
    }));
    mocks.find
      .mockResolvedValueOnce([{ budgetKey: 1 }]) // budgets
      .mockResolvedValueOnce(templates) // templates
      .mockResolvedValueOnce([]) // transactions
      .mockResolvedValueOnce([]); // loan repayment links
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes the month before the period for a UTC+1 caller selecting August', async () => {
    // Lisbon local midnight on 1 August 2026 is 31 July 23:00 UTC, so a UTC read
    // of `fromDate` started the covered set in July and paid out July's budget.
    givenTemplatesFor([2026, 7], [2026, 8]);

    const rows = await getBudgetVsActualReport(
      makeInput({ fromDate: '2026-07-31T23:00:00.000Z', timezone: 'Europe/Lisbon', toDate: '2026-08-31T22:59:59.999Z' }),
    );

    // Only August's 100 is budgeted; July's would have doubled it.
    expect(rows).toEqual([expect.objectContaining({ budgeted: 100, name: 'Food' })]);
  });

  it('still matches templates whose month is a single digit', async () => {
    // The join key is zero-padded on both sides now; padding only one side would
    // silently drop every month before October.
    givenTemplatesFor([2026, 9]);

    const rows = await getBudgetVsActualReport(
      makeInput({ fromDate: '2026-08-31T23:00:00.000Z', timezone: 'Europe/Lisbon', toDate: '2026-09-30T22:59:59.999Z' }),
    );

    expect(rows).toEqual([expect.objectContaining({ budgeted: 100 })]);
  });

  it('covers every month spanned by a range that crosses a year boundary', async () => {
    givenTemplatesFor([2026, 12], [2027, 1]);

    const rows = await getBudgetVsActualReport(
      makeInput({ fromDate: '2026-11-30T23:00:00.000Z', timezone: 'Europe/Lisbon', toDate: '2027-01-31T22:59:59.999Z' }),
    );

    expect(rows).toEqual([expect.objectContaining({ budgeted: 200 })]);
  });

  it('falls back to the default calendar rather than throwing on an unusable timezone', async () => {
    givenTemplatesFor([2026, 7], [2026, 8]);

    const rows = await getBudgetVsActualReport(
      makeInput({ fromDate: '2026-07-31T23:00:00.000Z', timezone: 'Middle/Earth', toDate: '2026-08-31T22:59:59.999Z' }),
    );

    expect(rows).toEqual([expect.objectContaining({ budgeted: 100 })]);
  });

  it('returns an empty dataset when no template overlaps the period', async () => {
    givenTemplatesFor([2025, 3]);

    const rows = await getBudgetVsActualReport(
      makeInput({ fromDate: '2026-07-31T23:00:00.000Z', timezone: 'Europe/Lisbon', toDate: '2026-08-31T22:59:59.999Z' }),
    );

    expect(rows).toEqual([]);
  });
});
