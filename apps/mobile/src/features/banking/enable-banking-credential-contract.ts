import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

/**
 * The signed-in person's own Enable Banking key, as far as the connect screen needs it: whether
 * one is active. `GET /v1/user/enable-banking-credential` answers null when they have none and
 * never returns key material. Adding a key happens in the web app's Settings.
 */
export const enableBankingCredentialSchema = z.object({ status: z.string() }).nullable()

export const enableBankingCredentialEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/user/enable-banking-credential',
  schema: enableBankingCredentialSchema,
})
