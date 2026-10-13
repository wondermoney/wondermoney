import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import type { NotificationPreferencesDto } from './notification-preferences-contract'
import { NotificationsRoute } from './notifications-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
const mockSignOut = jest.fn()
const mockRefetch = jest.fn()
const mockMutateAsync = jest.fn()
let mockQuery: Record<string, unknown>
let mockPending = false

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: mockSignOut }),
}))
jest.mock('./use-notification-preferences', () => {
  const actual = jest.requireActual('./use-notification-preferences')
  return {
    ...actual,
    useNotificationPreferences: () => mockQuery,
    useUpdateNotificationPreferences: () => ({ mutateAsync: mockMutateAsync, isPending: mockPending }),
  }
})

const preferences: NotificationPreferencesDto = {
  accountRecovery: { effectiveEnabled: true, storedEnabled: true },
  budgetAlerts: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
  growth: { effectiveEnabled: false, storedEnabled: false },
  marketingOptOut: false,
  weeklyInsights: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
}

const baseQuery = {
  data: preferences,
  isLoading: false,
  isAccessTransition: false,
  isRefreshFailure: false,
  isRefreshing: false,
  refetch: mockRefetch,
}

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><NotificationsRoute /></I18nextProvider>)
}

describe('NotificationsRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockBack.mockReset(); mockCanGoBack.mockReset()
    mockSignOut.mockReset(); mockRefetch.mockReset(); mockMutateAsync.mockReset()
    mockPending = false; mockQuery = { ...baseQuery }
  })

  it('sends a stream patch on toggle', async () => {
    mockMutateAsync.mockResolvedValue(preferences)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('switch', { name: 'Turn off Budget alerts' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({ budgetAlertsEnabled: false }))
  })

  it('shows a save failure and resyncs from the server when a toggle is rejected', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('network'))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('switch', { name: 'Unsubscribe from all marketing emails' }))
    await waitFor(() => expect(view.getByRole('alert')).toBeOnTheScreen())
    expect(mockMutateAsync).toHaveBeenCalledWith({ marketingOptOut: true })
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('does not resync on an access-transition failure (the runtime handles it)', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('mfa-required', 401))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('switch', { name: 'Turn off Budget alerts' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled())
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('renders the loading and error states from the query', async () => {
    mockQuery = { ...baseQuery, data: undefined, isLoading: true }
    const loading = await renderRoute()
    expect(loading.getByLabelText('Loading email notification preferences')).toBeOnTheScreen()

    mockQuery = { ...baseQuery, data: undefined, isLoading: false }
    const errored = await renderRoute()
    expect(errored.getByRole('header', { name: 'Email preferences could not be loaded' })).toBeOnTheScreen()
  })

  it('falls back to More when there is no navigation history', async () => {
    mockCanGoBack.mockReturnValue(false)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back to More' }))
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })
})
