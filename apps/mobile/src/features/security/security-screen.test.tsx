import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { touchHeight } from '@/test/touch-target'
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
    dataExport: {
      available: true,
      status: 'idle',
      readyUntil: null,
      starting: false,
      failure: null,
      onStart: jest.fn(),
      onDownload: jest.fn(),
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
    expect(view.getByRole('header', { name: 'Settings' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Settings, Security' })).toBeOnTheScreen()
    expect(view.getByText(/not the same as signing out/i)).toBeOnTheScreen()
    expect(view.getByText(/not the same as disconnecting a bank/i)).toBeOnTheScreen()
    expect(view.getByText(/permanent and cannot be undone/i)).toBeOnTheScreen()
  })

  describe('data export', () => {
    const dataExport = (overrides: Partial<React.ComponentProps<typeof SecurityScreen>['dataExport']> = {}) => ({
      available: true,
      status: 'idle' as const,
      readyUntil: null,
      starting: false,
      failure: null,
      onStart: jest.fn(),
      onDownload: jest.fn(),
      ...overrides,
    })

    it('starts a full export', async () => {
      const props = dataExport()
      const { view } = await renderScreen({ dataExport: props })
      expect(view.getByRole('header', { name: 'Export your data' })).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: 'Export all data' }))
      expect(props.onStart).toHaveBeenCalledTimes(1)
    })

    it('cannot start a second export while one is being prepared', async () => {
      const props = dataExport({ status: 'preparing' })
      const { view } = await renderScreen({ dataExport: props })
      expect(view.getByText(/email you when it is ready/i)).toBeOnTheScreen()
      const button = view.getByRole('button', { name: 'Export all data' })
      expect(button.props.accessibilityState.disabled).toBe(true)
      await fireEvent.press(button)
      expect(props.onStart).not.toHaveBeenCalled()
    })

    it('offers the download once the export is ready, with how long it stays available', async () => {
      const props = dataExport({ status: 'ready', readyUntil: '9 Nov 2026, 10:00' })
      const { view } = await renderScreen({ dataExport: props })
      expect(view.getByText('Available to download until 9 Nov 2026, 10:00.')).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: 'Download export' }))
      expect(props.onDownload).toHaveBeenCalledTimes(1)
      expect(touchHeight(view.getByRole('button', { name: 'Download export' }))).toBeGreaterThanOrEqual(44)
    })

    it('points to the web app when the server does not store exports', async () => {
      const { view } = await renderScreen({ dataExport: dataExport({ available: false }) })
      expect(view.getByText(/from the web app/i)).toBeOnTheScreen()
      expect(view.queryByRole('button', { name: 'Export all data' })).not.toBeOnTheScreen()
    })

    it('explains the daily limit', async () => {
      const { view } = await renderScreen({ dataExport: dataExport({ failure: 'limit' }) })
      expect(view.getByRole('alert')).toBeOnTheScreen()
      expect(view.getByText(/up to 3 times a day/i)).toBeOnTheScreen()
    })

    const PASSPHRASE = 'correct horse battery staple'

    const protectWith = async (view: Awaited<ReturnType<typeof renderScreen>>['view'], password: string, confirmation = password) => {
      await fireEvent.press(view.getByRole('switch', { name: 'Protect the file with a password' }))
      await fireEvent.changeText(view.getByLabelText('Password'), password)
      await fireEvent.changeText(view.getByLabelText('Repeat password'), confirmation)
      await fireEvent.press(view.getByRole('button', { name: 'Export all data' }))
    }

    it('starts an export without a password unless the member asks for one', async () => {
      const props = dataExport()
      const { view } = await renderScreen({ dataExport: props })
      expect(view.queryByLabelText('Password')).not.toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: 'Export all data' }))
      expect(props.onStart).toHaveBeenCalledWith(undefined)
    })

    it('sends the password once it is long enough and typed twice, then clears it', async () => {
      const props = dataExport({ onStart: jest.fn().mockResolvedValue(true) })
      const { view } = await renderScreen({ dataExport: props })
      await protectWith(view, PASSPHRASE)
      expect(props.onStart).toHaveBeenCalledWith(PASSPHRASE)
      await waitFor(() => expect(view.queryByLabelText('Password')).not.toBeOnTheScreen())
    })

    it('keeps the password when the server did not accept the export', async () => {
      const props = dataExport({ onStart: jest.fn().mockResolvedValue(false) })
      const { view } = await renderScreen({ dataExport: props })
      await protectWith(view, PASSPHRASE)
      expect(props.onStart).toHaveBeenCalledTimes(1)
      expect(view.getByLabelText('Password').props.value).toBe(PASSPHRASE)
    })

    it('blocks a password shorter than 16 characters', async () => {
      const props = dataExport()
      const { view } = await renderScreen({ dataExport: props })
      await protectWith(view, 'fifteen chars!!')
      expect(props.onStart).not.toHaveBeenCalled()
      expect(view.getByRole('alert')).toHaveTextContent('Use at least 16 characters.')
    })

    it('blocks a confirmation that does not match', async () => {
      const props = dataExport()
      const { view } = await renderScreen({ dataExport: props })
      await protectWith(view, PASSPHRASE, `${PASSPHRASE}.`)
      expect(props.onStart).not.toHaveBeenCalled()
      expect(view.getByRole('alert')).toHaveTextContent('The passwords do not match.')
    })

    it('says under the password field when the server rejected the password', async () => {
      const { view } = await renderScreen({ dataExport: dataExport({ failure: 'password' }) })
      await fireEvent.press(view.getByRole('switch', { name: 'Protect the file with a password' }))
      expect(view.getByRole('alert')).toHaveTextContent(/did not accept this password.*between 16 and 256 characters/i)
    })

    it('explains that another export is still running', async () => {
      const { view } = await renderScreen({ dataExport: dataExport({ failure: 'in-progress' }) })
      expect(view.getByRole('alert')).toHaveTextContent(/another export is still in progress/i)
    })

    it('says a prepared export is password protected', async () => {
      const { view } = await renderScreen({ dataExport: dataExport({ status: 'ready', readyUntil: '9 Nov 2026, 10:00', protectedExport: true }) })
      expect(view.getByText('This export is password protected.')).toBeOnTheScreen()
    })
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
    expect(touchHeight(button)).toBeGreaterThanOrEqual(44)
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
