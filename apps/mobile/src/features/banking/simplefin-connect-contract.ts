import { z } from 'zod'

import { writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * `POST /v1/banking/simplefin/connections` with `{ setupToken }`. The API claims the one-time
 * setup token from SimpleFIN Bridge, stores the access it is exchanged for encrypted, and queues
 * the first sync. The new connection lists as `processing` in `GET /v1/banking/connections`
 * until that sync brings its accounts in.
 *
 * The token is a credential: it is sent once and never logged, kept or put in a query key.
 *
 * Its 400s carry a `message` the API words for the person (the token is not valid, was already
 * used, or points at a server this instance does not allow), so the endpoint keeps it
 * (`keepsBadRequestMessage`). 501 `feature_disabled`: the operator has SimpleFIN off. 502:
 * SimpleFIN could not be reached.
 */
export const simplefinConnectRequestSchema = z.object({
  setupToken: z.string().trim().min(1),
}).strict()

/** Not `.strict()`: a response from an API that ships on its own schedule. */
export const simplefinConnectResponseSchema = z.object({
  connectionId: z.number().int().positive(),
  incidentId: z.string().min(1).nullable(),
})

export type SimplefinConnectResponseDto = z.infer<typeof simplefinConnectResponseSchema>

export const simplefinConnectEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/banking/simplefin/connections',
  schema: simplefinConnectResponseSchema,
  keepsBadRequestMessage: true,
})
