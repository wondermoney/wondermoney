import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { HouseholdScreen } from './household-screen'
import type { HouseholdViewModel } from './household-view-models'

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Alex', role: 'owner' as const }
const partnerMember = { appuserKey: 2, emailAddress: 'partner@example.com', firstName: 'Partner', role: 'member' as const }

const ownerViewingSolo: HouseholdViewModel = {
  members: [owner],
  pendingInvite: null,
  me: owner,
  isOwner: true,
  partner: null,
  canInvite: true,
}

const ownerWithPartner: HouseholdViewModel = {
  members: [owner, partnerMember],
  pendingInvite: null,
  me: owner,
  isOwner: true,
  partner: partnerMember,
  canInvite: false,
}

const memberViewing: HouseholdViewModel = {
  members: [owner, partnerMember],
  pendingInvite: null,
  me: partnerMember,
  isOwner: false,
  partner: partnerMember,
  canInvite: false,
}

const renderScreen = async (overrides: Partial<React.ComponentProps<typeof HouseholdScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof HouseholdScreen> = {
    state: { status: 'loaded', data: ownerViewingSolo },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onInvite: jest.fn().mockResolvedValue(undefined),
    invitePending: false,
    onResendInvite: jest.fn().mockResolvedValue(undefined),
    resendPending: false,
    onRevokeInvite: jest.fn().mockResolvedValue(undefined),
    revokePending: false,
    onRemoveMember: jest.fn().mockResolvedValue(undefined),
    removePending: false,
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <HouseholdScreen {...props} />
    </I18nextProvider>,
  )
  return { view, props }
}

describe('HouseholdScreen', () => {
  it('renders a loading state', async () => {
    const { view } = await renderScreen({ state: { status: 'loading' } })
    expect(view.getByLabelText('Loading your household…')).toBeOnTheScreen()
  })

  it('renders an error state with retry', async () => {
    const onRetry = jest.fn()
    const { view } = await renderScreen({ state: { status: 'error' }, onRetry })
    expect(view.getByText('Could not load your household')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders an invalid-response state distinctly', async () => {
    const { view } = await renderScreen({ state: { status: 'invalid-response' } })
    expect(view.getByText('Could not verify household data')).toBeOnTheScreen()
  })

  it('renders nothing during an access transition', async () => {
    const { view } = await renderScreen({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('lists members with role badges and marks the viewer as "you"', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner } })
    expect(view.getByText('Owner')).toBeOnTheScreen()
    expect(view.getByText('partner@example.com')).toBeOnTheScreen()
    expect(view.getByLabelText('You')).toBeOnTheScreen()
  })

  it('shows a remove button for the partner when the viewer is the owner', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner } })
    expect(view.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  })

  it('does not show a remove button when the viewer is a member', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: memberViewing } })
    expect(view.queryByRole('button', { name: 'Remove' })).not.toBeOnTheScreen()
  })

  it('removes the partner only after explicit confirmation', async () => {
    const onRemoveMember = jest.fn().mockResolvedValue(undefined)
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner }, onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledTimes(1))
  })

  it('does not remove when the confirmation is cancelled', async () => {
    const onRemoveMember = jest.fn().mockResolvedValue(undefined)
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner }, onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: 'Remove' }))
    expect(onRemoveMember).not.toHaveBeenCalled()
  })

  it('shows a leave button only for a non-owner member, gated by confirmation', async () => {
    const onRemoveMember = jest.fn().mockResolvedValue(undefined)
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderScreen({ state: { status: 'loaded', data: memberViewing }, onRemoveMember })
    expect(view.queryByRole('button', { name: 'Leave household' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Leave household' }))
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledTimes(1))
  })

  it('does not show a leave button for the owner', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner } })
    expect(view.queryByRole('button', { name: 'Leave household' })).not.toBeOnTheScreen()
  })

  it('surfaces a scoped failure when removal fails', async () => {
    const onRemoveMember = jest.fn().mockRejectedValue(new ApiError('http', 404))
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner }, onRemoveMember })
    await fireEvent.press(view.getByRole('button', { name: 'Remove' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/no longer part of the household/i)
  })

  it('shows the invite form only when canInvite is true', async () => {
    const { view } = await renderScreen({ state: { status: 'loaded', data: ownerViewingSolo } })
    expect(view.getByLabelText('Email')).toBeOnTheScreen()
    const notInvitable = await renderScreen({ state: { status: 'loaded', data: ownerWithPartner } })
    expect(notInvitable.view.queryByLabelText('Email')).not.toBeOnTheScreen()
  })

  it('validates the email locally before calling onInvite', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText('Email'), 'not-an-email')
    await fireEvent.press(view.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(view.getByText('Enter a valid email address')).toBeOnTheScreen())
    expect(onInvite).not.toHaveBeenCalled()
  })

  it('submits a valid, normalized invite email and clears the field on success', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText('Email'), '  Partner@Example.com  ')
    await fireEvent.press(view.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('partner@example.com'))
    await waitFor(() => expect(view.getByLabelText('Email').props.value).toBe(''))
  })

  it('surfaces a scoped failure when invite fails, without clearing the field', async () => {
    const onInvite = jest.fn().mockRejectedValue(new ApiError('http', 409))
    const { view } = await renderScreen({ onInvite })
    await fireEvent.changeText(view.getByLabelText('Email'), 'partner@example.com')
    await fireEvent.press(view.getByRole('button', { name: 'Send invite' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/household is full/i)
    expect(view.getByLabelText('Email').props.value).toBe('partner@example.com')
  })

  it('shows the pending invite with resend/revoke actions for the owner', async () => {
    const data: HouseholdViewModel = {
      ...ownerViewingSolo,
      pendingInvite: { email: 'invitee@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5 },
      canInvite: false,
    }
    const onResendInvite = jest.fn().mockResolvedValue(undefined)
    const onRevokeInvite = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ state: { status: 'loaded', data }, onResendInvite, onRevokeInvite })
    expect(view.getByText('Invited invitee@example.com')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(onResendInvite).toHaveBeenCalledTimes(1))
    await fireEvent.press(view.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(onRevokeInvite).toHaveBeenCalledTimes(1))
  })

  it('does not show the pending invite section to a non-owner member', async () => {
    const data: HouseholdViewModel = {
      ...memberViewing,
      pendingInvite: { email: 'invitee@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5 },
    }
    const { view } = await renderScreen({ state: { status: 'loaded', data } })
    expect(view.queryByText('Invited invitee@example.com')).not.toBeOnTheScreen()
  })

  it('shows the stale banner during a refresh error, keeping data usable', async () => {
    const { view } = await renderScreen({ state: { status: 'refresh-error', data: ownerViewingSolo } })
    expect(view.getByRole('alert')).toHaveTextContent(/last known household/i)
    expect(view.getByLabelText('Email')).toBeOnTheScreen()
  })
})
