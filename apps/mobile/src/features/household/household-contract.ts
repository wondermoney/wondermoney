import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * A tenant is a household: an owner plus, optionally, one invited partner. Mirrors
 * `HouseholdView`/`InviteValidationView` in core/api's household service — see
 * `api/src/services/household/household-invite.service.ts` and
 * `api/src/controller/household.ts`. Mobile's own convention keeps these `.strict()`
 * even where the API's own schema is not, matching markets-contract.ts.
 */

export const HOUSEHOLD_MAX_MEMBERS = 2

export const householdRoleSchema = z.enum(['owner', 'member'])
export type HouseholdRole = z.infer<typeof householdRoleSchema>

export const householdMemberSchema = z.object({
  appuserKey: z.number().int().positive(),
  emailAddress: z.string().email(),
  firstName: z.string().nullable().optional(),
  role: householdRoleSchema,
}).strict()
export type HouseholdMemberDto = z.infer<typeof householdMemberSchema>

export const pendingHouseholdInviteSchema = z.object({
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
  householdInviteKey: z.number().int().positive(),
}).strict()
export type PendingHouseholdInviteDto = z.infer<typeof pendingHouseholdInviteSchema>

export const householdResponseSchema = z.object({
  members: z.array(householdMemberSchema),
  pendingInvite: pendingHouseholdInviteSchema.nullable(),
}).strict()
export type HouseholdResponseDto = z.infer<typeof householdResponseSchema>

const householdInviteStatusSchema = z.enum(['accepted', 'expired', 'pending', 'revoked'])

const createdInviteSchema = z.object({
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
  householdInviteKey: z.number().int().positive(),
  status: householdInviteStatusSchema,
}).strict()

export const inviteMutationResponseSchema = z.object({
  invite: createdInviteSchema,
}).strict()
export type InviteMutationResponseDto = z.infer<typeof inviteMutationResponseSchema>

/** Mirrors createHouseholdInviteSchema's body validator in api/src/validators/household.ts. */
export const inviteEmailSchema = z.string().trim().toLowerCase().email()

export const isValidHouseholdInviteId = (value: number): boolean => Number.isInteger(value) && value > 0
export const isValidAppuserKey = (value: number): boolean => Number.isInteger(value) && value > 0

export const householdEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/household',
  schema: householdResponseSchema,
})

export const inviteHouseholdMemberEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/household/invites',
  schema: inviteMutationResponseSchema,
  successStatuses: [201],
})

export function createResendHouseholdInviteEndpoint(householdInviteKey: number) {
  if (!isValidHouseholdInviteId(householdInviteKey)) throw new Error('A positive safe household invite id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/household/invites/${householdInviteKey}/resend`,
    schema: inviteMutationResponseSchema,
    successStatuses: [200],
  })
}

export function createRevokeHouseholdInviteEndpoint(householdInviteKey: number) {
  if (!isValidHouseholdInviteId(householdInviteKey)) throw new Error('A positive safe household invite id is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/household/invites/${householdInviteKey}`,
    schema: z.undefined(),
    successStatuses: [200],
  })
}

export function createRemoveHouseholdMemberEndpoint(appuserKey: number) {
  if (!isValidAppuserKey(appuserKey)) throw new Error('A positive safe appuser key is required.')
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/household/members/${appuserKey}`,
    schema: z.undefined(),
    successStatuses: [200],
  })
}
