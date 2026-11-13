import { GRANTABLE_HOUSEHOLD_ROLES, type GrantableHouseholdRole, type HouseholdRoleValue } from './household-contract'

/**
 * The API's household rule, in one place so the screen offers only what the server will allow:
 * a manager (owner or admin) acts on, and grants, only roles strictly below their own; nobody
 * acts on themselves; only the owner transfers ownership; members and viewers manage nothing.
 * The server enforces the same rule and stays the authority; this only decides what to show.
 */

const RANK: Readonly<Record<HouseholdRoleValue, number>> = {
  owner: 3,
  admin: 2,
  member: 1,
  viewer: 0,
  // A role this build doesn't know is never a manager and is never acted on.
  unknown: -1,
}

export const householdRoleRank = (role: HouseholdRoleValue): number => RANK[role]

export const isHouseholdManager = (role: HouseholdRoleValue | null | undefined): boolean => role === 'owner' || role === 'admin'

/** The roles `actor` may grant, by invite or by a role change: those strictly below their own. */
export function grantableRoles(actor: HouseholdRoleValue | null | undefined): readonly GrantableHouseholdRole[] {
  if (!actor || !isHouseholdManager(actor)) return []
  return GRANTABLE_HOUSEHOLD_ROLES.filter((role) => RANK[role] < RANK[actor])
}

export type HouseholdMemberActions = Readonly<{
  /** The roles this member can be moved to (never their current one); empty when none. */
  changeRoleTo: readonly GrantableHouseholdRole[]
  remove: boolean
  transferOwnership: boolean
}>

const NO_ACTIONS: HouseholdMemberActions = { changeRoleTo: [], remove: false, transferOwnership: false }

type Party = Readonly<{ appuserKey: number; role: HouseholdRoleValue }>

/** What `actor` may do to `target`. Leaving (acting on yourself) is `canLeave`, not this. */
export function householdMemberActions(actor: Party | null, target: Party): HouseholdMemberActions {
  if (!actor || actor.appuserKey === target.appuserKey) return NO_ACTIONS
  if (!isHouseholdManager(actor.role)) return NO_ACTIONS
  // A role this build doesn't know could rank anywhere on the server: leave it alone.
  if (target.role === 'unknown') return NO_ACTIONS
  const outranks = RANK[target.role] < RANK[actor.role]
  return {
    changeRoleTo: outranks ? grantableRoles(actor.role).filter((role) => role !== target.role) : [],
    remove: outranks,
    transferOwnership: actor.role === 'owner',
  }
}

/** Anyone but the owner can leave; the owner transfers ownership first. */
export const canLeaveHousehold = (role: HouseholdRoleValue | null | undefined): boolean => Boolean(role) && role !== 'owner'

/** Invites count against the cap together with the members already in. */
export function canInviteToHousehold(
  role: HouseholdRoleValue | null | undefined,
  memberCount: number,
  pendingInviteCount: number,
  maxMembers: number,
): boolean {
  return isHouseholdManager(role) && memberCount + pendingInviteCount < maxMembers
}

/** A manager acts on an invite only when its role is one they could grant. */
export function canManageInvite(actor: HouseholdRoleValue | null | undefined, inviteRole: HouseholdRoleValue): boolean {
  if (!isHouseholdManager(actor) || !actor) return false
  if (inviteRole === 'unknown') return actor === 'owner'
  return RANK[inviteRole] < RANK[actor]
}
