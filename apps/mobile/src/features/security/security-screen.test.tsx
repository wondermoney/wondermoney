import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { SecurityScreen } from './security-screen'
import type { DeleteAccountFailure } from './use-delete-account'

async function renderScreen(overrides: Partial<React.ComponentProps<typeof SecurityScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof SecurityScreen> = {
    pending: false,
    outcome: null as DeleteAccountFailure | null,
    onBack: jest.fn(),
    onDelete: jest.fn(),
    mfa: {
      status: 'off',
      enrollment: null,
      enrollBusy: false,
      enrollFailed: false,
      confirmBusy: false,
      confirmFailure: null,
      unenrollBusy: false,
      unenrollFailed: false,
      onRetryStatus: jest.fn(),
      onTurnOn: jest.fn(),
      onConfirm: jest.fn(),
      onCancelEnrollment: jest.fn(),
      onTurnOff: jest.fn(),
    },
    password: {
      pending: false,
      succeeded: false,
      failure: null,
      onSubmit: jest.fn(),
    },
    appLock: {
      isLoaded: true,
      enabled: false,
      pending: false,
      failure: null,
      onTurnOn: jest.fn(),
      onTurnOff: jest.fn(),
    },
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <SecurityScreen {...props} />
    </I18nextProvider>,
  )
  return { view, props }
}

describe('SecurityScreen', () => {
  it('distinguishes permanent deletion from sign-out and bank disconnection', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('header', { name: 'Security' })).toBeOnTheScreen()
    expect(view.getByText(/not the same as signing out/i)).toBeOnTheScreen()
    expect(view.getByText(/not the same as disconnecting a bank/i)).toBeOnTheScreen()
    expect(view.getByText(/permanent and cannot be undone/i)).toBeOnTheScreen()
  })

  it('makes no claim about exporting data', async () => {
    const { view } = await renderScreen()
    expect(view.queryByText(/export|download your data/i)).not.toBeOnTheScreen()
  })

  it('requires a deliberate acknowledgement before deletion can be requested', async () => {
    const onDelete = jest.fn()
    const { view } = await renderScreen({ onDelete })
    const button = view.getByRole('button', { name: 'Delete account permanently' })
    expect(button.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(button)
    expect(onDelete).not.toHaveBeenCalled()

    const checkbox = view.getByRole('checkbox')
    expect(checkbox.props.accessibilityState.checked).toBe(false)
    await fireEvent.press(checkbox)
    expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(true)

    await fireEvent.press(view.getByRole('button', { name: 'Delete account permanently' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('meets the minimum touch target for the destructive action', async () => {
    const { view } = await renderScreen()
    const button = view.getByRole('button', { name: 'Delete account permanently' })
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('disables interaction and shows progress while a deletion is pending', async () => {
    const onDelete = jest.fn()
    const { view } = await renderScreen({ pending: true, onDelete })
    const button = view.getByRole('button', { name: 'Deleting account…' })
    expect(button.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(button)
    expect(onDelete).not.toHaveBeenCalled()
    expect(view.getByRole('checkbox').props.accessibilityState.disabled).toBe(true)
  })

  it.each([
    ['unknown', /could not confirm your account was deleted/i],
    ['demo', /unavailable in demo mode/i],
    ['access', /could not authorize this action/i],
    ['mfa', /multi-factor authentication is required/i],
    ['cancelled', /deletion was cancelled/i],
  ] as const)('surfaces a specific, non-success alert for the %s outcome', async (outcome, pattern) => {
    const { view } = await renderScreen({ outcome })
    const alert = view.getByRole('alert')
    expect(alert).toBeOnTheScreen()
    expect(view.getByText(pattern)).toBeOnTheScreen()
    // No failure may imply the account was deleted.
    expect(view.queryByText(/account (was |has been )?deleted successfully/i)).not.toBeOnTheScreen()
  })

  it('renders the two-factor authentication section and forwards its actions', async () => {
    const onTurnOn = jest.fn()
    const { view } = await renderScreen({ mfa: {
      status: 'off',
      enrollment: null,
      enrollBusy: false,
      enrollFailed: false,
      confirmBusy: false,
      confirmFailure: null,
      unenrollBusy: false,
      unenrollFailed: false,
      onRetryStatus: jest.fn(),
      onTurnOn,
      onConfirm: jest.fn(),
      onCancelEnrollment: jest.fn(),
      onTurnOff: jest.fn(),
    } })
    expect(view.getByRole('header', { name: 'Two-factor authentication' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Turn on two-factor authentication' }))
    expect(onTurnOn).toHaveBeenCalledTimes(1)
  })
})
