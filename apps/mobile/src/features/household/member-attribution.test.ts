import type { TFunction } from 'i18next'

import { createCashflowEndpoint, createCategorySpendingEndpoint } from '@/features/account-insights/insights-contract'
import { cashflowKey } from '@/features/account-insights/query-keys'
import { accountSummarySchema } from '@/features/accounts/accounts-contract'
import { createNetWorthEndpoint, createNetWorthHistoryEndpoint } from '@/features/net-worth/net-worth-contract'
import { createCashflowEndpoint as createCashflowReportEndpoint } from '@/features/reports/reports-contract'
import { aggregateTransactionSchema, transactionFilterParams } from '@/features/transactions/transactions-contract'
import { transactionFixture } from '@/features/transactions/test-fixtures'

import type { HouseholdResponseDto } from './household-contract'
import {
  attributionMark,
  effectiveMemberFilter,
  householdMembersModel,
  memberFilterOptions,
  memberKeysParam,
  parseSpentByToken,
  spentByOptions,
  spentByToken,
} from './member-attribution'

const t = ((key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key)) as unknown as TFunction

const household = (count: number, viewerRole: 'owner' | 'viewer' = 'owner'): HouseholdResponseDto => ({
  members: [
    { appuserKey: 11, emailAddress: 'ana@example.test', firstName: 'Ana', role: viewerRole },
    { appuserKey: 12, emailAddress: 'bruno@example.test', firstName: null, role: 'member' as const },
  ].slice(0, count),
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: 11,
})

describe('household members model', () => {
  it('is multi-member only with more than one member', () => {
    expect(householdMembersModel(household(1)).multiMember).toBe(false)
    expect(householdMembersModel(undefined).multiMember).toBe(false)
    expect(householdMembersModel(household(2)).multiMember).toBe(true)
  })

  it('names members by first name, else email, and marks a viewer read-only', () => {
    const model = householdMembersModel(household(2, 'viewer'))
    expect(model.members.map((member) => member.name)).toEqual(['Ana', 'bruno@example.test'])
    expect(model.readOnly).toBe(true)
    expect(householdMembersModel(household(2)).readOnly).toBe(false)
  })

  it('offers everyone, each member, then Shared', () => {
    expect(memberFilterOptions(householdMembersModel(household(2)), t).map((option) => option.value)).toEqual(['everyone', '11', '12', 'shared'])
  })

  it('drops a filter for someone who is no longer a member, or in a household of one', () => {
    expect(effectiveMemberFilter(12, householdMembersModel(household(2)))).toBe(12)
    expect(effectiveMemberFilter(99, householdMembersModel(household(2)))).toBeNull()
    expect(effectiveMemberFilter('shared', householdMembersModel(household(1)))).toBeNull()
  })
})

describe('member filter params', () => {
  it('sends memberKeys only when a member or Shared is chosen', () => {
    expect(memberKeysParam(null)).toBeUndefined()
    expect(transactionFilterParams({}, 'UTC')).not.toHaveProperty('memberKeys')
    expect(transactionFilterParams({ memberKeys: [12] }, 'UTC')).toMatchObject({ memberKeys: '12' })
    expect(transactionFilterParams({ memberKeys: ['shared'] }, 'UTC')).toMatchObject({ memberKeys: 'shared' })
  })

  it('carries the member to the reports, the dashboard and net worth', () => {
    const report = createCashflowReportEndpoint({ fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-02-01T00:00:00.000Z', memberKeys: ['shared'] })
    expect(new URLSearchParams(report.path.split('?')[1]).get('memberKeys')).toBe('shared')
    const scope = { fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-02-01T00:00:00.000Z' }
    expect(createCashflowEndpoint(scope, '12').path).toContain('memberKeys=12')
    expect(createCashflowEndpoint(scope).path).not.toContain('memberKeys')
    expect(createCategorySpendingEndpoint(scope, 1, 'shared').path).toContain('memberKeys=shared')
    expect(cashflowKey(1, scope, '12')).not.toEqual(cashflowKey(1, scope))
    expect(createNetWorthEndpoint('12').path).toBe('/v1/net-worth?member=12')
    expect(createNetWorthEndpoint().path).toBe('/v1/net-worth')
    expect(createNetWorthHistoryEndpoint(12, 'shared').path).toContain('member=shared')
  })
})

describe('attribution marks', () => {
  const model = householdMembersModel(household(2))

  it('shows the member\'s initial, or Shared for the household', () => {
    expect(attributionMark({ appuserKey: 11, displayName: 'Ana' }, model)).toMatchObject({ kind: 'member', initials: 'A', name: 'Ana' })
    expect(attributionMark({ appuserKey: 12, displayName: null }, model)).toMatchObject({ kind: 'member', initials: 'B' })
    expect(attributionMark({ appuserKey: null, displayName: null }, model)).toEqual({ kind: 'shared' })
  })

  it('shows nothing in a household of one, or without attribution', () => {
    expect(attributionMark({ appuserKey: 11, displayName: 'Ana' }, householdMembersModel(household(1)))).toBeNull()
    expect(attributionMark(null, model)).toBeNull()
  })

  it('reads older API shapes without attribution', () => {
    expect(aggregateTransactionSchema.parse(transactionFixture).attribution ?? null).toBeNull()
    expect(aggregateTransactionSchema.parse({ ...transactionFixture, attribution: 'garbled' }).attribution).toBeNull()
  })
})

describe('spent by', () => {
  const model = householdMembersModel(household(2))

  it('names the account default and lists each member, then Shared', () => {
    expect(spentByOptions(model, { appuserKey: null, displayName: null }, t).map((option) => option.label))
      .toEqual(['memberAttribution.accountDefault(memberAttribution.shared)', 'Ana', 'bruno@example.test', 'memberAttribution.shared'])
    expect(spentByOptions(model, undefined, t)[0]?.label).toBe('memberAttribution.accountDefaultUnnamed')
  })

  it('reads the current choice and turns a choice into the PATCH value', () => {
    expect(spentByToken({ appuserKey: 11, displayName: 'Ana', overridden: false })).toBe('default')
    expect(spentByToken({ appuserKey: null, displayName: null, overridden: true })).toBe('shared')
    expect(spentByToken({ appuserKey: 12, displayName: null, overridden: true })).toBe('12')
    expect(parseSpentByToken('default')).toBeNull()
    expect(parseSpentByToken('shared')).toBe('shared')
    expect(parseSpentByToken('12')).toBe(12)
  })
})

describe('account contract', () => {
  it('reads joint and attribution, and an older API without them', () => {
    const base = {
      accountFinancialInstitutionKey: null, accountKey: 3, accountName: 'Joint', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
      appuserCurrencyBalance: 1, balance: 1, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false, refreshedAt: null, source: 'manual',
    }
    expect(accountSummarySchema.parse({ ...base, isJoint: true, ownerAppuserKey: 11, attribution: { appuserKey: null, displayName: null } }))
      .toMatchObject({ isJoint: true, attribution: { appuserKey: null } })
    const older = accountSummarySchema.parse(base)
    expect(older.isJoint).toBeUndefined()
    expect(older.attribution ?? null).toBeNull()
  })
})
