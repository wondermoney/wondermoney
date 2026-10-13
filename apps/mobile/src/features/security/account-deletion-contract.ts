import { z } from 'zod'

import { writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Irreversible deletion of the authenticated WonderMoney account.
 *
 * The authoritative API responds `204 No Content`; there is no response body and no
 * client-provided payload. Deletion is distinct from sign-out and from bank
 * disconnection — it permanently retires the account server-side.
 */
export const deleteAccountEndpoint = writeEndpoint({
  method: 'DELETE',
  path: '/v1/user/me',
  schema: z.undefined(),
  successStatuses: [204],
})
