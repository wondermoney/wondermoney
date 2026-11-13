import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '../../lib/api/runtime-schema'

import { isValidAccountId } from './accounts-contract'

/**
 * Who sees an account, per household member (#95). `isPrivate: false` is "shared with the
 * household": everyone can edit it (viewers can view it), share rows are ignored. `isPrivate:
 * true`: only the account owner and the members with a share (`read` "Can view", `write` "Can
 * edit"); everyone else has it hidden. A household viewer is read-only whatever the share says.
 */
export const accountShareMemberSchema = z.object({
  appuserKey: z.number().int().positive(),
  firstName: z.string().max(255).nullish().catch(null),
  lastName: z.string().max(255).nullish().catch(null),
  // A role this build doesn't know is offered the full choice; the server clamps it anyway.
  role: tolerantEnum(['owner', 'admin', 'member', 'viewer'], 'member'),
  isAccountOwner: z.boolean(),
  share: tolerantEnum(['read', 'write'], null).nullable(),
  access: tolerantEnum(['owner', 'write', 'read', 'hidden'], 'hidden'),
})

export const accountSharesResponseSchema = z.object({
  accountKey: z.number().int().positive(),
  isPrivate: z.boolean(),
  /** The account owner or the household owner; anyone else sees the list read-only. */
  canManage: z.boolean(),
  members: z.array(accountShareMemberSchema),
})

export type AccountShareMemberDto = z.infer<typeof accountShareMemberSchema>
export type AccountSharesDto = z.infer<typeof accountSharesResponseSchema>

/** The PUT body. Strict, because it builds a request. */
export const accountSharesWriteSchema = z.object({
  isPrivate: z.boolean(),
  shares: z.array(z.object({
    appuserKey: z.number().int().positive(),
    access: z.enum(['read', 'write']),
  }).strict()),
}).strict()

export type AccountSharesWrite = z.infer<typeof accountSharesWriteSchema>

export function createAccountSharesEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return readEndpoint({ method: 'GET', path: `/v1/account/${accountId}/shares`, schema: accountSharesResponseSchema })
}

export function createUpdateAccountSharesEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({ method: 'PUT', path: `/v1/account/${accountId}/shares`, schema: accountSharesResponseSchema })
}

/** One member's place in the per-member control: Hidden, Can view or Can edit. */
export type ShareChoice = 'hidden' | 'read' | 'write'
/** Each member other than the account owner, by `appuserKey`. */
export type ShareChoices = Readonly<Record<number, ShareChoice>>

/** What a member can be given: a household viewer is read-only, so never Can edit. */
export const shareChoicesFor = (member: Pick<AccountShareMemberDto, 'role'>): readonly ShareChoice[] => (
  member.role === 'viewer' ? ['hidden', 'read'] : ['hidden', 'read', 'write']
)

const mostFor = (member: Pick<AccountShareMemberDto, 'role'>): ShareChoice => (member.role === 'viewer' ? 'read' : 'write')

/** The members the control lists, in the server's order: everyone but the account owner. */
export const shareableMembers = (dto: Pick<AccountSharesDto, 'members'>): readonly AccountShareMemberDto[] => (
  dto.members.filter((member) => !member.isAccountOwner)
)

/** A choice the member can hold, clamped: Can edit for a viewer reads as Can view. */
const clamp = (member: AccountShareMemberDto, choice: ShareChoice | undefined): ShareChoice => {
  if (choice === undefined) return 'hidden'
  return choice === 'write' && member.role === 'viewer' ? 'read' : choice
}

/** The control's opening state: each member's effective access. */
export function initialShareChoices(dto: AccountSharesDto): ShareChoices {
  return Object.fromEntries(shareableMembers(dto).map((member) => {
    const effective: ShareChoice = member.access === 'write' || member.access === 'owner' ? 'write' : member.access === 'read' ? 'read' : 'hidden'
    return [member.appuserKey, clamp(member, effective)]
  }))
}

/**
 * The PUT body for the control's state. Everyone at their most (Can edit, a viewer Can view) is
 * the account shared with the household, which also lets people who join later edit it;
 * otherwise it is private with the members who can view or edit (Hidden ones left out). With
 * nobody else in the household the control is a plain private toggle (`privateToggle`, which
 * defaults to the account's current state).
 */
export function buildAccountSharesWrite(dto: AccountSharesDto, choices: ShareChoices, privateToggle?: boolean): AccountSharesWrite {
  const members = shareableMembers(dto)
  if (members.length === 0) return { isPrivate: privateToggle ?? dto.isPrivate, shares: [] }
  const chosen = members.map((member) => ({ member, choice: clamp(member, choices[member.appuserKey]) }))
  if (chosen.every(({ member, choice }) => choice === mostFor(member))) return { isPrivate: false, shares: [] }
  return {
    isPrivate: true,
    shares: chosen.flatMap(({ member, choice }) => (choice === 'hidden' ? [] : [{ appuserKey: member.appuserKey, access: choice }])),
  }
}

/** Whether two control states differ for any member. */
export const shareChoicesDiffer = (dto: AccountSharesDto, left: ShareChoices, right: ShareChoices): boolean => (
  shareableMembers(dto).some((member) => clamp(member, left[member.appuserKey]) !== clamp(member, right[member.appuserKey]))
)
