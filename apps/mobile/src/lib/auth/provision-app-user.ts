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
    await postCallback(apiClient, locale, inviteToken)
    return 'provisioned'
  } catch (error) {
    if (locale === 'it' && isLocaleRejected(error)) return provisionAppUser(apiClient, 'en', inviteToken)
    return isTransient(error) ? 'unavailable' : 'failed'
  }
}

/*
 * A server without the Italian account language rejects `it` in the request's locale enum: a
 * plain validation 400 (`bad_request`) before the callback runs, which would sign the person
 * out on every launch. The app then asks once more in English: an existing account keeps its
 * language, and a new one starts in English, the language that server's web app would have
 * given it. Every other refusal stands, a 400 with its own code above all: the unverified
 * reconnect (`account_reconnect_email_unverified`) has already sent an email, and asking again
 * would send a second one.
 */
const isLocaleRejected = (error: unknown): boolean => (
  error instanceof ApiError && error.code === 'http' && error.status === 400 && error.serverCode === 'bad_request'
)

function postCallback(apiClient: ApiClient, locale: SignupLocale, inviteToken?: string) {
  const body = inviteToken ? { inviteToken, locale } : { locale }
  return apiClient.write(authCallbackEndpoint, { body, commit: () => undefined })
}
