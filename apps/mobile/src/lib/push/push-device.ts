import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications'
import { Platform } from 'react-native'

export type { PushTokenStore } from './push-token-store'

/**
 * The phone's side of push notifications, behind a port so the flows that use it are testable
 * without a device. Nothing here asks for permission by itself: only `requestPermission`
 * prompts, and only the opt-in flow calls it.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined'

export type PushDevicePort = Readonly<{
  /** The current permission, without prompting. */
  getPermission: () => Promise<PushPermission>
  /** Shows the system prompt (Android 13+ needs a channel first, which this creates). */
  requestPermission: () => Promise<PushPermission>
  /** This install's Expo push token; null when it can't be had (no project id, offline, a simulator). */
  getToken: () => Promise<string | null>
  platform: 'android' | 'ios' | null
  appVersion: string | undefined
}>

/** The Android channel notifications are posted to; the API sends `channelId: 'default'`. */
export const PUSH_CHANNEL_ID = 'default'

const toPermission = (status: Notifications.NotificationPermissionsStatus): PushPermission => {
  if (status.granted) return 'granted'
  const iosStatus = status.ios?.status
  if (iosStatus === IosAuthorizationStatus.PROVISIONAL || iosStatus === IosAuthorizationStatus.EPHEMERAL) return 'granted'
  return status.canAskAgain ? 'undetermined' : 'denied'
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    importance: AndroidImportance.DEFAULT,
    name: 'WonderMoney',
  })
}

function projectId(): string | undefined {
  const fromEas = Constants.easConfig?.projectId
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return fromEas ?? extra?.eas?.projectId
}

export const expoPushDevice: PushDevicePort = {
  getPermission: async () => toPermission(await Notifications.getPermissionsAsync()),
  requestPermission: async () => {
    await ensureChannel()
    return toPermission(await Notifications.requestPermissionsAsync())
  },
  getToken: async () => {
    const id = projectId()
    if (!id) return null
    try {
      await ensureChannel()
      return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data
    } catch {
      return null
    }
  },
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null,
  appVersion: Constants.expoConfig?.version ?? undefined,
}

let foregroundHandlerInstalled = false

/** Show a notification that arrives while the app is open, as the OS would. Safe to call more than once. */
export function installForegroundNotificationHandler(): void {
  if (foregroundHandlerInstalled) return
  foregroundHandlerInstalled = true
  try {
    Notifications.setNotificationHandler({
      handleNotification: () => Promise.resolve({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    })
  } catch {
    // No notifications module (web, a test renderer): nothing arrives to show.
  }
}
