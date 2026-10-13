import { describe, expect, it } from 'vitest';

import { AssistantPeriodService } from '../assistant-period.service';

describe('AssistantPeriodService', () => {
  it('resolves current_month using the calendar month for a fixed date', () => {
    const resolved = AssistantPeriodService.resolve('current_month', new Date('2026-05-31T12:00:00.000Z'));

    expect(resolved.key).toBe('current_month');
    expect(resolved.granularity).toBe('month');
    expect(resolved.start.getFullYear()).toBe(2026);
    expect(resolved.start.getMonth()).toBe(4);
    expect(resolved.start.getDate()).toBe(1);
    expect(resolved.end.getFullYear()).toBe(2026);
    expect(resolved.end.getMonth()).toBe(4);
    expect(resolved.end.getDate()).toBe(31);
  });

  it.each([
    ['previous_month', 2026, 3, 1, 2026, 3, 30],
    ['last_90_days', 2026, 2, 3, 2026, 4, 31],
    ['year_to_date', 2026, 0, 1, 2026, 4, 31],
    ['last_12_months', 2025, 5, 1, 2026, 4, 31],
  ] as const)('resolves %s', (period, startYear, startMonth, startDay, endYear, endMonth, endDay) => {
    const resolved = AssistantPeriodService.resolve(period, new Date('2026-05-31T12:00:00.000Z'));

    expect(resolved.start.getFullYear()).toBe(startYear);
    expect(resolved.start.getMonth()).toBe(startMonth);
    expect(resolved.start.getDate()).toBe(startDay);
    expect(resolved.end.getFullYear()).toBe(endYear);
    expect(resolved.end.getMonth()).toBe(endMonth);
    expect(resolved.end.getDate()).toBe(endDay);
  });
});
