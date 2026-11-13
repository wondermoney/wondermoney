import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * A tenant is a household: one owner plus the members they (or an admin) invite, each with a
 * role. Mirrors `HouseholdView` in the API's household service and the routes in
 * `api/src/controller/household.ts`. Fields the API adds later are stripped, not rejected, and
 * a response from an older API (two members at most, roles owner/member, one `pendingInvite`)
 * still parses: see `normalizeHousehold`.
 */

/** The cap an older API enforced (owner plus one partner) and never sent. */
export const LEGACY_HOUSEHOLD_MAX_MEMBERS = 2

export const HOUSEHOLD_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number]
/** The roles a manager can grant (by invite or role change); `owner` moves only by transfer. */
export const GRANTABLE_HOUSEHOLD_ROLES = ['admin', 'member', 'viewer'] as const
export type GrantableHouseholdRole = (typeof GRANTABLE_HOUSEHOLD_ROLES)[number]

// A role this build doesn't know reads as 'unknown': ranked below every known role, so it is
// never treated as a manager and no action on it is offered.
const householdRoleSchema = tolerantEnum(HOUSEHOLD_ROLES, 'unknown')
export type HouseholdRoleValue = z.infer<typeof householdRoleSchema>

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
  // An older API sent no role on its one invite, which was always for a partner (member).
  role: householdRoleSchema.optional(),
})
export type PendingHouseholdInviteDto = z.infer<typeof pendingHouseholdInviteSchema>

const householdWireSchema = z.object({
  members: z.array(householdMemberSchema),
  maxMembers: z.number().int().positive().optional(),
  pendingInvites: z.array(pendingHouseholdInviteSchema).optional(),
  /** Deprecated by the API (the first of `pendingInvites`); read only when the list is absent. */
  pendingInvite: pendingHouseholdInviteSchema.nullable().optional(),
  viewerAppuserKey: z.number().int().positive().optional(),
})

export type HouseholdInvite = Readonly<{
  email: string
  expiresAt: string
  householdInviteKey: number
  role: HouseholdRoleValue
}>

export type HouseholdResponseDto = Readonly<{
  members: readonly HouseholdMemberDto[]
  maxMembers: number
  pendingInvites: readonly HouseholdInvite[]
  viewerAppuserKey: number | null
}>

/** One shape for every API version: the list of invites, the cap and "me" are always present. */
export function normalizeHousehold(wire: z.infer<typeof householdWireSchema>): HouseholdResponseDto {
  const invites = wire.pendingInvites ?? (wire.pendingInvite ? [wire.pendingInvite] : [])
  return {
    members: wire.members,
    maxMembers: wire.maxMembers ?? LEGACY_HOUSEHOLD_MAX_MEMBERS,
    pendingInvites: invites.map((invite) => ({
      email: invite.email,
      expiresAt: invite.expiresAt,
      householdInviteKey: invite.householdInviteKey,
      role: invite.role ?? 'member',
    })),
    viewerAppuserKey: wire.viewerAppuserKey ?? null,
  }
}

export const householdResponseSchema: z.ZodType<HouseholdResponseDto> = householdWireSchema.transform(normalizeHousehold)

const householdInviteStatusSchema = tolerantEnum(['accepted', 'expired', 'pending', 'revoked'], 'unknown')

const createdInviteSchema = z.object({
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
  householdInviteKey: z.number().int().positive(),
  role: householdRoleSchema.optional(),
  status: householdInviteStatusSchema,
})

export const inviteMutationResponseSchema = z.object({
  invite: createdInviteSchema,
})

export const updatedMemberResponseSchema = z.object({
  member: householdMemberSchema,
})

/** Mirrors createHouseholdInviteSchema's body validator in api/src/validators/household.ts. */
export const inviteEmailSchema = z.string().trim().toLowerCase().email()
export const grantableRoleSchema = z.enum(GRANTABLE_HOUSEHOLD_ROLES)

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

/** PATCH a member's role; body `{ role }`. */
export function createUpdateHouseholdMemberRoleEndpoint(appuserKey: number) {
  if (!isValidAppuserKey(appuserKey)) throw new Error('A positive safe appuser key is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/household/members/${appuserKey}`,
    schema: updatedMemberResponseSchema,
    successStatuses: [200],
  })
}

/** Owner only; body `{ appuserKey }`. Answers with the household after the change. */
export const transferHouseholdOwnershipEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/household/transfer-ownership',
  schema: householdResponseSchema,
  successStatuses: [200],
})

/**
 * The signed-in person's explicit "Join" on an invite: no body, an empty 200. The token is the
 * one from the invite link; it is URL-encoded into the path and never logged.
 */
export function createAcceptHouseholdInviteEndpoint(token: string) {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('An invite token is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/household/invites/${encodeURIComponent(trimmed)}/accept`,
    schema: z.undefined(),
    successStatuses: [200, 204],
  })
}
