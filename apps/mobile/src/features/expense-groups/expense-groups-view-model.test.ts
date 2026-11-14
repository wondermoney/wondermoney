import { mapTransactions } from '@/features/transactions/transactions-view-model'
import { transactionFixture } from '@/features/transactions/test-fixtures'
import { ApiError } from '@/lib/api/errors'

import {
  allocateByWeights,
  balanceStanding,
  canLinkSettlement,
  canSplitWithGroup,
  classifyGroupFailure,
  defaultPayer,
  describePayment,
  draftFromExpense,
  groupShareOf,
  householdCandidates,
  isHouseholdViewer,
  previewShares,
  readSettlementAmount,
  startShareDraft,
  toShareLines,
  yourBalances,
} from './expense-groups-view-model'
import { expenseFixture, groupFixture, groupMembers, member } from './test-fixtures'

const units = (value: string) => BigInt(Math.round(Number(value) * 10_000))
const people = (...values: string[]) => values.map((value, index) => ({ memberId: index + 1, value }))

describe('sharing an amount', () => {
  it('shares equally to the cent, the remainder on the first person, as the API does', () => {
    const preview = previewShares('equal', units('-10'), people('', '', ''), 'en')
    expect(preview.lines.map((line) => line.units)).toEqual([units('3.34'), units('3.33'), units('3.33')])
    expect(preview.problem).toBeNull()
    // 0.05 over three: 0.02 each rounds up, so the first takes what is left.
    expect(previewShares('equal', units('0.05'), people('', '', ''), 'en').lines.map((line) => line.units)).toEqual([units('0.01'), units('0.02'), units('0.02')])
    // A cent over three leaves two people with nothing: refused before it is sent.
    expect(previewShares('equal', units('0.01'), people('', '', ''), 'en').problem).toBe('zero-share')
  })

  it('takes positive amounts that must add up to the whole, saying what is left', () => {
    expect(previewShares('amounts', units('-60'), people('25', '20'), 'en')).toMatchObject({ remaining: units('15'), problem: 'unassigned' })
    expect(previewShares('amounts', units('-60'), people('40', '30'), 'en')).toMatchObject({ remaining: units('-10'), problem: 'over-assigned' })
    expect(previewShares('amounts', units('-60'), people('40,5', '19,5'), 'pt-PT')).toMatchObject({ remaining: 0n, problem: null })
    // A typed sign is ignored: the share takes the transaction's sign on the server.
    expect(previewShares('amounts', units('-60'), people('-30', '30'), 'en').problem).toBeNull()
    expect(previewShares('amounts', units('-60'), people('0', '60'), 'en').lines[0]?.error).toBe('zero')
    expect(previewShares('amounts', units('-60'), people('1.23456', '58.76544'), 'en').lines[0]?.error).toBe('too-precise')
    expect(previewShares('amounts', units('-60'), people('abc', '60'), 'en').problem).toBe('line-errors')
    expect(previewShares('amounts', units('-60'), people('', '60'), 'en').problem).toBe('line-errors')
  })

  it('takes percentages over 0 with at most two decimals making 100, the remainder on the largest', () => {
    const preview = previewShares('percentages', units('-100'), people('33.33', '33.34', '33.33'), 'en')
    expect(preview).toMatchObject({ remaining: 0n, problem: null })
    expect(preview.lines.map((line) => line.units)).toEqual([units('33.33'), units('33.34'), units('33.33')])
    expect(previewShares('percentages', units('-10'), people('50', '25'), 'en')).toMatchObject({ remaining: 2_500n, problem: 'unassigned' })
    expect(previewShares('percentages', units('-10'), people('60', '60'), 'en')).toMatchObject({ remaining: -2_000n, problem: 'over-assigned' })
    expect(previewShares('percentages', units('-10'), people('33.333', '66.667'), 'en').lines[0]?.error).toBe('too-precise')
    expect(previewShares('percentages', units('-10'), people('0', '100'), 'en').lines[0]?.error).toBe('zero')
    expect(previewShares('percentages', units('-10'), people('120', '-20'), 'en').lines[0]?.error).toBe('over-100')
    expect(previewShares('percentages', units('-10'), people('50%', '50 %'), 'en').problem).toBeNull()
  })

  it('needs an amount and someone to share it with', () => {
    expect(previewShares('equal', null, people(''), 'en').problem).toBe('no-amount')
    expect(previewShares('equal', units('-10'), [], 'en').problem).toBe('no-people')
  })

  it('allocates by weights with the remainder on the largest weight, the first of equals', () => {
    expect(allocateByWeights(units('10'), [1n, 2n])).toEqual([units('3.33'), units('6.67')])
    expect(allocateByWeights(units('1'), [1n, 1n, 1n])).toEqual([units('0.34'), units('0.33'), units('0.33')])
  })

  it('builds the request lines for each method', () => {
    const lines = people('12.5', '7.5')
    expect(toShareLines('equal', lines, previewShares('equal', units('-20'), lines, 'en'))).toEqual([{ memberId: 1 }, { memberId: 2 }])
    expect(toShareLines('amounts', lines, previewShares('amounts', units('-20'), lines, 'en'))).toEqual([{ memberId: 1, amount: 12.5 }, { memberId: 2, amount: 7.5 }])
    const percents = people('62.5', '37.5')
    expect(toShareLines('percentages', percents, previewShares('percentages', units('-20'), percents, 'en'))).toEqual([{ memberId: 1, percentage: 62.5 }, { memberId: 2, percentage: 37.5 }])
  })
})

