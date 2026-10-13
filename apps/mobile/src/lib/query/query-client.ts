import NetInfo from '@react-native-community/netinfo'
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query'
import { AppState, type AppStateStatus } from 'react-native'

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
        networkMode: 'online',
      },
      mutations: {
        retry: 0,
        networkMode: 'always',
      },
    },
  })

/**
 * Wires React Query's online/focus managers to real device state.
 *
 * Without this, `onlineManager`/`focusManager` fall back to their web defaults —
 * listening for browser `window.online`/`offline` and `visibilitychange` events —
 * which are no-ops on React Native. Queries would never pause while offline nor
 * automatically refetch when connectivity or the app foreground returns; failed
 * requests would just surface as raw network errors. Call this once, at app
 * startup (see `AppProviders`).
 */
export function wireQueryClientToDeviceState(): () => void {
  // onlineManager owns this listener's lifecycle internally: it tears down the previous
  // NetInfo subscription whenever setEventListener is called again (including by us, e.g.
  // on re-mount in tests), so there is nothing for us to unsubscribe here.
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected)
    }))

  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active')
  })

  return () => {
    subscription.remove()
  }
}
