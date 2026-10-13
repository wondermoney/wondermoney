import { describe, expect, it } from 'vitest';

import { computeSyncStatus } from '../account-sync-status.service';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe('computeSyncStatus', () => {
  it('returns null for manual accounts (they never go stale)', () => {
    expect(
      computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(1000), now: NOW, source: 'manual' }),
    ).toBeNull();
  });

  it('marks a recently-synced open-banking account as fresh', () => {
    const status = computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(1), now: NOW, source: 'open_banking' });
    expect(status).toEqual({
      hasOpenIncident: false,
      lastSyncedAt: hoursAgo(1).toISOString(),
      staleness: 'fresh',
    });
  });

  it('marks an account synced between 24h and 72h ago as stale', () => {
    expect(computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(30), now: NOW, source: 'open_banking' })?.staleness).toBe('stale');
  });

  it('marks an account synced more than 72h ago as very_stale', () => {
    expect(computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(100), now: NOW, source: 'open_banking' })?.staleness).toBe('very_stale');
  });

  it('treats a never-synced open-banking account as very_stale', () => {
    const status = computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: null, now: NOW, source: 'open_banking' });
    expect(status).toEqual({ hasOpenIncident: false, lastSyncedAt: null, staleness: 'very_stale' });
  });

  it('reports error when there is an open incident, regardless of recency', () => {
    const status = computeSyncStatus({ hasOpenIncident: true, lastSyncedAt: hoursAgo(1), now: NOW, source: 'open_banking' });
    expect(status).toEqual({ hasOpenIncident: true, lastSyncedAt: hoursAgo(1).toISOString(), staleness: 'error' });
  });

  it('uses inclusive lower bounds: exactly 24h is stale, exactly 72h is very_stale', () => {
    expect(computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(24), now: NOW, source: 'open_banking' })?.staleness).toBe('stale');
    expect(computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(72), now: NOW, source: 'open_banking' })?.staleness).toBe('very_stale');
  });

  it('honours custom thresholds', () => {
    expect(
      computeSyncStatus({ hasOpenIncident: false, lastSyncedAt: hoursAgo(2), now: NOW, source: 'open_banking', staleHours: 1, veryStaleHours: 3 })?.staleness,
    ).toBe('stale');
  });
});