describe('share drafts', () => {
  it('starts with everyone, equally, paid by the reader', () => {
    expect(startShareDraft(groupFixture)).toEqual({ method: 'equal', paidByMemberId: 1, memberIds: [1, 2, 3], values: {} })
    // Only someone of the household pays; with the reader outside the group, the first of them.
    expect(defaultPayer([member({ isYou: false, expenseGroupMemberKey: 5 }), member({ expenseGroupMemberKey: 6, appuserKey: null, isHouseholdMember: false })])).toBe(5)
    expect(defaultPayer([member({ appuserKey: null, isHouseholdMember: false })])).toBeNull()
  })

  it('reopens an existing share with its method, payer, people and values', () => {
    expect(draftFromExpense(expenseFixture({ splitMethod: 'amounts', paidByMemberKey: 2, shares: [{ expenseGroupMemberKey: 1, amount: -45.5 }, { expenseGroupMemberKey: 3, amount: -14.5 }] }), 'en'))
      .toEqual({ method: 'amounts', paidByMemberId: 2, memberIds: [1, 3], values: { 1: '45.5', 3: '14.5' } })
    // Percentages come back from the amounts, making exactly 100.
    expect(draftFromExpense(expenseFixture({ splitMethod: 'percentages', shares: [{ expenseGroupMemberKey: 1, amount: -20 }, { expenseGroupMemberKey: 2, amount: -20 }, { expenseGroupMemberKey: 3, amount: -20 }] }), 'en').values)
      .toEqual({ 1: '33.34', 2: '33.33', 3: '33.33' })
    expect(draftFromExpense(expenseFixture({ splitMethod: 'unknown' }), 'en').method).toBe('amounts')
  })
})

describe('transactions and groups', () => {
  const row = (overrides: Partial<typeof transactionFixture> = {}) => mapTransactions({ transactions: [{ ...transactionFixture, transactionTypeKey: { name: 'debit' }, settlementAmount: 60, ...overrides }] })[0]!

  it('offers "Split with group" on an ordinary row with an amount', () => {
    expect(canSplitWithGroup(row())).toBe(true)
    expect(canSplitWithGroup(row({ settlementAmount: 0 }))).toBe(false)
    expect(canSplitWithGroup(row({ transactionTypeKey: { name: 'TRANSFER_OUT' } }))).toBe(false)
  })

  it('reads the group a row is shared in from its split lines', () => {
    const line = (key: number, memberKey: number, name: string, position: number) => ({
      transactionSplitKey: key, amount: -30, appuserAmount: -30, category: null, notes: null, position,
      expenseGroupMember: { expenseGroupKey: 4, expenseGroupMemberKey: memberKey, isHouseholdMember: memberKey === 1, name },
    })
    expect(groupShareOf(row({ splits: [line(6, 3, 'Sam', 1), line(5, 1, 'Ana', 0)] }))).toEqual({
      expenseGroupKey: 4,
      shares: [
        { memberKey: 1, name: 'Ana', isHouseholdMember: true, amount: -30 },
        { memberKey: 3, name: 'Sam', isHouseholdMember: false, amount: -30 },
      ],
    })
    expect(groupShareOf(row())).toBeNull()
  })
})

describe('balances in words', () => {
  it('reads a balance as owed, owes or settled, ignoring less than a cent', () => {
    expect(balanceStanding(30)).toBe('owed')
    expect(balanceStanding(-0.5)).toBe('owes')
    expect(balanceStanding(0.004)).toBe('settled')
    expect(balanceStanding(0)).toBe('settled')
  })

  it('words a payment from the reader’s side', () => {
    expect(describePayment({ fromMemberKey: 1, toMemberKey: 2 }, groupMembers, '?')).toEqual({ kind: 'you-owe', from: 'Ana', to: 'Rui' })
    expect(describePayment({ fromMemberKey: 3, toMemberKey: 1 }, groupMembers, '?')).toEqual({ kind: 'owes-you', from: 'Sam', to: 'Ana' })
    expect(describePayment({ fromMemberKey: 3, toMemberKey: 2 }, groupMembers, '?')).toEqual({ kind: 'owes', from: 'Sam', to: 'Rui' })
    expect(describePayment({ fromMemberKey: 9, toMemberKey: 2 }, groupMembers, 'Someone').from).toBe('Someone')
  })

  it('lists the reader’s standing per currency, leaving out the settled ones', () => {
    expect(yourBalances({ yourBalances: [{ currencyCode: 'EUR', amount: 40 }, { currencyCode: 'USD', amount: -12.5 }, { currencyCode: 'GBP', amount: 0 }] })).toEqual([
      { currencyCode: 'EUR', amount: 40, standing: 'owed' },
      { currencyCode: 'USD', amount: 12.5, standing: 'owes' },
    ])
  })
})

