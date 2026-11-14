import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import type { HouseholdInvite, HouseholdMemberDto, HouseholdResponseDto } from './household-contract'
import { HouseholdScreen } from './household-screen'
import { computeHouseholdViewModel, type HouseholdViewModel } from './household-view-models'

const owner: HouseholdMemberDto = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Alex', role: 'owner' }
const admin: HouseholdMemberDto = { appuserKey: 2, emailAddress: 'admin@example.com', firstName: 'Ada', role: 'admin' }
const member: HouseholdMemberDto = { appuserKey: 3, emailAddress: 'member@example.com', firstName: 'Mo', role: 'member' }
const viewer: HouseholdMemberDto = { appuserKey: 4, emailAddress: 'viewer@example.com', firstName: 'Vi', role: 'viewer' }
const invite: HouseholdInvite = { email: 'invitee@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5, role: 'viewer' }

const viewAs = (appuserKey: number, overrides: Partial<HouseholdResponseDto> = {}): HouseholdViewModel => computeHouseholdViewModel({
  members: [owner, admin, member, viewer],
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: appuserKey,
  ...overrides,
}, null)

const renderScreen = async (overrides: Partial<React.ComponentProps<typeof HouseholdScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof HouseholdScreen> = {
    state: { status: 'loaded', data: viewAs(1) },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onInvite: jest.fn().mockResolvedValue(undefined),
    invitePending: false,
    onResendInvite: jest.fn().mockResolvedValue(undefined),
    resendPending: false,
    onRevokeInvite: jest.fn().mockResolvedValue(undefined),
    revokePending: false,
    onChangeRole: jest.fn().mockResolvedValue(undefined),
    changeRolePending: false,
    onTransferOwnership: jest.fn().mockResolvedValue(undefined),
    transferPending: false,
    onRemoveMember: jest.fn().mockResolvedValue(undefined),
    removePending: false,
    onLeave: jest.fn().mockResolvedValue(undefined),
    leavePending: false,
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <HouseholdScreen {...props} />
    </I18nextProvider>,
  )
  return { view, props, t: i18n.t.bind(i18n) }
}

const acceptAlerts = () => jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
const cancelAlerts = () => jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })

