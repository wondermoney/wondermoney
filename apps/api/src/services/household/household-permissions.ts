import { HouseholdRole } from '@entity/AppuserTenant';

/**
 * What each household role may do. The one place that decides it: the household routes'
 * middleware, the household services and the viewer write guard (`middleware/household.ts`) all
 * ask `householdCan`.
 *
 * - owner: everything, including changing roles and transferring ownership.
 * - admin: invite, resend, revoke, change roles and remove — for the people below admin only.
 * - member: read and change the household's shared data; leave.
 * - viewer: read the household's shared data only; leave.
 *
 * The rule for managing people is one rule: a manager (owner or admin) acts on, and grants, only
 * roles strictly below their own. `owner` is never granted; ownership moves by transfer. Whether
 * the target is the caller themself (nobody changes their own role; removing yourself is leaving)
 * is the caller's identity, so the services check it next to the identities.
 *
 * Actions: `changeRole` a member from `from` to `to`; `invite` someone who will join with `role`;
 * `manageInvite` (resend or revoke) a pending invite for `role`; `removeMember` another member who
 * holds `role`; `leave`; `manage` (open the household management routes at all);
 * `transferOwnership`; `writeSharedData`.
 */
export type HouseholdAction =
  | 'leave'
  | 'manage'
  | 'transferOwnership'
  | 'writeSharedData'
  | { from: HouseholdRole; kind: 'changeRole'; to: HouseholdRole }
  | { kind: 'invite'; role: HouseholdRole }
  | { kind: 'manageInvite'; role: HouseholdRole }
  | { kind: 'removeMember'; role: HouseholdRole };

const RANK: Readonly<Record<HouseholdRole, number>> = {
  [HouseholdRole.ADMIN]: 2,
  [HouseholdRole.MEMBER]: 1,
  [HouseholdRole.OWNER]: 3,
  [HouseholdRole.VIEWER]: 0,
};

/** The roles an invite or a role change can grant: every role but owner. */
export const GRANTABLE_HOUSEHOLD_ROLES = [HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER] as const;

const isManager = (role: HouseholdRole) => role === HouseholdRole.OWNER || role === HouseholdRole.ADMIN;
const below = (role: HouseholdRole, actor: HouseholdRole) => RANK[role] < RANK[actor];
const grantable = (role: HouseholdRole, actor: HouseholdRole) => role !== HouseholdRole.OWNER && below(role, actor);

export function householdCan(role: HouseholdRole | undefined, action: HouseholdAction): boolean {
  if (!role) return false;
  if (action === 'writeSharedData') return role !== HouseholdRole.VIEWER;
  if (action === 'leave') return role !== HouseholdRole.OWNER;
  if (action === 'manage') return isManager(role);
  if (action === 'transferOwnership') return role === HouseholdRole.OWNER;
  if (!isManager(role)) return false;
  switch (action.kind) {
    case 'changeRole':
      return below(action.from, role) && grantable(action.to, role);
    case 'invite':
    case 'manageInvite':
      return grantable(action.role, role);
    case 'removeMember':
      return below(action.role, role);
  }
}
