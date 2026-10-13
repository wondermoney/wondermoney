import {
  notificationPreferencesEndpoint,
  notificationPreferencesSchema,
  updateNotificationPreferencesEndpoint,
} from './notification-preferences-contract'

const valid = {
  accountRecovery: { effectiveEnabled: true, storedEnabled: true },
  budgetAlerts: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
  growth: { effectiveEnabled: false, storedEnabled: false },
  marketingOptOut: false,
  weeklyInsights: { deliverySupported: false, effectiveEnabled: false, storedEnabled: true },
}

describe('notification preferences contract', () => {
  it('reads and writes the same self-scoped endpoint path', () => {
    expect(notificationPreferencesEndpoint.method).toBe('GET')
    expect(notificationPreferencesEndpoint.path).toBe('/v1/user/me/email-notification-preferences')
    expect(updateNotificationPreferencesEndpoint.method).toBe('PATCH')
    expect(updateNotificationPreferencesEndpoint.path).toBe('/v1/user/me/email-notification-preferences')
  })

  it('accepts the authoritative state shape', () => {
    expect(notificationPreferencesSchema.parse(valid)).toEqual(valid)
  })

  it('requires delivery gating only on the stream categories', () => {
    expect(notificationPreferencesSchema.safeParse({ ...valid, budgetAlerts: { effectiveEnabled: true, storedEnabled: true } }).success).toBe(false)
    // Ungated categories must not carry a delivery flag requirement.
    expect(notificationPreferencesSchema.safeParse({ ...valid, growth: { effectiveEnabled: false, storedEnabled: false } }).success).toBe(true)
  })

  it('rejects a non-boolean marketing opt-out', () => {
    expect(notificationPreferencesSchema.safeParse({ ...valid, marketingOptOut: 'no' }).success).toBe(false)
  })
})
