import type {
  CategoryStateDto,
  NotificationPreferencePatch,
  NotificationPreferencesDto,
  StreamStateDto,
} from './notification-preferences-contract'

/**
 * The optional email categories rendered as toggles. Ported from the web
 * settings surface so mobile and web classify preference state identically.
 * The API still returns `growth`, but nothing is sent in it any more, so it has
 * no toggle.
 */
export type NotificationStream =
  | 'budgetAlerts'
  | 'weeklyInsights'
  | 'accountRecovery'

/** Fixed display order, matching the web Notifications screen. */
export const NOTIFICATION_STREAMS: readonly NotificationStream[] = [
  'budgetAlerts',
  'weeklyInsights',
  'accountRecovery',
]

export type NotificationPreferenceStatus = 'active' | 'paused' | 'off'
export type NotificationPreferencePauseReason = 'delivery' | 'marketingOptOut' | 'generic' | null

export type NotificationPreferenceViewState = Readonly<{
  status: NotificationPreferenceStatus
  pauseReason: NotificationPreferencePauseReason
  canEnable: boolean
  canChange: boolean
}>

const STREAM_PATCH_FIELD: Record<NotificationStream, keyof NotificationPreferencePatch> = {
  budgetAlerts: 'budgetAlertsEnabled',
  weeklyInsights: 'weeklyInsightsEnabled',
  accountRecovery: 'accountRecoveryEnabled',
}

const STREAM_PREFERENCE: Record<NotificationStream, keyof Omit<NotificationPreferencesDto, 'marketingOptOut'>> = {
  budgetAlerts: 'budgetAlerts',
  weeklyInsights: 'weeklyInsights',
  accountRecovery: 'accountRecovery',
}

type Preference = CategoryStateDto | StreamStateDto

const hasDeliveryGate = (preference: Preference): preference is StreamStateDto =>
  'deliverySupported' in preference

export function getNotificationPreferenceViewState(
  preference: Preference,
  isMarketingOptedOut: boolean,
): NotificationPreferenceViewState {
  const deliverySupported = hasDeliveryGate(preference) ? preference.deliverySupported : true
  const canEnable = deliverySupported
  const canChange = preference.storedEnabled || canEnable

  if (!preference.storedEnabled) {
    return { status: 'off', pauseReason: getPauseReason(preference, deliverySupported, isMarketingOptedOut), canEnable, canChange }
  }
  if (preference.effectiveEnabled) {
    return { status: 'active', pauseReason: null, canEnable, canChange }
  }
  return { status: 'paused', pauseReason: getPauseReason(preference, deliverySupported, isMarketingOptedOut), canEnable, canChange }
}

function getPauseReason(
  preference: Preference,
  deliverySupported: boolean,
  isMarketingOptedOut: boolean,
): NotificationPreferencePauseReason {
  if (!deliverySupported) return 'delivery'
  if (!preference.storedEnabled || preference.effectiveEnabled) return null
  return isMarketingOptedOut ? 'marketingOptOut' : 'generic'
}

export function buildNotificationPreferencePatch(
  stream: NotificationStream,
  enabled: boolean,
): NotificationPreferencePatch {
  return { [STREAM_PATCH_FIELD[stream]]: enabled }
}

export type NotificationRowViewModel = Readonly<{
  stream: NotificationStream
  storedEnabled: boolean
  view: NotificationPreferenceViewState
}>

/** Prepares the ordered rows plus the master marketing-opt-out state for rendering. */
export function mapNotificationPreferences(preferences: NotificationPreferencesDto): Readonly<{
  rows: readonly NotificationRowViewModel[]
  marketingOptOut: boolean
}> {
  const rows = NOTIFICATION_STREAMS.map((stream) => {
    const preference = preferences[STREAM_PREFERENCE[stream]]
    return {
      stream,
      storedEnabled: preference.storedEnabled,
      view: getNotificationPreferenceViewState(preference, preferences.marketingOptOut),
    }
  })
  return { rows, marketingOptOut: preferences.marketingOptOut }
}
