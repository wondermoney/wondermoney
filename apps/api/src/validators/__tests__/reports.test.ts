import { describe, expect, it } from 'vitest';

import { REPORT_DEFAULT_TIME_ZONE } from '@service/reports/report-months';

import { MAX_REPORT_RANGE_DAYS, reportFiltersSchema } from '../reports';

const isoDaysApart = (days: number) => {
  const from = new Date('2020-01-01T00:00:00.000Z');
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return { fromDate: from.toISOString(), toDate: to.toISOString() };
};

/**
 * An unbounded span lets one authenticated account force a full-history aggregation per request,
 * which the generous `read` rate-limit budget does not contain.
 */
describe('reportFiltersSchema date range', () => {
  it('accepts a range at the cap', () => {
    expect(reportFiltersSchema.safeParse(isoDaysApart(MAX_REPORT_RANGE_DAYS)).success).toBe(true);
  });

  it('rejects a range beyond the cap', () => {
    const result = reportFiltersSchema.safeParse(isoDaysApart(MAX_REPORT_RANGE_DAYS + 1));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(String(MAX_REPORT_RANGE_DAYS));
  });

  it('rejects the full-history probe', () => {
    expect(
      reportFiltersSchema.safeParse({ fromDate: '0001-01-01T00:00:00.000Z', toDate: '9999-12-31T00:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('rejects an inverted range', () => {
    expect(reportFiltersSchema.safeParse(isoDaysApart(-1)).success).toBe(false);
  });

  it('leaves a one-sided or absent range alone, so existing callers are unaffected', () => {
    expect(reportFiltersSchema.safeParse({}).success).toBe(true);
    expect(reportFiltersSchema.safeParse({ fromDate: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
    expect(reportFiltersSchema.safeParse({ toDate: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
  });
});

/**
 * RAD-555 — the `timezone` filter is the calendar a report groups periods in.
 * It is additive: existing callers send nothing and get the assumed default,
 * echoed back so the response says which calendar produced it.
 */
describe('reportFiltersSchema timezone', () => {
  it('defaults to the assumed report calendar when omitted', () => {
    expect(reportFiltersSchema.parse({}).timezone).toBe(REPORT_DEFAULT_TIME_ZONE);
  });

  it('accepts an IANA time zone name', () => {
    expect(reportFiltersSchema.parse({ timezone: 'America/New_York' }).timezone).toBe('America/New_York');
  });

  it('rejects a name Intl cannot resolve', () => {
    const result = reportFiltersSchema.safeParse({ timezone: 'Middle/Earth' });

    expect(result.success).toBe(false);
  });

  it('leaves the rest of the envelope untouched', () => {
    const parsed = reportFiltersSchema.parse({ fromDate: '2026-08-01T00:00:00.000Z' });

    expect(parsed).toMatchObject({
      fromDate: '2026-08-01T00:00:00.000Z',
      includePending: false,
      includeTransfers: false,
    });
  });
});
