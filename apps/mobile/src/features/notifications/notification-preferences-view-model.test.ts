import type { NotificationPreferencesDto } from './notification-preferences-contract'
import {
  buildNotificationPreferencePatch,
  getNotificationPreferenceViewState,
  mapNotificationPreferences,
  NOTIFICATION_STREAMS,
} from './notification-preferences-view-model'

describe('getNotificationPreferenceViewState', () => {
  it('is active when stored and effectively enabled', () => {
    expect(getNotificationPreferenceViewState({ effectiveEnabled: true, storedEnabled: true }, false))
      .toEqual({ status: 'active', pauseReason: null, canEnable: true, canChange: true })
  })

  it('is off when not stored, and cannot re-enable a delivery-unsupported stream', () => {
    expect(getNotificationPreferenceViewState({ deliverySupported: false, effectiveEnabled: false, storedEnabled: false }, false))
      .toEqual({ status: 'off', pauseReason: 'delivery', canEnable: false, canChange: false })
  })

  it('distinguishes a marketing-opt-out pause from a generic delivery pause', () => {
    const paused = { effectiveEnabled: false, storedEnabled: true }
    expect(getNotificationPreferenceViewState(paused, true).pauseReason).toBe('marketingOptOut')
    expect(getNotificationPreferenceViewState(paused, false).pauseReason).toBe('generic')
  })

  it('reports a delivery pause on a stored-on but delivery-unsupported stream', () => {
    expect(getNotificationPreferenceViewState({ deliverySupported: false, effectiveEnabled: false, storedEnabled: true }, false))
      .toEqual({ status: 'paused', pauseReason: 'delivery', canEnable: false, canChange: true })
  })
})

describe('buildNotificationPreferencePatch', () => {
  it('maps each stream to its API field', () => {
    expect(buildNotificationPreferencePatch('budgetAlerts', true)).toEqual({ budgetAlertsEnabled: true })
    expect(buildNotificationPreferencePatch('weeklyInsights', false)).toEqual({ weeklyInsightsEnabled: false })
    expect(buildNotificationPreferencePatch('accountRecovery', true)).toEqual({ accountRecoveryEnabled: true })
  })
})

describe('mapNotificationPreferences', () => {
  const preferences: NotificationPreferencesDto = {
    accountRecovery: { effectiveEnabled: true, storedEnabled: true },
    budgetAlerts: { deliverySupported: true, effectiveEnabled: false, storedEnabled: true },
    growth: { effectiveEnabled: false, storedEnabled: false },
    marketingOptOut: true,
      weeklyInsights: { deliverySupported: false, effectiveEnabled: false, storedEnabled: false },
  }

  it('produces one row per stream in fixed order and surfaces the master opt-out', () => {
    const mapped = mapNotificationPreferences(preferences)
    expect(mapped.rows.map((row) => row.stream)).toEqual([...NOTIFICATION_STREAMS])
    expect(mapped.marketingOptOut).toBe(true)
    const budget = mapped.rows.find((row) => row.stream === 'budgetAlerts')!
    expect(budget.storedEnabled).toBe(true)
    // Stored on but not effective while marketing is opted out → paused/marketingOptOut.
    expect(budget.view).toEqual({ status: 'paused', pauseReason: 'marketingOptOut', canEnable: true, canChange: true })
  })
})
