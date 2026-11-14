import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Push notifications, mirroring the API's `/v1/user/me/push-*` routes. Each push category is its
 * own switch beside the email one, off until the person turns it on here.
 */
export const PUSH_CATEGORIES = ['budgetAlerts', 'creditCardDueReminders', 'bankSyncAlerts'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]

export const pushPreferencesSchema = z.object({
  bankSyncAlerts: z.boolean(),
  budgetAlerts: z.boolean(),
  creditCardDueReminders: z.boolean(),
})

export type PushPreferencesDto = z.infer<typeof pushPreferencesSchema>
export type PushPreferencePatch = Readonly<Partial<PushPreferencesDto>>

export type PushDeviceRegistration = Readonly<{
  appVersion?: string
  platform: 'android' | 'ios'
  token: string
}>

const PREFERENCES_PATH = '/v1/user/me/push-preferences'

export const pushPreferencesEndpoint = readEndpoint({ method: 'GET', path: PREFERENCES_PATH, schema: pushPreferencesSchema })

export const updatePushPreferencesEndpoint = writeEndpoint({ method: 'PATCH', path: PREFERENCES_PATH, schema: pushPreferencesSchema })

export const registerPushDeviceEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/user/me/push-devices',
  schema: z.undefined(),
  successStatuses: [204],
})

export const sendTestPushEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/user/me/push-test',
  schema: z.object({ status: z.string() }),
  successStatuses: [202],
})
