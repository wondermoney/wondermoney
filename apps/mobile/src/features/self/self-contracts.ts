import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '@/lib/api/runtime-schema'

export const profileSchema = z.object({
  // `instance` when this person's household may link a bank with the server's shared Enable
  // Banking credential; `user` when they need a key of their own. Absent on an older server.
  bankSyncCredentials: tolerantEnum(['instance', 'user'], 'user').optional(),
  emailAddress: z.string().email().max(320),
  firstName: z.string().max(255).nullable(),
  lastName: z.string().max(255).nullable(),
  mfaEnabled: z.boolean(),
  // The server's shared read-only demo account. Absent on an older server: not the demo.
  demo: z.boolean().optional(),
})

export const profileResponseSchema = z.object({ profile: profileSchema })

export type ProfileDto = z.infer<typeof profileSchema>

export const profileEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/user/me/profile',
  schema: profileResponseSchema,
})
