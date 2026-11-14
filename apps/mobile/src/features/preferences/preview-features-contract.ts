import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

import type { DashboardLayoutEntry } from '@wondermoney/shared/dashboard-layout'

/**
 * One home section in the stored `dashboardLayout`. Ids are plain strings: a
 * layout saved by a newer client keeps its unknown ids, and
 * `mergeDashboardLayout` decides what this build can render.
 */
export const dashboardLayoutEntrySchema = z.object({
  id: z.string().min(1),
  hidden: z.boolean(),
})

/**
 * The per-user preferences document (`GET`/`PATCH /v1/user/me/preferences`).
 * `previewFeatures` gates unfinished features; `dashboardLayout` is the home
 * sections' order and visibility, shared with web. An API that predates the
 * layout omits it, which means the default order. `aiHidden` turns every AI
 * feature off for this person; an API that predates it omits it, which reads as
 * not hidden.
 */
export const userPreferencesSchema = z.object({
  aiHidden: z.boolean().default(false),
  previewFeatures: z.boolean(),
  dashboardLayout: z.array(dashboardLayoutEntrySchema).default([]),
})

export type UserPreferencesDto = z.infer<typeof userPreferencesSchema>

/** A partial update: only the keys present are changed. */
export type UserPreferencesPatch = Readonly<{
  aiHidden?: boolean
  previewFeatures?: boolean
  dashboardLayout?: readonly DashboardLayoutEntry[]
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
