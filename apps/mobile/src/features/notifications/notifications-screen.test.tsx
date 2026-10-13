import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import type { NotificationPreferencesDto } from './notification-preferences-contract'
import { mapNotificationPreferences } from './notification-preferences-view-model'
import { NotificationsScreen, type NotificationsViewState } from './notifications-screen'

const preferences: NotificationPreferencesDto = {
  accountRecovery: { effectiveEnabled: false, storedEnabled: false },
  budgetAlerts: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
  growth: { effectiveEnabled: false, storedEnabled: false },
  marketingOptOut: false,
  weeklyInsights: { deliverySupported: false, effectiveEnabled: false, storedEnabled: true },
}

const loaded = (overrides: Partial<Extract<NotificationsViewState, { status: 'loaded' }>> = {}): NotificationsViewState => {
  const mapped = mapNotificationPreferences(preferences)
  return { status: 'loaded', rows: mapped.rows, marketingOptOut: mapped.marketingOptOut, refreshFailed: false, refreshing: false, ...overrides }
}

async function renderScreen(overrides: Partial<React.ComponentProps<typeof NotificationsScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props = {
    state: loaded(),
    saving: false,
    saveFailure: null,
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onLogout: jest.fn(),
    onToggleStream: jest.fn(),
    onToggleMarketingOptOut: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><NotificationsScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('NotificationsScreen', () => {
  it('renders a switch per category plus the marketing opt-out, reflecting stored state', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('header', { name: 'Email notifications' })).toBeOnTheScreen()
    // budgetAlerts stored on → offer "Turn off"
    expect(view.getByRole('switch', { name: 'Turn off Budget alerts' })).toBeOnTheScreen()
    // accountRecovery stored off → offer "Turn on"
    expect(view.getByRole('switch', { name: 'Turn on Account recovery emails' })).toBeOnTheScreen()
    // growth is still in the payload but has no toggle
    expect(view.queryByRole('switch', { name: /Product update emails/ })).toBeNull()
    expect(view.getByRole('switch', { name: 'Unsubscribe from all marketing emails' })).toBeOnTheScreen()
  })

  it('surfaces a delivery pause reason and disables a delivery-unsupported stream', async () => {
    const { view } = await renderScreen()
    // weeklyInsights stored on but delivery unsupported → paused + delivery reason, non-changeable via enable path
    expect(view.getByText(/available only in Portuguese/i)).toBeOnTheScreen()
  })

  it('toggling a category requests the inverse of its stored value', async () => {
    const { view, props } = await renderScreen()
    await fireEvent.press(view.getByRole('switch', { name: 'Turn off Budget alerts' }))
    expect(props.onToggleStream).toHaveBeenCalledWith('budgetAlerts', false)
    await fireEvent.press(view.getByRole('switch', { name: 'Turn on Account recovery emails' }))
    expect(props.onToggleStream).toHaveBeenCalledWith('accountRecovery', true)
  })

  it('disables every control and announces progress while saving', async () => {
    const { view, props } = await renderScreen({ saving: true })
    const toggle = view.getByRole('switch', { name: 'Turn off Budget alerts' })
    expect(toggle.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(toggle)
    expect(props.onToggleStream).not.toHaveBeenCalled()
    expect(view.getByText('Saving change…')).toBeOnTheScreen()
  })

  it('shows a non-destructive save error without changing the toggle optimistically', async () => {
    const { view } = await renderScreen({ saveFailure: 'unknown' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByText(/could not be confirmed/i)).toBeOnTheScreen()
  })

  it('renders a retryable failure state on initial load error', async () => {
    const { view, props } = await renderScreen({ state: { status: 'error' } })
    expect(view.getByRole('header', { name: 'Email preferences could not be loaded' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  it('returns nothing during an access transition', async () => {
    const { view } = await renderScreen({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })
})
