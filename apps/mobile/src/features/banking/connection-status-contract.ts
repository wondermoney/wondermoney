import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Read-only bank connection status surface. `status`, `provider` and
 * `accessType` read an unknown value as 'unknown' rather than failing the
 * list. Nulls are explicit and never inferred.
 *
 * `provider` covers both providers whose connections the backend's
 * `GET /v1/banking/connections` can list, discriminated by this field. Both
 * map onto the same 4-value `status` vocabulary.
 *
 * Not `.strict()`, same as `start-connection-contract.ts`: this validates a
 * cross-repo HTTP response, not our own DTO, so an additive field on the API
 * side must not hard-fail every row (and therefore the whole list, since one
 * bad array item fails the parse).
 *
 * `connectionId`: the real `GET /v1/banking/connections` controller
 * (`getBankConnections` / `mapRequisition` / `mapEnableBankingConnection` in
 * api's `banking-connections.ts`) deliberately emits no entity identifiers on
 * this list, so the field is always absent. It stays (`nullable().optional()`)
 * because `use-bank-connection-disconnect-mutation.ts`,
 * `connections-screen.tsx`, and `connections-route.tsx` key the disconnect
 * action off `row.connectionId`, and there is no other identifier to use.
 * The disconnect endpoint this file builds (`DELETE
 * /v1/banking/connections/:connectionId`) does not exist on the real API —
 * the only delete route is `DELETE /v1/banking/requisition/:id`. Since every
 * row normalizes `connectionId` to `null`, the disconnect button is always
 * hidden (see `connections-screen.tsx`'s `canDisconnect` check). Open product/
 * backend decision: either the read DTO needs a stable, non-leaking id, or the
 * disconnect feature needs to come out.
 */

// A status, provider or access type this build doesn't know reads as 'unknown', so one new value
// shows as an "unknown" row instead of failing the whole list.
export const connectionStatusSchema = tolerantEnum(['connected', 'error', 'expired', 'processing'], 'unknown')

export const bankConnectionProviderSchema = tolerantEnum(['GoCardless', 'EnableBanking'], 'unknown')

export const bankConnectionSchema = z
  .object({
    accessType: tolerantEnum(['open_banking'], 'unknown'),
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
 * Disconnect (unsync) a linked bank. Mirrors web's
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
