import type { GrantableHouseholdRole, HouseholdInvite, HouseholdMemberDto, HouseholdResponseDto, HouseholdRoleValue } from './household-contract'
import {
  canInviteToHousehold,
  canLeaveHousehold,
  canManageInvite,
  grantableRoles,
  householdMemberActions,
  type HouseholdMemberActions,
} from './household-permissions'

export type HouseholdMemberRow = HouseholdMemberDto & Readonly<{
  isMe: boolean
  actions: HouseholdMemberActions
}>

export type HouseholdInviteRow = HouseholdInvite & Readonly<{ canManage: boolean }>

export type HouseholdViewModel = Readonly<{
  members: readonly HouseholdMemberRow[]
  pendingInvites: readonly HouseholdInviteRow[]
  me: HouseholdMemberDto | null
  myRole: HouseholdRoleValue | null
  isOwner: boolean
  /** The roles the invite form offers, highest first; empty when the viewer can't invite. */
  inviteRoles: readonly GrantableHouseholdRole[]
  canInvite: boolean
  canLeave: boolean
  maxMembers: number
}>

/**
 * Mirrors web's Household page: "me" is the member the API names as the viewer
 * (`viewerAppuserKey`), or, from an older API that doesn't send it, the member with the
 * viewer's email address. Every action comes from `household-permissions`.
 */
export function computeHouseholdViewModel(household: HouseholdResponseDto, viewerEmail: string | null | undefined): HouseholdViewModel {
  const normalizedViewerEmail = viewerEmail?.trim().toLowerCase() ?? ''
  const me = (household.viewerAppuserKey !== null
    ? household.members.find((member) => member.appuserKey === household.viewerAppuserKey)
    : undefined)
    ?? (normalizedViewerEmail ? household.members.find((member) => member.emailAddress.toLowerCase() === normalizedViewerEmail) : undefined)
    ?? null
  const myRole = me?.role ?? null
  const canInvite = canInviteToHousehold(myRole, household.members.length, household.pendingInvites.length, household.maxMembers)

  return {
    members: household.members.map((member) => ({
      ...member,
      isMe: member.appuserKey === me?.appuserKey,
      actions: householdMemberActions(me, member),
    })),
    pendingInvites: household.pendingInvites.map((invite) => ({ ...invite, canManage: canManageInvite(myRole, invite.role) })),
    me,
    myRole,
    isOwner: myRole === 'owner',
    inviteRoles: canInvite ? grantableRoles(myRole) : [],
    canInvite,
    canLeave: canLeaveHousehold(myRole),
    maxMembers: household.maxMembers,
  }
}

export function householdMemberLabel(member: Pick<HouseholdMemberDto, 'firstName' | 'emailAddress'>): string {
  return member.firstName?.trim() || member.emailAddress
}

export function householdMemberInitials(member: Pick<HouseholdMemberDto, 'firstName' | 'emailAddress'>): string {
  const source = member.firstName?.trim()?.[0] ?? member.emailAddress[0] ?? '?'
  return source.toUpperCase()
}
