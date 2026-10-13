import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { MoreScreen } from './more-screen'

async function renderScreen(overrides: Partial<React.ComponentProps<typeof MoreScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props = {
    appInfo: { version: '1.0.0', environment: 'local' as const },
    onOpenHelp: jest.fn().mockResolvedValue(undefined),
    onOpenWhatsNew: jest.fn().mockResolvedValue(undefined),
    onOpenPrivacy: jest.fn().mockResolvedValue(undefined),
    onOpenTerms: jest.fn().mockResolvedValue(undefined),
    onOpenSupport: jest.fn().mockResolvedValue(undefined),
    onOpenProfile: jest.fn(),
    onOpenBudgets: jest.fn(),
    onOpenLoans: jest.fn(),
    onOpenBankConnections: jest.fn(),
    onOpenGoals: jest.fn(),
    onOpenMarkets: jest.fn(),
    onOpenReports: jest.fn(),
    onOpenPreferences: jest.fn(),
    onOpenCategories: jest.fn(),
    onOpenHousehold: jest.fn(),
    onOpenNotifications: jest.fn(),
    onOpenSecurity: jest.fn(),
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
  it('opens each functional destination only after its row is pressed', async () => {
    const { view, props } = await renderScreen()
    expect(props.onOpenPrivacy).not.toHaveBeenCalled()
    expect(props.onOpenTerms).not.toHaveBeenCalled()
    expect(props.onOpenSupport).not.toHaveBeenCalled()
    expect(props.onOpenProfile).not.toHaveBeenCalled()
    expect(props.onOpenBudgets).not.toHaveBeenCalled()
    expect(props.onOpenLoans).not.toHaveBeenCalled()
    expect(props.onOpenMarkets).not.toHaveBeenCalled()
    expect(props.onOpenReports).not.toHaveBeenCalled()
    expect(view.getByRole('button', { name: 'Profile, opens in the app' })).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Terms of service, opens outside the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Support, opens your mail app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Profile, opens in the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Budgets, opens in the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Loans, opens in the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Markets, opens in the app' }))
    expect(props.onOpenMarkets).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Reports, opens in the app' }))
    expect(props.onOpenReports).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Household, opens in the app' }))
    expect(props.onOpenHousehold).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Notifications, opens in the app' }))
    expect(props.onOpenNotifications).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Security, opens in the app' }))
    expect(props.onOpenSecurity).toHaveBeenCalledTimes(1)
    expect(props.onOpenPrivacy).toHaveBeenCalledTimes(1)
    expect(props.onOpenTerms).toHaveBeenCalledTimes(1)
    expect(props.onOpenSupport).toHaveBeenCalledTimes(1)
    expect(props.onOpenProfile).toHaveBeenCalledTimes(1)
    expect(props.onOpenBudgets).toHaveBeenCalledTimes(1)
    expect(props.onOpenLoans).toHaveBeenCalledTimes(1)
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
    expect(view.getByRole('button', { name: 'Household, opens in the app' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Notifications, opens in the app' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Security, opens in the app' })).toBeOnTheScreen()
    expect(view.queryByText(/payment method|pricing|bank balance/i)).not.toBeOnTheScreen()
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    for (const label of [
      'Privacy policy, opens outside the app',
      'Terms of service, opens outside the app',
      'Support, opens your mail app',
      'Profile, opens in the app',
      'Budgets, opens in the app',
      'Loans, opens in the app',
      'Markets, opens in the app',
    ]) {
      const row = view.getByRole('button', { name: label })
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44)
      expect(within(row).getAllByText(/Privacy|Terms|Support|Profile|Budgets|Loan|Markets/)[0].props.allowFontScaling).not.toBe(false)
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
})
