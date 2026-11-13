import type { HouseholdMember } from "@/lib/api/household/types";

/**
 * Who money is attributed to in a household (issue #96): one member, or "Shared", the household
 * as a whole (a joint account, an explicit Shared attribution, or someone who has left).
 *
 * The member filter narrows transactions, reports, budgets and the dashboard to one of these.
 * `null` is "Everyone": no filter at all.
 */
export type MemberFilter = number | "shared" | null;

/** The URL parameter a page keeps its member filter in: `?member=<appuserKey>` or `?member=shared`. */
export const MEMBER_FILTER_PARAM = "member";

export const SHARED_MEMBER = "shared";

const MEMBER_KEY = /^[1-9]\d*$/;

/** Reads a filter from its URL value; anything unrecognised is "Everyone". */
export function parseMemberFilter(value: string | null | undefined): MemberFilter {
  if (value === SHARED_MEMBER) return SHARED_MEMBER;
  if (value && MEMBER_KEY.test(value)) return Number(value);
  return null;
}

/** The URL value of a filter, or `undefined` for "Everyone" (the parameter is dropped). */
export function memberFilterParam(filter: MemberFilter): string | undefined {
  return filter === null ? undefined : String(filter);
}

/**
 * The `memberKeys` a list, report, budget or cash-flow request sends, or `undefined` for
 * "Everyone" so the request carries no filter.
 */
export function memberKeysFor(filter: MemberFilter): string[] | undefined {
  return filter === null ? undefined : [String(filter)];
}

/**
 * Keeps a filter only when it still names someone in the household: a stale link to a member
 * who has left reads as "Everyone" rather than a request the API would refuse. A household of
 * one has nothing to filter by.
 */
export function resolveMemberFilter(
  filter: MemberFilter,
  members: readonly HouseholdMember[],
): MemberFilter {
  if (members.length <= 1) return null;
  if (filter === null || filter === SHARED_MEMBER) return filter;
  return members.some((member) => member.appuserKey === filter) ? filter : null;
}

/** A member's name as the app shows it: their first name, else their email. */
export function memberDisplayName(
  member: Pick<HouseholdMember, "emailAddress" | "firstName">,
): string {
  return member.firstName?.trim() || member.emailAddress;
}

/**
 * Up to two letters for a member's badge: the first letters of the first and last words of a
 * name ("Ana Sousa" is "AS"), or the first letter of an email.
 */
export function memberInitials(displayName: string): string {
  const name = displayName.trim();
  if (!name) return "?";
  if (name.includes("@")) return name[0].toUpperCase();
  const words = name.split(/\s+/);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
