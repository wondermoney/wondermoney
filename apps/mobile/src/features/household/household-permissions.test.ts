import type { HouseholdRoleValue } from './household-contract'
import {
  canInviteToHousehold,
  canLeaveHousehold,
  canManageInvite,
  grantableRoles,
  householdMemberActions,
  isHouseholdManager,
} from './household-permissions'

const party = (appuserKey: number, role: HouseholdRoleValue) => ({ appuserKey, role })

describe('household permissions', () => {
  it('treats only the owner and admins as managers', () => {
    expect(isHouseholdManager('owner')).toBe(true)
    expect(isHouseholdManager('admin')).toBe(true)
    expect(isHouseholdManager('member')).toBe(false)
    expect(isHouseholdManager('viewer')).toBe(false)
    expect(isHouseholdManager('unknown')).toBe(false)
    expect(isHouseholdManager(null)).toBe(false)
  })

  it('lets a manager grant only roles strictly below their own, and never owner', () => {
    expect(grantableRoles('owner')).toEqual(['admin', 'member', 'viewer'])
    expect(grantableRoles('admin')).toEqual(['member', 'viewer'])
    expect(grantableRoles('member')).toEqual([])
    expect(grantableRoles('viewer')).toEqual([])
    expect(grantableRoles('unknown')).toEqual([])
  })

  it('lets the owner change, remove and hand ownership to anyone else', () => {
    const owner = party(1, 'owner')
    expect(householdMemberActions(owner, party(2, 'admin'))).toEqual({ changeRoleTo: ['member', 'viewer'], remove: true, transferOwnership: true })
    expect(householdMemberActions(owner, party(3, 'viewer'))).toEqual({ changeRoleTo: ['admin', 'member'], remove: true, transferOwnership: true })
  })

  it('lets an admin act only on members and viewers, and never transfer', () => {
    const admin = party(2, 'admin')
    expect(householdMemberActions(admin, party(3, 'member'))).toEqual({ changeRoleTo: ['viewer'], remove: true, transferOwnership: false })
    expect(householdMemberActions(admin, party(4, 'viewer'))).toEqual({ changeRoleTo: ['member'], remove: true, transferOwnership: false })
    expect(householdMemberActions(admin, party(5, 'admin'))).toEqual({ changeRoleTo: [], remove: false, transferOwnership: false })
    expect(householdMemberActions(admin, party(1, 'owner'))).toEqual({ changeRoleTo: [], remove: false, transferOwnership: false })
  })

  it('never offers an action on yourself, or to members and viewers', () => {
    const none = { changeRoleTo: [], remove: false, transferOwnership: false }
    expect(householdMemberActions(party(1, 'owner'), party(1, 'owner'))).toEqual(none)
    expect(householdMemberActions(party(2, 'admin'), party(2, 'admin'))).toEqual(none)
    expect(householdMemberActions(party(3, 'member'), party(4, 'viewer'))).toEqual(none)
    expect(householdMemberActions(party(4, 'viewer'), party(3, 'member'))).toEqual(none)
    expect(householdMemberActions(null, party(3, 'member'))).toEqual(none)
  })

  it('leaves a role this build does not know alone', () => {
    expect(householdMemberActions(party(1, 'owner'), party(9, 'unknown'))).toEqual({ changeRoleTo: [], remove: false, transferOwnership: false })
    expect(householdMemberActions(party(9, 'unknown'), party(3, 'viewer')).remove).toBe(false)
  })

  it('lets everyone but the owner leave', () => {
    expect(canLeaveHousehold('owner')).toBe(false)
    expect(canLeaveHousehold('admin')).toBe(true)
    expect(canLeaveHousehold('member')).toBe(true)
    expect(canLeaveHousehold('viewer')).toBe(true)
    expect(canLeaveHousehold(null)).toBe(false)
  })

  it('lets managers invite while members plus pending invites are under the cap', () => {
    expect(canInviteToHousehold('owner', 1, 0, 6)).toBe(true)
    expect(canInviteToHousehold('admin', 3, 2, 6)).toBe(true)
    expect(canInviteToHousehold('admin', 4, 2, 6)).toBe(false)
    expect(canInviteToHousehold('member', 1, 0, 6)).toBe(false)
    expect(canInviteToHousehold('viewer', 1, 0, 6)).toBe(false)
  })

  it('lets a manager act on an invite only for a role below their own', () => {
    expect(canManageInvite('owner', 'admin')).toBe(true)
    expect(canManageInvite('admin', 'member')).toBe(true)
    expect(canManageInvite('admin', 'viewer')).toBe(true)
    expect(canManageInvite('admin', 'admin')).toBe(false)
    expect(canManageInvite('member', 'viewer')).toBe(false)
    expect(canManageInvite('owner', 'unknown')).toBe(true)
    expect(canManageInvite('admin', 'unknown')).toBe(false)
  })
})
