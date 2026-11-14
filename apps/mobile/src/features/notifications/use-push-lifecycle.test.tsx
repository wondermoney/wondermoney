import { renderHook, waitFor } from '@testing-library/react-native'

import { usePushNotificationNavigation } from './use-push-lifecycle'

const mockPush = jest.fn()
type Listener = (response: unknown) => void
const mockListeners: Listener[] = []
let mockLastResponse: unknown = null

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: null }) }))
jest.mock('@/lib/server/use-instance', () => ({ useConfirmedFeature: () => false }))
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  addNotificationResponseReceivedListener: (listener: Listener) => {
    mockListeners.push(listener)
    return { remove: () => mockListeners.splice(mockListeners.indexOf(listener), 1) }
  },
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  getLastNotificationResponseAsync: () => Promise.resolve(mockLastResponse),
}))

const tap = (url: unknown, actionIdentifier = 'expo.modules.notifications.actions.DEFAULT') => ({
  actionIdentifier,
  notification: { request: { content: { data: { url } } } },
})

describe('usePushNotificationNavigation', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockListeners.length = 0
    mockLastResponse = null
  })

  it('opens the screen of a notification tapped while the app runs', async () => {
    renderHook(() => usePushNotificationNavigation())
    await waitFor(() => expect(mockListeners).toHaveLength(1))

    mockListeners[0]?.(tap('/budgets/3/2026/11'))

    expect(mockPush).toHaveBeenCalledWith('/budgets/3/2026/11')
  })

  it('opens the screen of the notification that launched the app', async () => {
    mockLastResponse = tap('/accounts/42')
    renderHook(() => usePushNotificationNavigation())

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/accounts/42'))
  })

  it('stays put for a link to anywhere else, or a dismissal', async () => {
    renderHook(() => usePushNotificationNavigation())
    await waitFor(() => expect(mockListeners).toHaveLength(1))

    mockListeners[0]?.(tap('https://example.test/phish'))
    mockListeners[0]?.(tap('/budgets', 'expo.modules.notifications.actions.DISMISS'))

    expect(mockPush).not.toHaveBeenCalled()
  })
})
