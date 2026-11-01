import { z } from 'zod'

import type { HttpTransport } from '@/lib/api/client'

/**
 * `GET /v1/household/invites/validate` is the one endpoint a signed-out device calls —
 * pre-signup, before there is any session to attach a Bearer token to. It is deliberately
 * called through the raw `HttpTransport` rather than the authenticated `ApiClient`, which
 * has no unauthenticated path.
 */
export const inviteValidationSchema = z.object({
  email: z.string(),
  expiresAt: z.iso.datetime(),
  inviterName: z.string().nullable(),
})

export type InviteValidationDto = z.infer<typeof inviteValidationSchema>

export type ValidateInviteOutcome =
  | { status: 'valid'; invite: InviteValidationDto }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export async function validateHouseholdInviteToken(
  transport: HttpTransport,
  token: string,
): Promise<ValidateInviteOutcome> {
  try {
    const response = await transport.request({
      method: 'GET',
      path: `/v1/household/invites/validate?token=${encodeURIComponent(token)}`,
      headers: {},
      signal: new AbortController().signal,
      tokenGeneration: 0,
      authAttempt: 0,
    })
    if (response.status === 200) {
      const parsed = inviteValidationSchema.safeParse(response.body)
      return parsed.success ? { status: 'valid', invite: parsed.data } : { status: 'unavailable' }
    }
    if (response.status >= 400 && response.status < 500) return { status: 'invalid' }
    return { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}