describe('HouseholdScreen', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders a loading state', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loading' } })
    expect(view.getByLabelText(t('household.loading'))).toBeOnTheScreen()
  })

  it('renders an error state with retry', async () => {
    const onRetry = jest.fn()
    const { view, t } = await renderScreen({ state: { status: 'error' }, onRetry })
    expect(view.getByText(t('household.states.errorTitle'))).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: t('common.retry') }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders an invalid-response state distinctly', async () => {
    const { view, t } = await renderScreen({ state: { status: 'invalid-response' } })
    expect(view.getByText(t('household.states.invalid-responseTitle'))).toBeOnTheScreen()
  })

  it('renders nothing during an access transition', async () => {
    const { view } = await renderScreen({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('lists every member with a role badge and marks the viewer as "you"', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(2) } })
    for (const [key, role] of [[1, 'roleOwner'], [2, 'roleAdmin'], [3, 'roleMember'], [4, 'roleViewer']] as const) {
      expect(within(view.getByTestId(`household-member-${key}`)).getByLabelText(t(`household.members.${role}`))).toBeOnTheScreen()
    }
    expect(within(view.getByTestId('household-member-2')).getByLabelText(t('household.members.you'))).toBeOnTheScreen()
    expect(within(view.getByTestId('household-member-1')).queryByLabelText(t('household.members.you'))).not.toBeOnTheScreen()
  })

  it('offers member actions only where the role rule allows them', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(2) } })
    const menuFor = (name: string) => view.queryByRole('button', { name: t('household.actions.menuFor', { name }) })
    // An admin acts on members and viewers, never on the owner, another admin or themselves.
    expect(menuFor('Alex')).not.toBeOnTheScreen()
    expect(menuFor('Ada')).not.toBeOnTheScreen()
    expect(menuFor('Mo')).toBeOnTheScreen()
    expect(menuFor('Vi')).toBeOnTheScreen()
  })

  it('shows no member actions, invite form or invite actions to a viewer, only leave', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(4, { pendingInvites: [invite] }) } })
    expect(view.queryByRole('button', { name: /^Actions for/ })).not.toBeOnTheScreen()
    expect(view.queryByLabelText(t('household.invite.emailLabel'))).not.toBeOnTheScreen()
    // Pending invites are visible to everyone; only managers act on them.
    expect(view.getByText(t('household.pending.sentTo', { email: invite.email }))).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: t('household.pending.resendFor', { email: invite.email }) })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: t('household.actions.leave') })).toBeOnTheScreen()
  })

  it('changes a member role through the role sheet', async () => {
    const onChangeRole = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onChangeRole })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Mo' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.changeRole') }))
    // The owner can move a member to admin or viewer; owner is never offered.
    expect(view.queryByRole('radio', { name: t('household.members.roleOwner') })).not.toBeOnTheScreen()
    expect(view.getByRole('radio', { name: t('household.members.roleMember') })).toBeChecked()
    await fireEvent.press(view.getByRole('radio', { name: t('household.members.roleAdmin') }))
    await waitFor(() => expect(onChangeRole).toHaveBeenCalledWith(3, 'admin'))
  })

  it('does not write when the current role is picked again', async () => {
    const onChangeRole = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onChangeRole })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Mo' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.changeRole') }))
    await fireEvent.press(view.getByRole('radio', { name: t('household.members.roleMember') }))
    expect(onChangeRole).not.toHaveBeenCalled()
  })

  it('shows why a role change was refused', async () => {
    const onChangeRole = jest.fn().mockRejectedValue(new ApiError('http', 403, { serverCode: 'household_role_required' }))
    const { view, t } = await renderScreen({ onChangeRole })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Vi' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.changeRole') }))
    await fireEvent.press(view.getByRole('radio', { name: t('household.members.roleMember') }))
    expect(await view.findByRole('alert')).toHaveTextContent(t('household.memberFailures.role-required'))
  })

  it('transfers ownership only from the owner, after a confirmation naming the member', async () => {
    const onTransferOwnership = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onTransferOwnership })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Ada' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.transferOwnership') }))
    expect(view.getByText(t('household.transferDialog.title', { name: 'Ada' }))).toBeOnTheScreen()
    expect(onTransferOwnership).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: t('household.transferDialog.confirm') }))
    await waitFor(() => expect(onTransferOwnership).toHaveBeenCalledWith(2))
  })

  it('does not transfer when the confirmation is cancelled', async () => {
    const onTransferOwnership = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onTransferOwnership })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Ada' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.transferOwnership') }))
    const cancels = view.getAllByRole('button', { name: t('common.cancel') })
    await fireEvent.press(cancels[cancels.length - 1]!)
    expect(onTransferOwnership).not.toHaveBeenCalled()
  })

  it('never offers an admin the transfer', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(2) } })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Mo' }) }))
    expect(view.queryByRole('menuitem', { name: t('household.actions.transferOwnership') })).not.toBeOnTheScreen()
    expect(view.getByRole('menuitem', { name: t('household.actions.remove') })).toBeOnTheScreen()
  })

  it('removes a member only after explicit confirmation', async () => {
    const onRemoveMember = jest.fn().mockResolvedValue(undefined)
    acceptAlerts()
    const { view, t } = await renderScreen({ onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Vi' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.remove') }))
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledWith(4))
  })

  it('does not remove when the confirmation is cancelled', async () => {
    const onRemoveMember = jest.fn().mockResolvedValue(undefined)
    cancelAlerts()
    const { view, t } = await renderScreen({ onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Vi' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.remove') }))
    expect(onRemoveMember).not.toHaveBeenCalled()
  })

  it('surfaces a scoped failure when removal fails', async () => {
    const onRemoveMember = jest.fn().mockRejectedValue(new ApiError('http', 404))
    acceptAlerts()
    const { view, t } = await renderScreen({ onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.menuFor', { name: 'Vi' }) }))
    await fireEvent.press(view.getByRole('menuitem', { name: t('household.actions.remove') }))
    expect(await view.findByRole('alert')).toHaveTextContent(t('household.memberFailures.not-found'))
  })

  it('lets a non-owner leave after confirmation, and never the owner', async () => {
    const onLeave = jest.fn().mockResolvedValue(undefined)
    acceptAlerts()
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(3) }, onLeave })
    await fireEvent.press(view.getByRole('button', { name: t('household.actions.leave') }))
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1))
    const asOwner = await renderScreen()
    expect(asOwner.view.queryByRole('button', { name: t('household.actions.leave') })).not.toBeOnTheScreen()
  })

  it('invites with the member role by default', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText(t('household.invite.emailLabel')), '  New@Example.com  ')
    await fireEvent.press(view.getByRole('button', { name: t('household.invite.submit') }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('new@example.com', 'member'))
    await waitFor(() => expect(view.getByLabelText(t('household.invite.emailLabel')).props.value).toBe(''))
  })

  it('offers the owner admin, member and viewer in the role picker and sends the choice', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onInvite })
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${t('household.invite.roleLabel')}`) }))
    expect(view.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel)).toEqual([
      t('household.members.roleAdmin'), t('household.members.roleMember'), t('household.members.roleViewer'),
    ])
    await fireEvent.press(view.getByRole('radio', { name: t('household.members.roleViewer') }))
    await fireEvent.changeText(view.getByLabelText(t('household.invite.emailLabel')), 'new@example.com')
    await fireEvent.press(view.getByRole('button', { name: t('household.invite.submit') }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('new@example.com', 'viewer'))
  })

  it('offers an admin only member and viewer in the role picker', async () => {
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(2) } })
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${t('household.invite.roleLabel')}`) }))
    expect(view.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel)).toEqual([
      t('household.members.roleMember'), t('household.members.roleViewer'),
    ])
  })

  it('validates the email locally before calling onInvite', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText(t('household.invite.emailLabel')), 'not-an-email')
    await fireEvent.press(view.getByRole('button', { name: t('household.invite.submit') }))
    await waitFor(() => expect(view.getByText(t('household.invite.invalidEmail'))).toBeOnTheScreen())
    expect(onInvite).not.toHaveBeenCalled()
  })

  it('surfaces a full household on invite, without clearing the field', async () => {
    const onInvite = jest.fn().mockRejectedValue(new ApiError('http', 409, { serverCode: 'household_full' }))
    const { view, t } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText(t('household.invite.emailLabel')), 'new@example.com')
    await fireEvent.press(view.getByRole('button', { name: t('household.invite.submit') }))
    expect(await view.findByRole('alert')).toHaveTextContent(t('household.inviteFailures.full'))
    expect(view.getByLabelText(t('household.invite.emailLabel')).props.value).toBe('new@example.com')
  })

  it('hides the invite form once members and pending invites fill the household', async () => {
    const data = viewAs(1, { maxMembers: 5, pendingInvites: [invite] })
    const { view, t } = await renderScreen({ state: { status: 'loaded', data } })
    expect(view.queryByLabelText(t('household.invite.emailLabel'))).not.toBeOnTheScreen()
    expect(view.getByText(t('household.invite.full', { max: 5 }))).toBeOnTheScreen()
  })

  it('lists every pending invite with its role and lets a manager resend or revoke each', async () => {
    const second: HouseholdInvite = { ...invite, email: 'second@example.com', householdInviteKey: 6, role: 'admin' }
    const onResendInvite = jest.fn().mockResolvedValue(undefined)
    const onRevokeInvite = jest.fn().mockResolvedValue(undefined)
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(1, { pendingInvites: [invite, second] }) }, onResendInvite, onRevokeInvite })
    expect(within(view.getByTestId('household-invite-6')).getByLabelText(t('household.members.roleAdmin'))).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: t('household.pending.resendFor', { email: 'second@example.com' }) }))
    await waitFor(() => expect(onResendInvite).toHaveBeenCalledWith(6))
    await fireEvent.press(view.getByRole('button', { name: t('household.pending.revokeFor', { email: invite.email }) }))
    await waitFor(() => expect(onRevokeInvite).toHaveBeenCalledWith(5))
  })

  it('lets an admin act on a viewer invite but not an admin invite', async () => {
    const adminInvite: HouseholdInvite = { ...invite, email: 'boss@example.com', householdInviteKey: 6, role: 'admin' }
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(2, { pendingInvites: [invite, adminInvite] }) } })
    expect(view.getByRole('button', { name: t('household.pending.revokeFor', { email: invite.email }) })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: t('household.pending.revokeFor', { email: 'boss@example.com' }) })).not.toBeOnTheScreen()
  })

  it('shows a view-only refusal in its own words', async () => {
    const onRevokeInvite = jest.fn().mockRejectedValue(new ApiError('household-read-only', 403))
    const { view, t } = await renderScreen({ state: { status: 'loaded', data: viewAs(1, { pendingInvites: [invite] }) }, onRevokeInvite })
    await fireEvent.press(view.getByRole('button', { name: t('household.pending.revokeFor', { email: invite.email }) }))
    expect(await view.findByRole('alert')).toHaveTextContent(t('household.inviteFailures.read-only'))
  })

  it('shows the stale banner during a refresh error, keeping data usable', async () => {
    const { view, t } = await renderScreen({ state: { status: 'refresh-error', data: viewAs(1) } })
    expect(view.getByRole('alert')).toHaveTextContent(t('household.stale'))
    expect(view.getByLabelText(t('household.invite.emailLabel'))).toBeOnTheScreen()
  })
})