describe('settlements', () => {
  it('links a transaction only between the household and someone outside it', () => {
    expect(canLinkSettlement(groupMembers, 3, 1)).toBe(true)
    expect(canLinkSettlement(groupMembers, 1, 3)).toBe(true)
    expect(canLinkSettlement(groupMembers, 2, 1)).toBe(false)
    expect(canLinkSettlement(groupMembers, 3, 3)).toBe(false)
    expect(canLinkSettlement(groupMembers, null, 1)).toBe(false)
  })

  it('reads the amount, capped by what is left on a linked transaction', () => {
    expect(readSettlementAmount('20,50', 'pt-PT')).toEqual({ units: units('20.5'), error: null })
    expect(readSettlementAmount('', 'en')).toEqual({ units: null, error: null })
    expect(readSettlementAmount('0', 'en').error).toBe('zero')
    expect(readSettlementAmount('1.00001', 'en').error).toBe('too-precise')
    expect(readSettlementAmount('25', 'en', units('20'))).toEqual({ units: units('25'), error: 'over' })
  })
})

describe('the household', () => {
  const household = {
    members: [
      { appuserKey: 10, emailAddress: 'ana@example.com', firstName: 'Ana', role: 'owner' as const },
      { appuserKey: 11, emailAddress: 'rui@example.com', firstName: null, role: 'viewer' as const },
      { appuserKey: 12, emailAddress: 'eva@example.com', firstName: 'Eva', role: 'member' as const },
    ],
    maxMembers: 5,
    pendingInvites: [],
    viewerAppuserKey: 11,
  }

  it('knows a viewer, who changes nothing', () => {
    expect(isHouseholdViewer(household)).toBe(true)
    expect(isHouseholdViewer({ ...household, viewerAppuserKey: 10 })).toBe(false)
    expect(isHouseholdViewer({ ...household, viewerAppuserKey: null })).toBe(false)
    expect(isHouseholdViewer(undefined)).toBe(false)
  })

  it('offers the other household members not yet in the group', () => {
    expect(householdCandidates({ ...household, viewerAppuserKey: 10 })).toEqual([
      { appuserKey: 11, name: 'rui@example.com' },
      { appuserKey: 12, name: 'Eva' },
    ])
    expect(householdCandidates({ ...household, viewerAppuserKey: 10 }, groupFixture)).toEqual([{ appuserKey: 12, name: 'Eva' }])
  })
})

describe('refusals', () => {
  it('maps the API’s codes to the screens’ words', () => {
    const http = (status: number, serverCode?: string) => new ApiError('http', status, serverCode ? { serverCode } : undefined)
    expect(classifyGroupFailure(http(409, 'expense_group_member_in_use'))).toBe('member-in-use')
    expect(classifyGroupFailure(http(409, 'expense_group_not_empty'))).toBe('not-empty')
    expect(classifyGroupFailure(http(409, 'transaction_in_expense_group'))).toBe('in-group')
    expect(classifyGroupFailure(http(400, 'expense_group_shares_invalid'))).toBe('shares-invalid')
    expect(classifyGroupFailure(http(409, 'expense_group_transaction_conflict'))).toBe('transaction-conflict')
    expect(classifyGroupFailure(http(400, 'expense_group_amount_exceeded'))).toBe('amount-exceeded')
    expect(classifyGroupFailure(http(400, 'expense_group_currency_mismatch'))).toBe('currency-mismatch')
    expect(classifyGroupFailure(http(400, 'expense_group_settlement_invalid'))).toBe('settlement-invalid')
    expect(classifyGroupFailure(http(400, 'expense_group_member_invalid'))).toBe('member-invalid')
    expect(classifyGroupFailure(http(404))).toBe('not-found')
    expect(classifyGroupFailure(http(500))).toBe('error')
    expect(classifyGroupFailure(new ApiError('household-read-only', 403))).toBe('read-only')
    expect(classifyGroupFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyGroupFailure(new ApiError('network'))).toBe('network')
    expect(classifyGroupFailure(new Error('boom'))).toBe('error')
  })
})
