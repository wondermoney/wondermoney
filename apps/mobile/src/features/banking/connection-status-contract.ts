import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Read-only bank connection status surface. `status`, `provider` and
 * `accessType` read an unknown value as 'unknown' rather than failing the
 * list. Nulls are explicit and never inferred.
 *
 * `provider` covers every provider whose connections the backend's
 * `GET /v1/banking/connections` can list, discriminated by this field. All
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
 * rows send `null`: they have no history endpoint. A SimpleFIN row sends its
 * SimpleFIN connection key, a separate id space with its own history and
 * disconnect routes (`/v1/banking/simplefin/connections/:connectionId`), so a
 * connection is named by its id and its provider together
 * (`BankConnectionTarget`). SimpleFIN has no consent end date (`expiresAt`,
 * `daysUntilExpiry` and `bankId` are null) and no reconnect.
 */

// A status, provider or access type this build doesn't know reads as 'unknown', so one new value
// shows as an "unknown" row instead of failing the whole list.
// `expiring`: the consent ends within 14 days. `revoked`: the bank ended the consent early.
export const connectionStatusSchema = tolerantEnum(['connected', 'error', 'expired', 'expiring', 'processing', 'revoked'], 'unknown')

export const bankConnectionProviderSchema = tolerantEnum(['GoCardless', 'EnableBanking', 'SimpleFIN'], 'unknown')

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
export type BankConnectionProvider = z.infer<typeof bankConnectionProviderSchema>

/**
 * One connection's id together with its provider: a SimpleFIN `connectionId` and an Enable
 * Banking one can be the same number, so the id alone names no connection.
 */
export type BankConnectionTarget = Readonly<{ connectionId: number; provider: BankConnectionProvider }>

export const isSameBankConnection = (a: BankConnectionTarget | null | undefined, b: BankConnectionTarget | null | undefined): boolean => (
  Boolean(a && b && a.connectionId === b.connectionId && a.provider === b.provider)
)
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
 * Disconnect (unsync) a linked bank. A SimpleFIN connection has its own route,
 * `DELETE /v1/banking/simplefin/connections/:connectionId`, which also destroys
 * the stored access. Every other row goes to
 * `DELETE /v1/banking/requisition/:requisitionId`; despite the legacy name, the
 * parameter is the Enable Banking connection key (`unlinkRequisition` resolves
 * an `EnableBankingConnection` by it). Web's `useDeleteRequisition` uses the
 * same route. Both answer 200 with no body the app reads.
 */
export function createDisconnectBankConnectionEndpoint(connectionId: number, provider: BankConnectionProvider = 'EnableBanking') {
  if (!isValidBankConnectionId(connectionId)) throw new Error('A positive safe connection id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: provider === 'SimpleFIN'
      ? `/v1/banking/simplefin/connections/${connectionId}`
      : `/v1/banking/requisition/${connectionId}`,
    schema: z.undefined(),
  })
}
