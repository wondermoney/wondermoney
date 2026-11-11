import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { MoreScreen } from './more-screen'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }))

async function renderScreen(overrides: Partial<React.ComponentProps<typeof MoreScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props = {
    appInfo: { version: '1.0.0', environment: 'local' as const },
    onOpenHelp: jest.fn().mockResolvedValue(undefined),
    onOpenWhatsNew: jest.fn().mockResolvedValue(undefined),
    onOpenPrivacy: jest.fn().mockResolvedValue(undefined),
    onOpenTerms: jest.fn().mockResolvedValue(undefined),
    onOpenSupport: jest.fn().mockResolvedValue(undefined),
    onOpenAccountsOverview: jest.fn(),
    onOpenTransactions: jest.fn(),
    onOpenRecurring: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenMarkets: jest.fn(),
    onOpenLoans: jest.fn(),
    onOpenAssets: jest.fn(),
    onOpenGoals: jest.fn(),
    onOpenReports: jest.fn(),
    onLogout: jest.fn(),
    onSubmitFeedback: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <MoreScreen {...props} />
    </I18nextProvider>,
  )
  return { view, props }
}

describe('MoreScreen', () => {
  beforeEach(() => {
    jest.mocked(Clipboard.setStringAsync).mockClear()
  })

  it('shows only help, not the hosted instance\'s legal pages, changelog or support, on a self-hosted server', async () => {
    const { view } = await renderScreen({
      onOpenPrivacy: undefined,
      onOpenSupport: undefined,
      onOpenTerms: undefined,
      onOpenWhatsNew: undefined,
      onSubmitFeedback: undefined,
    })
    expect(view.getByText('Help')).toBeOnTheScreen()
    for (const label of ['Privacy policy', 'Terms of service', 'Support', "What's new", 'Share feedback']) {
      expect(view.queryByText(label)).toBeNull()
    }
  })

  it('opens each functional destination only after its row is pressed', async () => {
    const { view, props } = await renderScreen()
    const inside: [string, keyof typeof props][] = [
      ['Overview', 'onOpenAccountsOverview'],
      ['Transactions', 'onOpenTransactions'],
      ['Bills & subscriptions', 'onOpenRecurring'],
      ['Settings', 'onOpenSettings'],
      ['Financial Markets', 'onOpenMarkets'],
      ['Loans', 'onOpenLoans'],
      ['Assets', 'onOpenAssets'],
      ['Goals', 'onOpenGoals'],
      ['Reports', 'onOpenReports'],
    ]
    for (const [, handler] of inside) expect(props[handler]).not.toHaveBeenCalled()
    expect(props.onOpenPrivacy).not.toHaveBeenCalled()
    for (const [label, handler] of inside) {
      await fireEvent.press(view.getByRole('button', { name: `${label}, opens in the app` }))
      expect(props[handler]).toHaveBeenCalledTimes(1)
    }
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Terms of service, opens outside the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Support, opens your mail app' }))
    expect(props.onOpenPrivacy).toHaveBeenCalledTimes(1)
    expect(props.onOpenTerms).toHaveBeenCalledTimes(1)
    expect(props.onOpenSupport).toHaveBeenCalledTimes(1)
  })

  it('shows a specific retryable local failure without exposing product data', async () => {
    const onOpenPrivacy = jest.fn().mockRejectedValue(new Error('browser failed'))
    const { view } = await renderScreen({ onOpenPrivacy })
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    await waitFor(() => expect(
      view.getByRole('alert', { name: 'Could not open Privacy policy. Try again' }),
    ).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Retry Privacy policy' }))
    expect(onOpenPrivacy).toHaveBeenCalledTimes(2)
  })

  it('shows an account header with initials and email when the email is known', async () => {
    const { view } = await renderScreen({ email: 'ana.silva@example.com' })
    expect(view.getByText('ana.silva@example.com')).toBeOnTheScreen()
    expect(view.getByText('AS')).toBeOnTheScreen()
  })

  it('omits the account header while the email has not loaded yet', async () => {
    const { view } = await renderScreen({ email: undefined })
    expect(view.queryByText(/@/)).not.toBeOnTheScreen()
  })

  it('signs out from a dedicated row rather than the primary dashboard', async () => {
    const onLogout = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onLogout })
    const row = view.getByRole('button', { name: 'Sign out, opens in the app' })
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44)
    await fireEvent.press(row)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('shows only functional rows and approved non-sensitive app information', async () => {
    const { view } = await renderScreen()
    expect(view.getByText('Version 1.0.0')).toBeOnTheScreen()
    expect(view.getByText('Environment Local')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Settings, opens in the app' })).toBeOnTheScreen()
    expect(view.queryByText(/payment method|pricing|bank balance/i)).not.toBeOnTheScreen()
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    for (const label of [
      'Privacy policy, opens outside the app',
      'Terms of service, opens outside the app',
      'Support, opens your mail app',
      'Settings, opens in the app',
      'Loans, opens in the app',
      'Financial Markets, opens in the app',
    ]) {
      const row = view.getByRole('button', { name: label })
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44)
      expect(within(row).getAllByText(/Privacy|Terms|Support|Settings|Loan|Markets/)[0].props.allowFontScaling).not.toBe(false)
    }
    const privacy = view.getByRole('button', { name: 'Privacy policy, opens outside the app' })
    await fireEvent(privacy, 'focus')
    expect(StyleSheet.flatten(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }).props.style).borderWidth).toBe(2)
  })

  it('opens the feedback dialog from an in-app entry point near support, and submits through it', async () => {
    const onSubmitFeedback = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmitFeedback })
    expect(view.queryByRole('radio', { name: 'Bug' })).not.toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Share feedback, opens in the app' }))
    expect(view.getByRole('radio', { name: 'Bug' })).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('radio', { name: 'Bug' }))
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'The app crashed')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))

    await waitFor(() => expect(onSubmitFeedback).toHaveBeenCalledWith({ category: 'bug', message: 'The app crashed' }))
    await waitFor(() => expect(view.queryByRole('radio', { name: 'Bug' })).not.toBeOnTheScreen())
  })

  it('keeps the feedback dialog open and shows a failure when submission fails', async () => {
    const onSubmitFeedback = jest.fn().mockRejectedValue(new Error('unavailable'))
    const { view } = await renderScreen({ onSubmitFeedback })
    await fireEvent.press(view.getByRole('button', { name: 'Share feedback, opens in the app' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Other' }))
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'A note')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(view.getByRole('alert', { name: 'Could not open your mail app to send this. Try again.' })).toBeOnTheScreen())
    expect(view.getByRole('radio', { name: 'Other' })).toBeOnTheScreen()
  })

  it('closes the feedback dialog on cancel without submitting', async () => {
    const onSubmitFeedback = jest.fn()
    const { view } = await renderScreen({ onSubmitFeedback })
    await fireEvent.press(view.getByRole('button', { name: 'Share feedback, opens in the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
    expect(view.queryByRole('radio', { name: 'Bug' })).not.toBeOnTheScreen()
    expect(onSubmitFeedback).not.toHaveBeenCalled()
  })

  it('shows the connected server version and commit next to the app version', async () => {
    const { view } = await renderScreen({
      serverInfo: { version: '1.2.0', commit: 'abc1234' },
    })
    expect(view.getByText('Version 1.0.0')).toBeOnTheScreen()
    expect(view.getByText('Server 1.2.0 (abc1234)')).toBeOnTheScreen()
  })

  it('copies the app and server versions on one line for a bug report', async () => {
    const { view } = await renderScreen({
      serverInfo: { version: '1.2.0', commit: 'abc1234' },
    })
    await fireEvent.press(view.getByRole('button', { name: 'Copy version info' }))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      'WonderMoney app 1.0.0, server 1.2.0 (abc1234)',
    )
    expect(view.getByText('Version info copied')).toBeOnTheScreen()
  })

  it('leaves out the server line when the server does not report a version', async () => {
    const { view } = await renderScreen({ serverInfo: null })
    expect(view.queryByText(/^Server /)).not.toBeOnTheScreen()
  })
})
