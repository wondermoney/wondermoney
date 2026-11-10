import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Read-only bank connection status surface. `status`, `provider` and
 * `accessType` read an unknown value as 'unknown' rather than failing the
 * list. Nulls are explicit and never inferred.
 *
 * `provider` covers both providers whose connections the backend's
 * `GET /v1/banking/connections` can list, discriminated by this field. Both
 * map onto the same `status` vocabulary.
 *
 * Not `.strict()`, same as `start-connection-contract.ts`: this validates a
 * cross-repo HTTP response, not our own DTO, so an additive field on the API
 * side must not hard-fail every row (and therefore the whole list, since one
 * bad array item fails the parse).
 *
 * `connectionId`: the real `GET /v1/banking/connections` controller
 * (`getBankConnections` / `mapRequisition` / `mapEnableBankingConnection` in
 * api's `banking-connections.ts`) sends the Enable Banking connection key, so a
 * row can offer its sync history and its disconnect action. Legacy GoCardless
 * rows send `null`: they have no history endpoint.
 */

// A status, provider or access type this build doesn't know reads as 'unknown', so one new value
// shows as an "unknown" row instead of failing the whole list.
// `expiring`: the consent ends within 14 days. `revoked`: the bank ended the consent early.
export const connectionStatusSchema = tolerantEnum(['connected', 'error', 'expired', 'expiring', 'processing', 'revoked'], 'unknown')

export const bankConnectionProviderSchema = tolerantEnum(['GoCardless', 'EnableBanking'], 'unknown')

/**
 * The newest failure for a connection. `code` is the shared bank-sync vocabulary
 * (`@wondermoney/shared/bank-sync`); the client translates it and never shows a
 * provider message.
 */
export const bankSyncLastErrorSchema = z.object({
  code: z.string().min(1),
  occurredAt: z.string().datetime(),
})

export const bankConnectionSchema = z
  .object({
    accessType: tolerantEnum(['open_banking'], 'unknown'),
    // The id `GET /v1/banking/bank/:bankId/start` takes, so the row can offer "Reconnect".
    // Optional: an older API does not send it, and then the row has no reconnect action.
    bankId: z.string().min(1).nullable().optional(),
    connectionId: z.number().int().positive().nullable().optional(),
    dataFreshAsOf: z.string().datetime().nullable(),
    daysUntilExpiry: z.number().int().nonnegative().nullable().optional(),
    expiresAt: z.string().datetime().nullable(),
    institutionName: z.string().nullable(),
    lastError: bankSyncLastErrorSchema.nullable().optional(),
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
 * Disconnect (unsync) a linked bank. The API's only delete route is
 * `DELETE /v1/banking/requisition/:requisitionId`; despite the legacy name, the
 * parameter is the Enable Banking connection key (`unlinkRequisition` resolves
 * an `EnableBankingConnection` by it). Web's `useDeleteRequisition` uses the
 * same route.
 */
export function createDisconnectBankConnectionEndpoint(connectionId: number) {
  if (!isValidBankConnectionId(connectionId)) throw new Error('A positive safe connection id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/banking/requisition/${connectionId}`,
    schema: z.undefined(),
  })
}
