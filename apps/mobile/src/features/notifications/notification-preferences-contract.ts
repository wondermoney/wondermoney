import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Email notification preferences, mirroring the API's
 * `EmailNotificationPreferenceState`. `budgetAlerts` and `weeklyInsights` are
 * delivery-gated streams (they carry `deliverySupported`); the other categories
 * are ungated toggles. `marketingOptOut` is the account-level master switch.
 */
const categoryStateSchema = z.object({
  effectiveEnabled: z.boolean(),
  storedEnabled: z.boolean(),
})

const streamStateSchema = z.object({
  deliverySupported: z.boolean(),
  effectiveEnabled: z.boolean(),
  storedEnabled: z.boolean(),
})

export const notificationPreferencesSchema = z.object({
  accountRecovery: categoryStateSchema,
  budgetAlerts: streamStateSchema,
  growth: categoryStateSchema,
  marketingOptOut: z.boolean(),
  weeklyInsights: streamStateSchema,
})

export type CategoryStateDto = z.infer<typeof categoryStateSchema>
export type StreamStateDto = z.infer<typeof streamStateSchema>
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>

/** Partial patch accepted by the API; at least one field must be present. */
export type NotificationPreferencePatch = Readonly<{
  accountRecoveryEnabled?: boolean
  budgetAlertsEnabled?: boolean
  growthEmailsEnabled?: boolean
  marketingOptOut?: boolean
  weeklyInsightsEnabled?: boolean
}>

const PREFERENCES_PATH = '/v1/user/me/email-notification-preferences'

export const notificationPreferencesEndpoint = readEndpoint({
  method: 'GET',
  path: PREFERENCES_PATH,
  schema: notificationPreferencesSchema,
})

export const updateNotificationPreferencesEndpoint = writeEndpoint({
  method: 'PATCH',
  path: PREFERENCES_PATH,
  schema: notificationPreferencesSchema,
})
