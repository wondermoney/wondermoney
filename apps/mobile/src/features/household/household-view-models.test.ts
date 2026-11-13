import type { HouseholdResponseDto } from './household-contract'
import { computeHouseholdViewModel, householdMemberInitials, householdMemberLabel } from './household-view-models'

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Owner', role: 'owner' as const }
const admin = { appuserKey: 2, emailAddress: 'admin@example.com', firstName: 'Ada', role: 'admin' as const }
const member = { appuserKey: 3, emailAddress: 'member@example.com', firstName: null, role: 'member' as const }
const viewer = { appuserKey: 4, emailAddress: 'viewer@example.com', firstName: 'Vi', role: 'viewer' as const }

const household = (overrides: Partial<HouseholdResponseDto> = {}): HouseholdResponseDto => ({
  members: [owner, admin, member, viewer],
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: null,
  ...overrides,
})

describe('computeHouseholdViewModel', () => {
  it('finds "me" by the key the API names, ahead of the email', () => {
    const vm = computeHouseholdViewModel(household({ viewerAppuserKey: 2 }), 'owner@example.com')
    expect(vm.me).toEqual(admin)
    expect(vm.myRole).toBe('admin')
    expect(vm.members.filter((row) => row.isMe).map((row) => row.appuserKey)).toEqual([2])
  })

  it('falls back to the viewer email, case-insensitively and trimmed, from an older API', () => {
    const vm = computeHouseholdViewModel(household(), '  OWNER@Example.com  ')
    expect(vm.me).toEqual(owner)
    expect(vm.isOwner).toBe(true)
  })

  it('reports no "me" and no actions when the viewer is not in the household', () => {
    const vm = computeHouseholdViewModel(household(), 'stranger@example.com')
    expect(vm.me).toBeNull()
    expect(vm.canInvite).toBe(false)
    expect(vm.canLeave).toBe(false)
    expect(vm.members.every((row) => !row.actions.remove && row.actions.changeRoleTo.length === 0)).toBe(true)
  })

  it('gives the owner every action on others, the admin roles and an invite picker', () => {
    const vm = computeHouseholdViewModel(household({ viewerAppuserKey: 1 }), null)
    expect(vm.inviteRoles).toEqual(['admin', 'member', 'viewer'])
    expect(vm.canLeave).toBe(false)
    const actions = Object.fromEntries(vm.members.map((row) => [row.appuserKey, row.actions]))
    expect(actions[1]?.remove).toBe(false)
    expect(actions[2]).toMatchObject({ remove: true, transferOwnership: true })
    expect(actions[4]?.changeRoleTo).toEqual(['admin', 'member'])
  })

  it('lets an admin invite members and viewers and act only on those', () => {
    const vm = computeHouseholdViewModel(household({ viewerAppuserKey: 2 }), null)
    expect(vm.inviteRoles).toEqual(['member', 'viewer'])
    expect(vm.canLeave).toBe(true)
    const removable = vm.members.filter((row) => row.actions.remove).map((row) => row.appuserKey)
    expect(removable).toEqual([3, 4])
    expect(vm.members.some((row) => row.actions.transferOwnership)).toBe(false)
  })

  it.each([3, 4])('gives a member or viewer (%s) nothing to manage but leaving', (key) => {
    const vm = computeHouseholdViewModel(household({ viewerAppuserKey: key }), null)
    expect(vm.canInvite).toBe(false)
    expect(vm.inviteRoles).toEqual([])
    expect(vm.canLeave).toBe(true)
    expect(vm.members.every((row) => !row.actions.remove && !row.actions.transferOwnership)).toBe(true)
  })

  it('counts pending invites against the cap', () => {
    const invite = { email: 'x@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 9, role: 'member' as const }
    const open = computeHouseholdViewModel(household({ viewerAppuserKey: 1, pendingInvites: [invite] }), null)
    expect(open.canInvite).toBe(true)
    const full = computeHouseholdViewModel(household({ viewerAppuserKey: 1, pendingInvites: [invite, { ...invite, householdInviteKey: 10 }] }), null)
    expect(full.canInvite).toBe(false)
    expect(full.inviteRoles).toEqual([])
  })

  it('marks which pending invites the viewer can act on', () => {
    const invites = [
      { email: 'a@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 9, role: 'admin' as const },
      { email: 'b@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 10, role: 'viewer' as const },
    ]
    const byAdmin = computeHouseholdViewModel(household({ viewerAppuserKey: 2, pendingInvites: invites }), null)
    expect(byAdmin.pendingInvites.map((invite) => invite.canManage)).toEqual([false, true])
    const byMember = computeHouseholdViewModel(household({ viewerAppuserKey: 3, pendingInvites: invites }), null)
    expect(byMember.pendingInvites.map((invite) => invite.canManage)).toEqual([false, false])
  })
})

describe('household member labels', () => {
  it('prefers a trimmed first name, else the email', () => {
    expect(householdMemberLabel({ firstName: '  Ana ', emailAddress: 'a@example.com' })).toBe('Ana')
    expect(householdMemberLabel({ firstName: null, emailAddress: 'a@example.com' })).toBe('a@example.com')
    expect(householdMemberLabel({ firstName: '   ', emailAddress: 'a@example.com' })).toBe('a@example.com')
  })

  it('uses the first letter of the name or email as initials', () => {
    expect(householdMemberInitials({ firstName: 'ana', emailAddress: 'z@example.com' })).toBe('A')
    expect(householdMemberInitials({ firstName: null, emailAddress: 'zoe@example.com' })).toBe('Z')
  })
})
