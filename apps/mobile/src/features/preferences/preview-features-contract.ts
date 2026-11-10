import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * The per-user preferences document (`GET`/`PATCH /v1/user/me/preferences`).
 * `previewFeatures` is the only key today; the API drops keys it does not know.
 */
export const userPreferencesSchema = z.object({
  previewFeatures: z.boolean(),
})

export type UserPreferencesDto = z.infer<typeof userPreferencesSchema>

/** A partial update: only the keys present are changed. */
export type UserPreferencesPatch = Readonly<{
  previewFeatures?: boolean
}>

const PREFERENCES_PATH = '/v1/user/me/preferences'

export const preferencesEndpoint = readEndpoint({
  method: 'GET',
  path: PREFERENCES_PATH,
  schema: userPreferencesSchema,
})

export const updatePreferencesEndpoint = writeEndpoint({
  method: 'PATCH',
  path: PREFERENCES_PATH,
  schema: userPreferencesSchema,
})
