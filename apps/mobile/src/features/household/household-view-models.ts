import { HOUSEHOLD_MAX_MEMBERS, type HouseholdMemberDto, type HouseholdResponseDto, type PendingHouseholdInviteDto } from './household-contract'

export type HouseholdViewModel = Readonly<{
  members: readonly HouseholdMemberDto[]
  pendingInvite: PendingHouseholdInviteDto | null
  me: HouseholdMemberDto | null
  isOwner: boolean
  partner: HouseholdMemberDto | null
  canInvite: boolean
}>

/** Mirrors web's Household.tsx: derive "me"/owner/partner/canInvite from the viewer's own
 * email address, since the household resource itself carries no "is this you" flag. */
export function computeHouseholdViewModel(household: HouseholdResponseDto, viewerEmail: string): HouseholdViewModel {
  const normalizedViewerEmail = viewerEmail.trim().toLowerCase()
  const me = household.members.find((member) => member.emailAddress.toLowerCase() === normalizedViewerEmail) ?? null
  const isOwner = me?.role === 'owner'
  const partner = household.members.find((member) => member.role === 'member') ?? null
  const canInvite = isOwner && household.members.length < HOUSEHOLD_MAX_MEMBERS && household.pendingInvite === null

  return {
    members: household.members,
    pendingInvite: household.pendingInvite,
    me,
    isOwner,
    partner,
    canInvite,
  }
}

export function householdMemberLabel(member: HouseholdMemberDto): string {
  return member.firstName?.trim() || member.emailAddress
}

export function householdMemberInitials(member: HouseholdMemberDto): string {
  const source = member.firstName?.trim()?.[0] ?? member.emailAddress[0] ?? '?'
  return source.toUpperCase()
}
