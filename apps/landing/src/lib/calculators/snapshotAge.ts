/** Whole days from a date ("2026-11-19") or a UTC time ("2026-11-19T05:00Z") to `now`. */
export function snapshotAgeDays(date: string, now: number = Date.now()): number {
  const at = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}
