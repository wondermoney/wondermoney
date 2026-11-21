import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * The person's choice about service analytics (`GET`/`PUT /v1/user/me/service-analytics`): the
 * pseudonymous events the API records on legitimate interest. `available` is false on a server
 * that records none, where the switch is not shown.
 */
export const serviceAnalyticsSchema = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
})

export type ServiceAnalyticsDto = z.infer<typeof serviceAnalyticsSchema>

const SERVICE_ANALYTICS_PATH = '/v1/user/me/service-analytics'

export const serviceAnalyticsEndpoint = readEndpoint({
  method: 'GET',
  path: SERVICE_ANALYTICS_PATH,
  schema: serviceAnalyticsSchema,
})

export const updateServiceAnalyticsEndpoint = writeEndpoint({
  method: 'PUT',
  path: SERVICE_ANALYTICS_PATH,
  schema: serviceAnalyticsSchema,
})
