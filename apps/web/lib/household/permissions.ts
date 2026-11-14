import type {
  GrantableHouseholdRole,
  Household,
  HouseholdMember,
  HouseholdRole,
} from "@/lib/api/household/types";

/**
 * What each household role may do, mirroring the API's `householdCan`
 * (`apps/api/src/services/household/household-permissions.ts`). The API is the
 * authority; this only decides which controls the settings screen offers.
 *
 * One rule for managing people: a manager (owner or admin) acts on, and grants,
 * only roles strictly below their own. Nobody acts on themself (removing
 * yourself is leaving), `owner` is never granted, and only the owner transfers
 * ownership.
 */

const RANK: Readonly<Record<HouseholdRole, number>> = {
  admin: 2,
  member: 1,
  owner: 3,
  viewer: 0,
};

/** Highest first: the order a role picker lists them. */
export const GRANTABLE_HOUSEHOLD_ROLES = [
  "admin",
  "member",
  "viewer",
] as const satisfies readonly GrantableHouseholdRole[];

export const DEFAULT_INVITE_ROLE: GrantableHouseholdRole = "member";

const below = (role: HouseholdRole, actor: HouseholdRole) =>
  RANK[role] < RANK[actor];

export function isHouseholdManager(role: HouseholdRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** The roles `actor` may hand out in an invite or a role change. */
export function grantableRoles(
  actor: HouseholdRole | undefined,
): GrantableHouseholdRole[] {
  if (!actor || !isHouseholdManager(actor)) return [];
  return GRANTABLE_HOUSEHOLD_ROLES.filter((role) => below(role, actor));
}

/** Places left: active members and pending invites both take one. */
export function seatsRemaining(household: Household): number {
  return Math.max(
    0,
    household.maxMembers -
      household.members.length -
      household.pendingInvites.length,
  );
}

/** The caller's own row: by `viewerAppuserKey`, else by email (older API). */
export function findMe(
  household: Household,
  email: null | string | undefined,
): HouseholdMember | undefined {
  if (household.viewerAppuserKey !== null) {
    return household.members.find(
      (member) => member.appuserKey === household.viewerAppuserKey,
    );
  }
  const wanted = email?.toLowerCase();
  if (!wanted) return undefined;
  return household.members.find(
    (member) => member.emailAddress.toLowerCase() === wanted,
  );
}

/** Whether to show the invite form at all: a manager, with a place left. */
export function canInvite(
  actor: HouseholdRole | undefined,
  household: Household,
): boolean {
  return isHouseholdManager(actor) && seatsRemaining(household) > 0;
}

/** Resend or revoke an invite that would join with `inviteRole`. */
export function canManageInvite(
  actor: HouseholdRole | undefined,
  inviteRole: GrantableHouseholdRole,
): boolean {
  return grantableRoles(actor).includes(inviteRole);
}

const isSelf = (me: HouseholdMember, target: HouseholdMember) =>
  me.appuserKey === target.appuserKey;

/** Change `target`'s role to some other role: someone else, below the caller. */
export function canChangeRole(
  me: HouseholdMember | undefined,
  target: HouseholdMember,
): boolean {
  if (!me || isSelf(me, target) || !isHouseholdManager(me.role)) return false;
  return below(target.role, me.role);
}

/** The roles a role change for `target` can pick from (their current one among them). */
export function roleChangeOptions(
  me: HouseholdMember | undefined,
  target: HouseholdMember,
): GrantableHouseholdRole[] {
  if (!canChangeRole(me, target)) return [];
  return grantableRoles(me?.role);
}

/** Remove someone else from the household (leaving is `canLeave`). */
export function canRemoveMember(
  me: HouseholdMember | undefined,
  target: HouseholdMember,
): boolean {
  if (!me || isSelf(me, target) || !isHouseholdManager(me.role)) return false;
  return below(target.role, me.role);
}

/** Everyone but the owner may leave; the owner transfers ownership first. */
export function canLeave(me: HouseholdMember | undefined): boolean {
  return Boolean(me) && me?.role !== "owner";
}

/** Only the owner hands ownership to another member. */
export function canTransferOwnership(
  me: HouseholdMember | undefined,
  target: HouseholdMember,
): boolean {
  return Boolean(me) && me?.role === "owner" && !isSelf(me, target);
}
