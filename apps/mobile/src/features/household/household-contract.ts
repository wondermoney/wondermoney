import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * A tenant is a household: an owner plus, optionally, one invited partner. Mirrors
 * `HouseholdView`/`InviteValidationView` in core/api's household service — see
 * `api/src/services/household/household-invite.service.ts` and
 * `api/src/controller/household.ts`. Fields the API adds later are stripped, not rejected.
 */

export const HOUSEHOLD_MAX_MEMBERS = 2

// A role this build doesn't know reads as 'unknown': never treated as the owner, so owner-only
// actions stay hidden, and labelled as a member.
const householdRoleSchema = tolerantEnum(['owner', 'member'], 'unknown')

export const householdMemberSchema = z.object({
  appuserKey: z.number().int().positive(),
  emailAddress: z.string().email(),
  firstName: z.string().nullable().optional(),
  role: householdRoleSchema,
})
export type HouseholdMemberDto = z.infer<typeof householdMemberSchema>

export const pendingHouseholdInviteSchema = z.object({
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
  householdInviteKey: z.number().int().positive(),
})
export type PendingHouseholdInviteDto = z.infer<typeof pendingHouseholdInviteSchema>

export const householdResponseSchema = z.object({
  members: z.array(householdMemberSchema),
  pendingInvite: pendingHouseholdInviteSchema.nullable(),
})
export type HouseholdResponseDto = z.infer<typeof householdResponseSchema>

const householdInviteStatusSchema = tolerantEnum(['accepted', 'expired', 'pending', 'revoked'], 'unknown')

const createdInviteSchema = z.object({
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
  householdInviteKey: z.number().int().positive(),
  status: householdInviteStatusSchema,
})

export const inviteMutationResponseSchema = z.object({
  invite: createdInviteSchema,
})

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
