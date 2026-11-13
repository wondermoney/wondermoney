import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import type { NotificationPreferencesDto } from './notification-preferences-contract'
import { NotificationsRoute } from './notifications-route'
import type { PushPreferencesDto } from './push-contract'

const mockToggle = jest.fn()
const mockSendTest = jest.fn()
let mockPushOn = true
let mockPushPreferences: PushPreferencesDto | undefined

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: jest.fn() }),
}))
jest.mock('@/lib/server/use-instance', () => ({
  useConfirmedFeature: (select: (features: { push?: boolean }) => boolean | undefined) => select({ push: mockPushOn }) === true,
}))
jest.mock('./use-push-notifications', () => ({
  usePushPreferences: () => ({ data: mockPushPreferences }),
  useSendTestPush: () => ({ isPending: false, mutate: mockSendTest }),
  useTogglePushCategory: () => ({ isPending: false, mutate: mockToggle }),
}))
jest.mock('./use-notification-preferences', () => {
  const actual = jest.requireActual('./use-notification-preferences')
  const preferences: NotificationPreferencesDto = {
    accountRecovery: { effectiveEnabled: true, storedEnabled: true },
    budgetAlerts: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
    growth: { effectiveEnabled: false, storedEnabled: false },
    marketingOptOut: false,
    weeklyInsights: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
  }
  return {
    ...actual,
    useNotificationPreferences: () => ({ data: preferences, isLoading: false, isAccessTransition: false, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() }),
    useUpdateNotificationPreferences: () => ({ mutateAsync: jest.fn(), isPending: false }),
  }
})

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><NotificationsRoute /></I18nextProvider>)
}

describe('NotificationsRoute push section', () => {
  beforeEach(() => {
    mockToggle.mockReset(); mockSendTest.mockReset()
    mockPushOn = true
    mockPushPreferences = { bankSyncAlerts: false, budgetAlerts: false, creditCardDueReminders: false }
  })

  it('is not shown on a server without push', async () => {
    mockPushOn = false
    const view = await renderRoute()
    expect(view.queryByTestId('push-notifications')).toBeNull()
  })

  it('shows every push category off by default and turns one on when tapped', async () => {
    const view = await renderRoute()
    const section = within(view.getByTestId('push-notifications'))
    for (const name of ['Budget alerts', 'Card payment reminders', 'Bank connection alerts']) {
      expect(section.getByRole('switch', { name: `Turn on ${name}` }).props.accessibilityState.checked).toBe(false)
    }
    await fireEvent.press(section.getByRole('switch', { name: 'Turn on Budget alerts' }))
    expect(mockToggle).toHaveBeenCalledWith({ category: 'budgetAlerts', next: true }, expect.anything())
  })

  it('explains a refused permission and keeps the category off', async () => {
    mockToggle.mockImplementation((_input, options: { onSuccess: (result: unknown) => void }) => options.onSuccess({ status: 'denied' }))
    const view = await renderRoute()
    const section = within(view.getByTestId('push-notifications'))
    await fireEvent.press(section.getByRole('switch', { name: 'Turn on Budget alerts' }))
    expect(view.getByText(/turned off for WonderMoney in your phone's settings/u)).toBeOnTheScreen()
  })

  it('sends a test notification and says it is on its way', async () => {
    mockSendTest.mockImplementation((_input, options: { onSuccess: () => void }) => options.onSuccess())
    const view = await renderRoute()
    await fireEvent.press(view.getByTestId('push-send-test'))
    expect(mockSendTest).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(view.getByText(/Test notification sent/u)).toBeOnTheScreen())
  })

  it('asks to turn a category on first when no phone is registered', async () => {
    mockSendTest.mockImplementation((_input, options: { onError: (error: unknown) => void }) => options.onError(new ApiError('http', 409)))
    const view = await renderRoute()
    await fireEvent.press(view.getByTestId('push-send-test'))
    await waitFor(() => expect(view.getByText(/Turn on a push notification first/u)).toBeOnTheScreen())
  })
})
