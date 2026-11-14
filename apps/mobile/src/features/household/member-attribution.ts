import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { HouseholdMemberDto, HouseholdResponseDto, HouseholdRoleValue } from './household-contract'
import { householdMemberInitials, householdMemberLabel } from './household-view-models'

/**
 * Who money belongs to inside a household (issue #96). An account is its owner's, or Shared when
 * it is joint (or its owner left); a transaction follows its account unless it sets its own
 * "Spent by". `appuserKey: null` is always Shared, the household as a whole.
 *
 * Every member surface (filter, badges, "Spent by", the joint switch) shows only in a household
 * with more than one member, and every field here is optional on the wire: an older API that
 * sends none of them reads as no attribution, and the app shows nothing new.
 */

const attributionKey = z.number().int().positive().nullable()

export const accountAttributionSchema = z.object({
  appuserKey: attributionKey,
  displayName: z.string().max(255).nullable(),
})
export type AccountAttributionDto = z.infer<typeof accountAttributionSchema>

export const transactionAttributionSchema = accountAttributionSchema.extend({
  /** The transaction sets its own "Spent by"; false: it follows its account. */
  overridden: z.boolean(),
})
export type TransactionAttributionDto = z.infer<typeof transactionAttributionSchema>

/** The literal the API reads as the household's shared money, in filters and in "Spent by". */
export const SHARED_MEMBER = 'shared'

/** One member, or Shared; `null` is everyone (no filter). */
export type MemberFilter = number | typeof SHARED_MEMBER | null

export type HouseholdMemberOption = Readonly<{ appuserKey: number; name: string; initials: string }>

export type HouseholdMembersModel = Readonly<{
  members: readonly HouseholdMemberOption[]
  /** More than one member: the only case any member surface shows. */
  multiMember: boolean
  viewerAppuserKey: number | null
  viewerRole: HouseholdRoleValue | null
  /** A household viewer reads only; they are offered no "Spent by" change. */
  readOnly: boolean
}>

export const NO_HOUSEHOLD_MEMBERS: HouseholdMembersModel = { members: [], multiMember: false, viewerAppuserKey: null, viewerRole: null, readOnly: false }

const optionOf = (member: Pick<HouseholdMemberDto, 'appuserKey' | 'firstName' | 'emailAddress'>): HouseholdMemberOption => ({
  appuserKey: member.appuserKey,
  name: householdMemberLabel(member),
  initials: householdMemberInitials(member),
})

/** The household as the member surfaces need it; no household (loading, failed) is one member. */
export function householdMembersModel(household: HouseholdResponseDto | undefined | null): HouseholdMembersModel {
  if (!household) return NO_HOUSEHOLD_MEMBERS
  const viewer = household.viewerAppuserKey === null ? null : household.members.find((member) => member.appuserKey === household.viewerAppuserKey) ?? null
  return {
    members: household.members.map(optionOf),
    multiMember: household.members.length > 1,
    viewerAppuserKey: household.viewerAppuserKey,
    viewerRole: viewer?.role ?? null,
    readOnly: viewer?.role === 'viewer',
  }
}

/** `memberKeys` for the lists, reports and dashboard; undefined sends nothing (everyone). */
export const memberKeysParam = (filter: MemberFilter): string | undefined => (filter === null ? undefined : String(filter))

/** A filter that names someone no longer in the household reads as everyone. */
export function effectiveMemberFilter(filter: MemberFilter, model: HouseholdMembersModel): MemberFilter {
  if (!model.multiMember || filter === null) return null
  if (filter === SHARED_MEMBER) return filter
  return model.members.some((member) => member.appuserKey === filter) ? filter : null
}

/** The filter as a sheet value: `everyone`, `shared` or a member's key. */
export type MemberFilterToken = 'everyone' | typeof SHARED_MEMBER | `${number}`

export const memberFilterToken = (filter: MemberFilter): MemberFilterToken => (filter === null ? 'everyone' : filter === SHARED_MEMBER ? SHARED_MEMBER : `${filter}`)

