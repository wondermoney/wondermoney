import { computeHouseholdViewModel, householdMemberInitials, householdMemberLabel } from './household-view-models'
import type { HouseholdResponseDto } from './household-contract'

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Owner', role: 'owner' as const }
const member = { appuserKey: 2, emailAddress: 'partner@example.com', firstName: null, role: 'member' as const }

describe('computeHouseholdViewModel', () => {
  it('identifies the viewer as owner, and the other member as partner', () => {
    const household: HouseholdResponseDto = { members: [owner, member], pendingInvite: null }
    const vm = computeHouseholdViewModel(household, 'owner@example.com')
    expect(vm.me).toEqual(owner)
    expect(vm.isOwner).toBe(true)
    expect(vm.partner).toEqual(member)
  })

  it('identifies the viewer as member (not owner) when they are the partner', () => {
    const household: HouseholdResponseDto = { members: [owner, member], pendingInvite: null }
    const vm = computeHouseholdViewModel(household, 'partner@example.com')
    expect(vm.me).toEqual(member)
    expect(vm.isOwner).toBe(false)
  })

  it('matches the viewer email case-insensitively and trims whitespace', () => {
    const household: HouseholdResponseDto = { members: [owner], pendingInvite: null }
    const vm = computeHouseholdViewModel(household, '  OWNER@Example.com  ')
    expect(vm.me).toEqual(owner)
  })

  it('reports null me when the viewer is not a member of the household', () => {
    const household: HouseholdResponseDto = { members: [owner], pendingInvite: null }
    const vm = computeHouseholdViewModel(household, 'stranger@example.com')
    expect(vm.me).toBeNull()
    expect(vm.isOwner).toBe(false)
  })

  it('allows the owner to invite with one seat free and no pending invite', () => {
    const household: HouseholdResponseDto = { members: [owner], pendingInvite: null }
    expect(computeHouseholdViewModel(household, 'owner@example.com').canInvite).toBe(true)
  })

  it('blocks inviting once the household has two members', () => {
    const household: HouseholdResponseDto = { members: [owner, member], pendingInvite: null }
    expect(computeHouseholdViewModel(household, 'owner@example.com').canInvite).toBe(false)
  })

  it('blocks inviting while an invite is already pending', () => {
    const household: HouseholdResponseDto = {
      members: [owner],
      pendingInvite: { email: 'x@y.co', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 1 },
    }
    expect(computeHouseholdViewModel(household, 'owner@example.com').canInvite).toBe(false)
  })

  it('blocks a non-owner member from inviting', () => {
    const household: HouseholdResponseDto = { members: [owner, member], pendingInvite: null }
    expect(computeHouseholdViewModel(household, 'partner@example.com').canInvite).toBe(false)
  })
})

describe('householdMemberLabel', () => {
  it('prefers the first name, falling back to the email address', () => {
    expect(householdMemberLabel(owner)).toBe('Owner')
    expect(householdMemberLabel(member)).toBe('partner@example.com')
  })
})

describe('householdMemberInitials', () => {
  it('uppercases the first letter of the name, falling back to the email', () => {
    expect(householdMemberInitials(owner)).toBe('O')
    expect(householdMemberInitials(member)).toBe('P')
  })
})
