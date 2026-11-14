/**
 * The portfolios overview's member filter (`lib/household/member-attribution.ts`) as the
 * aggregate portfolio reads take it: they keep the portfolios those members own, a former
 * member's under Shared. A single portfolio has one owner, so its reads take none.
 *
 * Absent or empty is everyone, and then nothing is sent, so an unfiltered request (and its query
 * key) is the same as before the filter existed.
 */

/** The value sent as `memberKeys`, or null for everyone (and for one portfolio). */
export function portfolioMembers(
  memberKeys: readonly string[] | undefined,
  portfolioId: number | null = null,
): string | null {
  return !portfolioId && memberKeys?.length ? memberKeys.join(",") : null;
}

/** The request params for `portfolioMembers`: `{ memberKeys }` when filtered, else nothing. */
export function portfolioMembersParams(
  memberKeys: readonly string[] | undefined,
  portfolioId: number | null = null,
): { memberKeys?: string } {
  const members = portfolioMembers(memberKeys, portfolioId);
  return members ? { memberKeys: members } : {};
}

/**
 * The query key's tail for `portfolioMembers`: a filter is its own entry under the read's key,
 * so invalidating the read refreshes every member's.
 */
export function portfolioMembersKey(
  memberKeys: readonly string[] | undefined,
  portfolioId: number | null = null,
): [] | [string] {
  const members = portfolioMembers(memberKeys, portfolioId);
  return members ? [members] : [];
}
