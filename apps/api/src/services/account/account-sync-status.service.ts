/**
 * Stale-sync warning.
 *
 * Derives a user-facing freshness signal for an account from its last successful
 * transaction sync and whether it currently has an open (non-terminal, user-visible)
 * `BankSyncIncident`. Manual accounts never go stale — only open-banking accounts are
 * synced on a schedule, so a missing charge on them "looks exactly like a quiet spending
 * day" unless we surface staleness (the ticket's Monarch reference).
 */

export type AccountSource = 'manual' | 'open_banking';

/** Ordered least → most severe. `error` means an open sync incident, independent of recency. */
export interface ComputeSyncStatusInput {
  hasOpenIncident: boolean;
  lastSyncedAt: Date | null | undefined;
  now: Date;
  source: AccountSource;
  /** Age (hours) at/after which an account is `stale`. Default 24. */
  staleHours?: number;
  /** Age (hours) at/after which an account is `very_stale`. Default 72. */
  veryStaleHours?: number;
}

export type SyncStaleness = 'error' | 'fresh' | 'stale' | 'very_stale';

export interface SyncStatus {
  hasOpenIncident: boolean;
  /** ISO-8601 timestamp of the last successful sync, or null if never synced. */
  lastSyncedAt: null | string;
  staleness: SyncStaleness;
}

const DEFAULT_STALE_HOURS = 24;
const DEFAULT_VERY_STALE_HOURS = 72;
const MS_PER_HOUR = 60 * 60 * 1000;

export function computeSyncStatus(input: ComputeSyncStatusInput): null | SyncStatus {
  // Manual accounts are user-maintained; they have no sync and cannot be stale.
  if (input.source === 'manual') return null;

  const lastSyncedAt = input.lastSyncedAt ?? null;
  const staleHours = input.staleHours ?? DEFAULT_STALE_HOURS;
  const veryStaleHours = input.veryStaleHours ?? DEFAULT_VERY_STALE_HOURS;

  return {
    hasOpenIncident: input.hasOpenIncident,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    staleness: deriveStaleness({ hasOpenIncident: input.hasOpenIncident, lastSyncedAt, now: input.now, staleHours, veryStaleHours }),
  };
}

function deriveStaleness(args: {
  hasOpenIncident: boolean;
  lastSyncedAt: Date | null;
  now: Date;
  staleHours: number;
  veryStaleHours: number;
}): SyncStaleness {
  // An open incident is the strongest signal — the sync is actively failing.
  if (args.hasOpenIncident) return 'error';
  // Never synced: treat as the worst non-error band so the client badges it.
  if (!args.lastSyncedAt) return 'very_stale';

  const ageHours = (args.now.getTime() - args.lastSyncedAt.getTime()) / MS_PER_HOUR;
  if (ageHours >= args.veryStaleHours) return 'very_stale';
  if (ageHours >= args.staleHours) return 'stale';
  return 'fresh';
}
