import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

export const profileSchema = z.object({
  emailAddress: z.string().email().max(320),
  firstName: z.string().max(255).nullable(),
  lastName: z.string().max(255).nullable(),
  mfaEnabled: z.boolean(),
})

export const profileResponseSchema = z.object({ profile: profileSchema })

export type ProfileDto = z.infer<typeof profileSchema>
export type ProfileResponseDto = z.infer<typeof profileResponseSchema>

export const profileEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/user/me/profile',
  schema: profileResponseSchema,
})
