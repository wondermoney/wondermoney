/**
 * Recency-weighted selection over `TransactionCategoryStats`.
 *
 * The stats fallback (used only when a user has no explicit per-user merchant mapping) must not
 * pick the winner on raw vote `count`, or a large pile of *stale* votes for one category would beat
 * a user's more *recent* intent for another. This weights each row's count by an exponential decay on
 * how long ago it was last touched (`updatedAt`, which the vote upsert bumps on every increment), so
 * recent corrections outweigh old ones while a clear count majority still wins when recency is equal.
 *
 * Deliberately modest: an explicitly-categorized merchant already has a per-user mapping
 * that takes priority over stats, so this only sharpens the residual fallback — it never overrides a
 * mapping.
 */

// ~3 months: a vote's weight halves every 90 days. Long enough that a genuine preference persists,
// short enough that a year-old one-off no longer dominates a recent correction.
export const CATEGORY_STATS_RECENCY_HALF_LIFE_DAYS = 90;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// Two weighted scores within this relative epsilon count as a tie (guards float noise).
const TIE_EPSILON = 1e-9;

interface RecencyWeightedStat {
  count: number;
  updatedAt?: Date | null | string;
}

function ageInDays(updatedAt: Date | null | string | undefined, now: Date): number {
  if (!updatedAt) return 0; // Unknown recency: treat as fresh rather than penalising it.
  const updated = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const millis = now.getTime() - updated.getTime();
  return millis > 0 ? millis / MILLISECONDS_PER_DAY : 0;
}

function recencyWeightedScore(stat: RecencyWeightedStat, now: Date): number {
  return stat.count * 0.5 ** (ageInDays(stat.updatedAt, now) / CATEGORY_STATS_RECENCY_HALF_LIFE_DAYS);
}

/**
 * Return the single stat with the strictly-highest recency-weighted score, or `null` when the list
 * is empty or the top score is shared (a genuine tie the caller should surface for review).
 */
export function pickRecencyWeightedTopStat<T extends RecencyWeightedStat>(stats: T[], now: Date = new Date()): null | T {
  if (stats.length === 0) return null;

  const scored = stats.map((stat) => ({ score: recencyWeightedScore(stat, now), stat }));
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const tolerance = TIE_EPSILON * Math.max(1, Math.abs(bestScore));
  const winners = scored.filter((entry) => Math.abs(entry.score - bestScore) <= tolerance);

  return winners.length === 1 ? winners[0]!.stat : null;
}