export function parseMemberFilterToken(token: string): MemberFilter {
  if (token === SHARED_MEMBER) return SHARED_MEMBER
  const key = Number(token)
  return Number.isSafeInteger(key) && key > 0 ? key : null
}

type Translate = TFunction

export function memberFilterOptions(model: HouseholdMembersModel, t: Translate): readonly Readonly<{ value: MemberFilterToken; label: string }>[] {
  return [
    { value: 'everyone', label: t('memberAttribution.everyone') },
    ...model.members.map((member) => ({ value: `${member.appuserKey}` as const, label: member.name })),
    { value: SHARED_MEMBER, label: t('memberAttribution.shared') },
  ]
}

export function memberFilterLabel(filter: MemberFilter, model: HouseholdMembersModel, t: Translate): string {
  if (filter === null) return t('memberAttribution.everyone')
  if (filter === SHARED_MEMBER) return t('memberAttribution.shared')
  return model.members.find((member) => member.appuserKey === filter)?.name ?? t('memberAttribution.everyone')
}

/** A row's member badge: the member's initials, or Shared; null draws none. */
export type AttributionMark =
  | Readonly<{ kind: 'member'; appuserKey: number; name: string; initials: string }>
  | Readonly<{ kind: 'shared' }>

export function attributionMark(attribution: AccountAttributionDto | null | undefined, model: HouseholdMembersModel): AttributionMark | null {
  if (!model.multiMember || !attribution) return null
  if (attribution.appuserKey === null) return { kind: 'shared' }
  const member = model.members.find((candidate) => candidate.appuserKey === attribution.appuserKey)
  if (member) return { kind: 'member', appuserKey: member.appuserKey, name: member.name, initials: member.initials }
  const name = attribution.displayName?.trim()
  // Someone this household list doesn't name (yet): their name from the row, or nothing to say.
  if (!name) return null
  return { kind: 'member', appuserKey: attribution.appuserKey, name, initials: name[0]?.toUpperCase() ?? '?' }
}

export const attributionName = (mark: AttributionMark, t: Translate): string => (mark.kind === 'shared' ? t('memberAttribution.shared') : mark.name)

/**
 * "Spent by" as a sheet value: `default` follows the account again, `shared` is the household,
 * a key is that member.
 */
export type SpentByToken = 'default' | typeof SHARED_MEMBER | `${number}`
/** The PATCH value: a member, Shared, or null (back to the account's default). */
export type SpentByValue = number | typeof SHARED_MEMBER | null

export function spentByToken(attribution: TransactionAttributionDto | null | undefined): SpentByToken {
  if (!attribution?.overridden) return 'default'
  return attribution.appuserKey === null ? SHARED_MEMBER : `${attribution.appuserKey}`
}

export function parseSpentByToken(token: string): SpentByValue {
  if (token === 'default') return null
  if (token === SHARED_MEMBER) return SHARED_MEMBER
  const key = Number(token)
  if (!Number.isSafeInteger(key) || key <= 0) throw new Error('A member key, "shared" or the account default is required.')
  return key
}

/**
 * The choices: the account's default (named when it is known), each member, then Shared.
 * `accountDefault` is the account's own attribution; unknown, the default is not named.
 */
export function spentByOptions(model: HouseholdMembersModel, accountDefault: AccountAttributionDto | null | undefined, t: Translate): readonly Readonly<{ value: SpentByToken; label: string }>[] {
  const defaultMark = accountDefault ? attributionMark(accountDefault, model) : null
  return [
    {
      value: 'default',
      label: defaultMark ? t('memberAttribution.accountDefault', { name: attributionName(defaultMark, t) }) : t('memberAttribution.accountDefaultUnnamed'),
    },
    ...model.members.map((member) => ({ value: `${member.appuserKey}` as const, label: member.name })),
    { value: SHARED_MEMBER, label: t('memberAttribution.shared') },
  ]
}
