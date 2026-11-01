/**
 * A sync time is always in the past. A timestamp after `now` (clock skew, or a seeded
 * `refreshedAt` pushed decades ahead to stop the worker refreshing it) would otherwise
 * render as "Balances updated in almost 20 years", so it reads as "now" instead.
 *
 * Accepts what the account DTO carries (an ISO string or null) and returns the same
 * shape, so call sites can wrap the value they already pass.
 */
export function clampSyncedAt<T extends Date | null | string | undefined>(
  value: T,
  now: number = Date.now(),
): T {
  if (value === null || value === undefined) return value;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time) || time <= now) return value;
  return (
    value instanceof Date ? new Date(now) : new Date(now).toISOString()
  ) as T;
}
