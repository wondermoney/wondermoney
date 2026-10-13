import { describe, expect, it } from 'vitest';

import { getLisbonBudgetPeriod, getLisbonWeeklyPeriod, INVALID_SCHEDULED_FOR } from '../aggregation-periods';

describe('Lisbon aggregation periods', () => {
  it.each([undefined, '', '2026-03-01', 'not-an-instant'])('rejects missing or invalid scheduledFor: %s', (scheduledFor) => {
    expect(() => getLisbonBudgetPeriod(scheduledFor ?? '')).toThrow(INVALID_SCHEDULED_FOR);
  });

  it('uses 23-hour and 25-hour Lisbon days across spring and fall DST', () => {
    const spring = getLisbonBudgetPeriod('2026-03-29T09:00:00+01:00');
    const fall = getLisbonBudgetPeriod('2026-10-25T09:00:00+00:00');
    expect(spring.day.end.getTime() - spring.day.start.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(fall.day.end.getTime() - fall.day.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('derives immutable ranges from the supplied instant across month rollover', () => {
    const first = getLisbonBudgetPeriod('2026-04-01T08:00:00Z');
    const retry = getLisbonBudgetPeriod('2026-04-01T08:00:00Z');
    expect(first).toEqual(retry);
    expect(first.localDate).toBe('2026-04-01');
    expect(first.monthRange.start.toISOString()).toBe('2026-03-31T23:00:00.000Z');
    expect(first.monthRange.end.toISOString()).toBe('2026-04-30T23:00:00.000Z');
  });

  it('returns the last two complete Lisbon ISO weeks across ISO-year rollover', () => {
    const period = getLisbonWeeklyPeriod('2026-01-05T09:00:00Z');
    expect({ isoWeek: period.isoWeek, isoWeekYear: period.isoWeekYear }).toEqual({ isoWeek: 1, isoWeekYear: 2026 });
    expect(period.subjectWeek.start.toISOString()).toBe('2025-12-29T00:00:00.000Z');
    expect(period.subjectWeek.end.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(period.comparisonWeek.start.toISOString()).toBe('2025-12-22T00:00:00.000Z');
  });

  it('keeps subject/comparison boundaries correct across Lisbon DST transitions', () => {
    const spring = getLisbonWeeklyPeriod('2026-04-06T08:00:00Z');
    const fall = getLisbonWeeklyPeriod('2026-11-02T09:00:00Z');
    expect(spring.comparisonWeek.end.getTime() - spring.comparisonWeek.start.getTime()).toBe(167 * 60 * 60 * 1000);
    expect(spring.subjectWeek.end.getTime() - spring.subjectWeek.start.getTime()).toBe(168 * 60 * 60 * 1000);
    expect(fall.comparisonWeek.end.getTime() - fall.comparisonWeek.start.getTime()).toBe(169 * 60 * 60 * 1000);
    expect(fall.subjectWeek.end.getTime() - fall.subjectWeek.start.getTime()).toBe(168 * 60 * 60 * 1000);
  });
});
