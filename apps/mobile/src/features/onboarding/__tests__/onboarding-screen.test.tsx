import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { OnboardingScreen } from '../onboarding-screen'
import type { OnboardingJourneyView } from '../onboarding-view-model'

const newUserView: OnboardingJourneyView = {
  cards: [
    { done: false, key: 'net_worth_value' },
    { done: false, key: 'read_only_bank_access' },
    { done: false, key: 'privacy' },
  ],
  completed: false,
  completedVersion: null,
  createAccountActionAvailable: true,
  primaryActionAvailable: true,
  required: true,
  skippable: true,
  skipActionAvailable: true,
  supportedActions: ['connect_bank', 'skip'],
  version: 1,
}

const completedView: OnboardingJourneyView = {
  ...newUserView,
  completed: true,
  completedVersion: 1,
  createAccountActionAvailable: false,
  primaryActionAvailable: false,
  required: false,
  skipActionAvailable: false,
}

async function renderScreen(props: React.ComponentProps<typeof OnboardingScreen>) {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <OnboardingScreen {...props} />
    </I18nextProvider>,
  )
}

describe('OnboardingScreen', () => {
  it('renders the first step of the six-step journey', async () => {
    const view = await renderScreen({
      state: { status: 'loaded', view: newUserView },
      pending: false,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })

    expect(view.getByText('Bring your financial plan together here.')).toBeTruthy()
    expect(view.getByText('Step 1 of 4')).toBeTruthy()
    expect(view.getByLabelText('Start setup')).toBeTruthy()
    expect(view.getByLabelText('Skip setup')).toBeTruthy()
  })

  it('progresses through all six steps and can go back', async () => {
    const view = await renderScreen({
      state: { status: 'loaded', view: newUserView },
      pending: false,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })

    fireEvent.press(view.getByLabelText('Start setup'))
    await waitFor(() => expect(view.getByText('Step 2 of 4')).toBeTruthy())
    expect(view.getByText('What do you want to improve first?')).toBeTruthy()
    expect(view.getByLabelText('Continue').props.accessibilityState?.disabled).toBe(true)

    fireEvent.press(view.getByText('See everything in one place'))
    await waitFor(() => expect(view.getByLabelText('Continue').props.accessibilityState?.disabled).toBe(false))
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 3 of 4')).toBeTruthy())
    expect(view.getByText('Read-only means read-only.')).toBeTruthy()

    fireEvent.press(view.getByLabelText('Back'))
    await waitFor(() => expect(view.getByText('Step 2 of 4')).toBeTruthy())
    expect(view.getByText('See everything in one place')).toBeTruthy()

    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 3 of 4')).toBeTruthy())
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 4 of 4')).toBeTruthy())
    expect(view.getAllByLabelText('Connect bank account').length).toBe(1)
    expect(view.getByLabelText('Add account manually')).toBeTruthy()
  })

  it('calls onSkip from the skip control and disables it while pending', async () => {
    const onSkip = jest.fn()
    const view = await renderScreen({
      state: { status: 'loaded', view: newUserView },
      pending: false,
      outcome: 'idle',
      onSkip,
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })

    fireEvent.press(view.getByLabelText('Skip setup'))
    expect(onSkip).toHaveBeenCalledTimes(1)

    const pendingView = await renderScreen({
      state: { status: 'loaded', view: newUserView },
      pending: true,
      outcome: 'skip',
      onSkip,
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })
    expect(pendingView.getByLabelText('Skip setup').props.accessibilityState?.disabled).toBe(true)
  })

  it('disables account actions while a write is in flight', async () => {
    const onCreateAccount = jest.fn()
    const view = await renderScreen({
      state: { status: 'loaded', view: newUserView },
      pending: true,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount,
      onRetry: jest.fn(),
    })

    fireEvent.press(view.getByLabelText('Start setup'))
    await waitFor(() => expect(view.getByText('Step 2 of 4')).toBeTruthy())
    fireEvent.press(view.getByText('See everything in one place'))
    await waitFor(() => expect(view.getByLabelText('Continue').props.accessibilityState?.disabled).toBe(false))
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 3 of 4')).toBeTruthy())
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 4 of 4')).toBeTruthy())
    expect(view.getAllByLabelText('Connect bank account')[0].props.accessibilityState?.disabled).toBe(true)
    expect(view.getByLabelText('Add account manually').props.accessibilityState?.disabled).toBe(true)
    expect(onCreateAccount).not.toHaveBeenCalled()
  })

  it('renders the localized error and a retry action when the bootstrap fails to load', async () => {
    const onRetry = jest.fn()
    const view = await renderScreen({
      state: { status: 'error' },
      pending: false,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry,
    })
    expect(view.getByText('Could not load the first-run journey')).toBeTruthy()
    const retry = view.getByLabelText('Retry')
    fireEvent.press(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the localized invalid-response copy when the server returns an unverifiable payload', async () => {
    const view = await renderScreen({
      state: { status: 'invalid-response' },
      pending: false,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })
    expect(view.getByText('Could not verify the first-run journey')).toBeTruthy()
  })

  it('hides the screen body during an access transition so the runtime can render the access destination', async () => {
    const view = await renderScreen({
      state: { status: 'access-transition' },
      pending: false,
      outcome: 'idle',
      onSkip: jest.fn(),
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })
    expect(view.toJSON()).toBeNull()
  })
})

describe('OnboardingScreen for a user who is no longer required', () => {
  it('reaches the account step, which is where the journey ends', async () => {
    const onSkip = jest.fn()
    const view = await renderScreen({
      state: { status: 'loaded', view: completedView },
      pending: false,
      outcome: 'idle',
      onSkip,
      onConnectBank: jest.fn(),
      onCreateAccount: jest.fn(),
      onRetry: jest.fn(),
    })
    expect(view.getByText('Bring your financial plan together here.')).toBeTruthy()
    expect(view.queryByLabelText('Skip setup')).toBeNull()

    fireEvent.press(view.getByLabelText('Start setup'))
    await waitFor(() => expect(view.getByText('Step 2 of 4')).toBeTruthy())
    fireEvent.press(view.getByText('See everything in one place'))
    await waitFor(() => expect(view.getByLabelText('Continue').props.accessibilityState?.disabled).toBe(false))
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 3 of 4')).toBeTruthy())
    fireEvent.press(view.getByLabelText('Continue'))
    await waitFor(() => expect(view.getByText('Step 4 of 4')).toBeTruthy())
    expect(view.getAllByLabelText('Connect bank account').length).toBe(1)
    fireEvent.press(view.getByLabelText('Connect bank account'))
    expect(view.getByLabelText('Connect bank account')).toBeTruthy()
  })
})
