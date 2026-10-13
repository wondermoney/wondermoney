import { z } from 'zod'

import type { ApiClient } from '@/lib/api/client'
import { writeEndpoint } from '@/lib/api/runtime-schema'

import type { SignupLocale } from './resolve-signup-locale'

const authCallbackResultSchema = z
  .object({ appuserKey: z.union([z.string(), z.number()]).optional() })
  .passthrough()

export type AuthCallbackResult = z.infer<typeof authCallbackResultSchema>

export const authCallbackEndpoint = writeEndpoint<AuthCallbackResult>({
  method: 'POST',
  path: '/v1/auth/callback',
  schema: authCallbackResultSchema,
  successStatuses: [200, 201],
})

export async function provisionAppUser(
  apiClient: ApiClient,
  locale: SignupLocale,
  inviteToken?: string,
): Promise<'provisioned' | 'failed'> {
  try {
    const body = inviteToken ? { inviteToken, locale } : { locale }
    await apiClient.write(authCallbackEndpoint, { body, commit: () => undefined })
    return 'provisioned'
  } catch {
    return 'failed'
  }
}
