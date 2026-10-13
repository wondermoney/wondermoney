import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

/**
 * RAD-240 — `GET /v1/banking/bank/:bankId/start` is a GET by HTTP method
 * (hence `readEndpoint`, not `writeEndpoint`) but is NOT idempotent: each
 * call creates a new pending Enable Banking authorization server-side.
 * Callers must invoke it through a mutation (see use-start-bank-connection),
 * never through a cached `useQuery`, or refetch/retry semantics would
 * silently spawn duplicate authorizations.
 *
 * The response carries the Enable Banking-hosted consent `redirectUrl` —
 * never log this value (or the response at all); it is a bearer-style,
 * single-use authorization URL.
 *
 * Not `.strict()`: the API currently returns exactly `{ redirectUrl }`
 * (see api's `startBankConnection` controller), but this is a cross-repo
 * HTTP boundary, not our own DTO — an additive field on the backend should
 * not hard-fail every bank-connect attempt on mobile.
 */
export const startBankConnectionResponseSchema = z.object({
  redirectUrl: z.url(),
})

export type StartBankConnectionResponseDto = z.infer<typeof startBankConnectionResponseSchema>

/**
 * The API redirects the browser back to the existing web app after GoCardless
 * consent completes (no native-app callback exists yet — that is a later,
 * separate ticket). `accounts` matches the API's own default redirect page.
 */
const BANK_CONNECTION_REDIRECT_PAGE = 'accounts'

export function createStartBankConnectionEndpoint(bankId: string) {
  const trimmed = bankId.trim()
  if (!trimmed) throw new Error('A bank id is required to start a connection.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/banking/bank/${encodeURIComponent(trimmed)}/start?redirectPage=${encodeURIComponent(BANK_CONNECTION_REDIRECT_PAGE)}`,
    schema: startBankConnectionResponseSchema,
  })
}
