import { z } from 'zod'

import type { ApiClient } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
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

/**
 * A failure that says nothing about the account or the session: the server could not be
 * reached, was down, or asked the app to back off. The caller must keep the session.
 */
const isTransient = (error: unknown): boolean => (
  error instanceof ApiError
  && (error.code === 'network'
    || (error.code === 'http' && error.status !== undefined && (error.status >= 500 || error.status === 429)))
)

/**
 * `failed`: the server refused to provision this user (the session should not be used).
 * `unavailable`: a transient failure; the stored session is still valid and must survive it.
 */
export type ProvisionOutcome = 'provisioned' | 'failed' | 'unavailable'

export async function provisionAppUser(
  apiClient: ApiClient,
  locale: SignupLocale,
  inviteToken?: string,
): Promise<ProvisionOutcome> {
  try {
    const body = inviteToken ? { inviteToken, locale } : { locale }
    await apiClient.write(authCallbackEndpoint, { body, commit: () => undefined })
    return 'provisioned'
  } catch (error) {
    return isTransient(error) ? 'unavailable' : 'failed'
  }
}
