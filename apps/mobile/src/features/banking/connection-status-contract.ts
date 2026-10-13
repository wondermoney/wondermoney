import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * RAD-231 — read-only bank connection status surface. The DTO is the
 * 6-field shape from RAD-246; `status` stays a closed enum, but the shape
 * is no longer `.strict()` (see below). Nulls are explicit and never
 * inferred.
 *
 * `provider` widened to `'GoCardless' | 'EnableBanking'`: the backend's
 * `GET /v1/banking/connections` now surfaces Enable Banking connections
 * alongside GoCardless requisitions, discriminated by this field. Both map
 * onto the same unchanged 4-value `status` vocabulary.
 *
 * Not `.strict()`: mirrors the fix applied to `start-connection-contract.ts`
 * for the same reason — this validates a cross-repo HTTP response, not our
 * own DTO, so a future additive field on the API side must not hard-fail
 * every row (and therefore the whole list, since one bad array item fails
 * the parse) the way the Enable Banking rollout just did to the `provider`
 * literal. Previously documented as "stricter than the server response on
 * purpose"; that tradeoff is now judged not worth repeating the breakage.
 *
 * RAD-501's `connectionId` — CONFIRMED GONE, NOT COMING BACK: the real
 * `GET /v1/banking/connections` controller (`getBankConnections` /
 * `mapRequisition` / `mapEnableBankingConnection` in api's
 * `banking-connections.ts`) never has and, per RAD-246's deliberate
 * "no entity identifiers in this DTO" decision, never will emit any id on
 * this list — this was a wrong assumption baked in when the field was
 * added, not a field the backend is dropping. It is left in place below
 * (still `nullable().optional()`) purely because it is load-bearing
 * downstream: `use-bank-connection-disconnect-mutation.ts`,
 * `connections-screen.tsx`, and `connections-route.tsx` all key the
 * disconnect action off `row.connectionId`, and there is currently no
 * other identifier this list (or the disconnect DTO) could use instead —
 * removing the field would not "fix" anything, it would just delete the
 * disconnect feature's only handle with no replacement. Worse, the
 * disconnect endpoint this file builds (`DELETE
 * /v1/banking/connections/:connectionId`) does not exist on the real API
 * at all — the only delete route is `DELETE /v1/banking/requisition/:id`
 * (GoCardless-only, no Enable Banking equivalent). Since the real API
 * never sends `connectionId`, every row already normalizes it to `null`
 * and the disconnect button is already unconditionally hidden in
 * production (see `connections-screen.tsx`'s `canDisconnect` check) — so
 * this is a pre-existing, silently-broken feature, not new breakage from
 * this change. Flagging for a product/backend decision rather than
 * guessing a fix: either the read DTO needs a stable, non-leaking id, or
 * the disconnect feature needs to come out.
 */

export const connectionStatusSchema = z.enum(['connected', 'error', 'expired', 'processing'])

export const bankConnectionProviderSchema = z.enum(['GoCardless', 'EnableBanking'])

export const bankConnectionSchema = z
  .object({
    accessType: z.literal('open_banking'),
    connectionId: z.number().int().positive().nullable().optional(),
    dataFreshAsOf: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    institutionName: z.string().nullable(),
    provider: bankConnectionProviderSchema,
    status: connectionStatusSchema,
  })

export const bankConnectionsResponseSchema = z.object({
  connections: z.array(bankConnectionSchema),
})

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>
export type BankConnectionDto = z.infer<typeof bankConnectionSchema>
export type BankConnectionsResponseDto = z.infer<typeof bankConnectionsResponseSchema>

export function createBankConnectionsEndpoint() {
  return readEndpoint({
    method: 'GET',
    path: '/v1/banking/connections',
    schema: bankConnectionsResponseSchema,
  })
}

export const isValidBankConnectionId = (connectionId: number): boolean => (
  Number.isSafeInteger(connectionId) && connectionId > 0
)

/**
 * RAD-501 — disconnect (unsync) a linked bank. Mirrors web's
 * `useDeleteRequisition` (`DELETE /v1/banking/requisition/:requisitionKey`)
 * in spirit but is nested under this vertical's own `/v1/banking/connections`
 * resource, matching how goal archive (`DELETE /v1/goals/:id`) and account
 * delete (`DELETE /v1/account/:id`) already key writes off the read
 * collection's own path rather than a legacy sibling route.
 */
export function createDisconnectBankConnectionEndpoint(connectionId: number) {
  if (!isValidBankConnectionId(connectionId)) throw new Error('A positive safe connection id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/banking/connections/${connectionId}`,
    schema: z.undefined(),
  })
}
