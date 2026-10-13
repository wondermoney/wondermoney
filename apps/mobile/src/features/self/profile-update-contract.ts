import { z } from 'zod'

import { writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Editable identity fields. The API only applies truthy values (it cannot clear a
 * name to empty), so the payload carries trimmed non-empty strings and at least one
 * field must be present.
 */
export const profileNamePayloadSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.firstName !== undefined || value.lastName !== undefined, {
    message: 'At least one name field is required.',
  })

export type ProfileNamePayload = z.infer<typeof profileNamePayloadSchema>

/**
 * `PATCH /v1/user/:userId` updates the authenticated user; the API resolves identity
 * from the session, not the path segment, but the route still requires a segment, so
 * the caller passes the current principal id. `sendStatus(200)` returns a non-JSON
 * body that the transport normalizes to `undefined`.
 */
export function updateProfileNameEndpoint(userId: string) {
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/user/${encodeURIComponent(userId)}`,
    schema: z.undefined(),
    successStatuses: [200],
  })
}
