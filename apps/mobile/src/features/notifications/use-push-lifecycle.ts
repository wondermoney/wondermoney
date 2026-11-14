import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { expoPushDevice } from '@/lib/push/push-device'
import { securePushTokenStore } from '@/lib/push/push-token-store'
import { useConfirmedFeature } from '@/lib/server/use-instance'

import { notificationHref } from './push-deep-link'
import { refreshPushRegistration } from './push-registration'

/**
 * Opens the screen a tapped notification is about: the tap that launched the app, and every tap
 * after. Mounted inside the signed-in shell, so the route it opens is one the person can see.
 */
export function usePushNotificationNavigation() {
  const router = useRouter()
  useEffect(() => {
    let active = true
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
      const href = notificationHref(response.notification.request.content.data)
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined)
      if (href) router.push(href)
    }
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined)
    const subscription = Notifications.addNotificationResponseReceivedListener(open)
    return () => {
      active = false
      subscription.remove()
    }
  }, [router])
}

/** Once per sign-in, keeps an opted-in phone registered (a token can rotate). Never prompts. */
export function usePushRegistrationRefresh() {
  const { runtime } = useProductRuntime()
  const pushOn = useConfirmedFeature((features) => features.push)
  const epochId = runtime?.epochId
  const apiClient = runtime?.apiClient
  useEffect(() => {
    if (!pushOn || !apiClient) return
    void refreshPushRegistration({ api: apiClient, device: expoPushDevice, store: securePushTokenStore }).catch(() => undefined)
  }, [apiClient, epochId, pushOn])
}
