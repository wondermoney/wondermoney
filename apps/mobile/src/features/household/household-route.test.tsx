import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { HouseholdRoute } from './household-route'

const mockBack = jest.fn()
const mockReplace = jest.fn()
const mockCanGoBack = jest.fn(() => true)
const mockUseHousehold = jest.fn()
const mockUseProfile = jest.fn()
const mockInvite = { isPending: false, mutateAsync: jest.fn() }
const mockResend = { isPending: false, mutateAsync: jest.fn() }
const mockRevoke = { isPending: false, mutateAsync: jest.fn() }
const mockRemove = { isPending: false, mutateAsync: jest.fn(), variables: undefined }
const mockChangeRole = { isPending: false, mutateAsync: jest.fn() }
const mockTransfer = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, canGoBack: mockCanGoBack, replace: mockReplace }) }))
jest.mock('./use-household', () => ({ useHousehold: () => mockUseHousehold() }))
jest.mock('@/features/self/use-self-resource', () => ({ useProfile: () => mockUseProfile() }))
jest.mock('./use-invite-household-member', () => ({ useInviteHouseholdMember: () => mockInvite }))
jest.mock('./use-household-invite-actions', () => ({ useHouseholdInviteActions: () => ({ resend: mockResend, revoke: mockRevoke }) }))
jest.mock('./use-remove-household-member', () => ({ useRemoveHouseholdMember: () => mockRemove }))
jest.mock('./use-household-member-role', () => ({ useHouseholdMemberRole: () => ({ changeRole: mockChangeRole, transferOwnership: mockTransfer }) }))
type HouseholdScreenTestProps = {
  state: { status: string; data?: { me: { appuserKey: number } | null } }
  onBack: () => void
  onInvite: (email: string, role: string) => Promise<void>
  onResendInvite: (key: number) => Promise<void>
  onRevokeInvite: (key: number) => Promise<void>
  onChangeRole: (appuserKey: number, role: string) => Promise<void>
  onTransferOwnership: (appuserKey: number) => Promise<void>
  onRemoveMember: (appuserKey: number) => Promise<void>
  onLeave: () => Promise<void>
}

