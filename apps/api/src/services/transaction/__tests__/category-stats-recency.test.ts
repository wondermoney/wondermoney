import { describe, expect, it } from 'vitest';

import { CATEGORY_STATS_RECENCY_HALF_LIFE_DAYS, pickRecencyWeightedTopStat } from '../category-stats-recency';

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe('pickRecencyWeightedTopStat (RAD-342 G2)', () => {
  const now = new Date('2026-08-02T00:00:00.000Z');

  it('returns null for an empty list', () => {
    expect(pickRecencyWeightedTopStat([], now)).toBeNull();
  });

  it('returns the only stat when there is one', () => {
    const only = { categoryKey: 1, count: 5, updatedAt: daysAgo(now, 400) };
    expect(pickRecencyWeightedTopStat([only], now)).toBe(only);
  });

  it('lets a recent low-count vote beat a stale high-count vote (the core G2 behaviour)', () => {
    const staleHigh = { categoryKey: 1, count: 10, updatedAt: daysAgo(now, 365) };
    const recentLow = { categoryKey: 2, count: 3, updatedAt: now };
    expect(pickRecencyWeightedTopStat([staleHigh, recentLow], now)).toBe(recentLow);
  });

  it('falls back to raw count when recency is equal (higher count wins)', () => {
    const a = { categoryKey: 1, count: 5, updatedAt: daysAgo(now, 30) };
    const b = { categoryKey: 2, count: 2, updatedAt: daysAgo(now, 30) };
    expect(pickRecencyWeightedTopStat([a, b], now)).toBe(a);
  });

  it('returns null (a tie) when two stats have identical count and recency', () => {
    const a = { categoryKey: 1, count: 4, updatedAt: daysAgo(now, 10) };
    const b = { categoryKey: 2, count: 4, updatedAt: daysAgo(now, 10) };
    expect(pickRecencyWeightedTopStat([a, b], now)).toBeNull();
  });

  it('does not penalise a stat with a missing updatedAt (treated as fresh)', () => {
    const noTimestamp = { categoryKey: 1, count: 4 };
    const stale = { categoryKey: 2, count: 5, updatedAt: daysAgo(now, 400) };
    // 4 * 1 (no decay) beats 5 * 0.5^(400/90) ≈ 5 * 0.046 ≈ 0.23
    expect(pickRecencyWeightedTopStat([noTimestamp, stale], now)).toBe(noTimestamp);
  });

  it('exposes a sane default half-life', () => {
    expect(CATEGORY_STATS_RECENCY_HALF_LIFE_DAYS).toBeGreaterThan(0);
  });
});