jest.mock('./household-screen', () => ({
  HouseholdScreen: (props: HouseholdScreenTestProps) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{props.state.status}</Native.Text>
      <Native.Text>{`me:${props.state.data?.me?.appuserKey ?? 'none'}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="back route" onPress={props.onBack} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="invite route" onPress={() => void props.onInvite('new@example.com', 'viewer')} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="resend route" onPress={() => void props.onResendInvite(5)} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="revoke route" onPress={() => void props.onRevokeInvite(5)} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="role route" onPress={() => void props.onChangeRole(2, 'viewer')} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="transfer route" onPress={() => void props.onTransferOwnership(2)} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="remove route" onPress={() => void props.onRemoveMember(2)} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="leave route" onPress={() => void props.onLeave()} />
    </>
  },
}))

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Owner', role: 'owner' as const }
const partnerMember = { appuserKey: 2, emailAddress: 'partner@example.com', firstName: 'Partner', role: 'member' as const }

describe('HouseholdRoute', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockReplace.mockReset()
    mockCanGoBack.mockReset().mockReturnValue(true)
    mockInvite.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockResend.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockRevoke.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockRemove.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockChangeRole.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockTransfer.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseProfile.mockReset().mockReturnValue({
      data: { profile: { emailAddress: 'owner@example.com' } },
      isLoading: false,
      isAccessTransition: false,
      error: null,
      refetch: jest.fn(),
    })
    mockUseHousehold.mockReset().mockReturnValue({
      data: { members: [owner, partnerMember], maxMembers: 6, pendingInvites: [], viewerAppuserKey: null },
      isLoading: false,
      isAccessTransition: false,
      isRefreshFailure: false,
      error: null,
      refetch: jest.fn(),
    })
  })

  it('derives a loaded state from the household resource and the viewer profile', async () => {
    const view = await render(<HouseholdRoute />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
  })

  it('goes back within the stack when possible', async () => {
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'back route' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('replaces to /more when there is nothing to go back to', async () => {
    mockCanGoBack.mockReturnValue(false)
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'back route' }))
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })

  it('invites through the exact mutation', async () => {
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'invite route' }))
    expect(mockInvite.mutateAsync).toHaveBeenCalledWith({ email: 'new@example.com', role: 'viewer' })
  })

  it('resends and revokes an invite by its key', async () => {
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'resend route' }))
    expect(mockResend.mutateAsync).toHaveBeenCalledWith(5)
    await fireEvent.press(view.getByRole('button', { name: 'revoke route' }))
    expect(mockRevoke.mutateAsync).toHaveBeenCalledWith(5)
  })

  it('changes a role and transfers ownership through their mutations', async () => {
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'role route' }))
    expect(mockChangeRole.mutateAsync).toHaveBeenCalledWith({ appuserKey: 2, role: 'viewer' })
    await fireEvent.press(view.getByRole('button', { name: 'transfer route' }))
    expect(mockTransfer.mutateAsync).toHaveBeenCalledWith(2)
  })

  it('removes another member without leaving', async () => {
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'remove route' }))
    expect(mockRemove.mutateAsync).toHaveBeenCalledWith({ appuserKey: 2, leaving: false })
  })

  it('leaves as the viewer, found by email from an older API', async () => {
    mockUseProfile.mockReturnValue({
      data: { profile: { emailAddress: 'partner@example.com' } },
      isLoading: false,
      isAccessTransition: false,
      error: null,
      refetch: jest.fn(),
    })
    const view = await render(<HouseholdRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'leave route' }))
    expect(mockRemove.mutateAsync).toHaveBeenCalledWith({ appuserKey: 2, leaving: true })
  })

  it('finds the viewer by the key the API names, without waiting for the profile', async () => {
    mockUseProfile.mockReturnValue({ data: undefined, isLoading: true, isAccessTransition: false, error: null, refetch: jest.fn() })
    mockUseHousehold.mockReturnValue({
      data: { members: [owner, partnerMember], maxMembers: 6, pendingInvites: [], viewerAppuserKey: 2 },
      isLoading: false,
      isAccessTransition: false,
      isRefreshFailure: false,
      error: null,
      refetch: jest.fn(),
    })
    const view = await render(<HouseholdRoute />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(view.getByText('me:2')).toBeOnTheScreen()
  })

  it.each([
    ['loading (household)', { household: { isLoading: true } }],
    ['loading (profile)', { profile: { isLoading: true } }],
    ['access-transition (household)', { household: { isAccessTransition: true } }],
    ['access-transition (profile)', { profile: { isAccessTransition: true } }],
  ])('maps %s distinctly', async (_label, overrides: { household?: Record<string, unknown>; profile?: Record<string, unknown> }) => {
    if (overrides.household) mockUseHousehold.mockReturnValue({ data: undefined, error: null, refetch: jest.fn(), isLoading: false, isAccessTransition: false, isRefreshFailure: false, ...overrides.household })
    if (overrides.profile) mockUseProfile.mockReturnValue({ data: undefined, error: null, refetch: jest.fn(), isLoading: false, isAccessTransition: false, ...overrides.profile })
    const view = await render(<HouseholdRoute />)
    const expected = overrides.household?.isAccessTransition || overrides.profile?.isAccessTransition ? 'access-transition' : 'loading'
    expect(view.getByText(expected)).toBeOnTheScreen()
  })

  it('maps an invalid-response household error distinctly', async () => {
    mockUseHousehold.mockReturnValue({ data: undefined, isLoading: false, isAccessTransition: false, isRefreshFailure: false, error: new ApiError('invalid-response'), refetch: jest.fn() })
    const view = await render(<HouseholdRoute />)
    expect(view.getByText('invalid-response')).toBeOnTheScreen()
  })

  it('falls back to a general error state', async () => {
    mockUseHousehold.mockReturnValue({ data: undefined, isLoading: false, isAccessTransition: false, isRefreshFailure: false, error: new ApiError('network'), refetch: jest.fn() })
    const view = await render(<HouseholdRoute />)
    expect(view.getByText('error')).toBeOnTheScreen()
  })

  it('keeps a stale-tagged loaded state after a refresh failure', async () => {
    mockUseHousehold.mockReturnValue({
      data: { members: [owner, partnerMember], maxMembers: 6, pendingInvites: [], viewerAppuserKey: null },
      isLoading: false,
      isAccessTransition: false,
      isRefreshFailure: true,
      error: null,
      refetch: jest.fn(),
    })
    const view = await render(<HouseholdRoute />)
    expect(view.getByText('refresh-error')).toBeOnTheScreen()
  })
})
