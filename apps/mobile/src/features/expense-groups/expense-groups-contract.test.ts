import {
  createAddGroupMemberEndpoint,
  createDeleteExpenseGroupEndpoint,
  createDeleteSettlementEndpoint,
  createExpenseGroupDetailEndpoint,
  createGroupBalancesEndpoint,
  createGroupExpenseEndpoint,
  createGroupExpensesEndpoint,
  createGroupSettlementsEndpoint,
  createRecordSettlementEndpoint,
  createRemoveGroupMemberEndpoint,
  createSettlementSuggestionsEndpoint,
  createShareExpenseEndpoint,
  createUnshareExpenseEndpoint,
  createUpdateExpenseGroupEndpoint,
  expenseGroupsEndpoint,
  freezeCreateGroup,
  freezeRecordSettlement,
  freezeShareExpense,
  groupBalancesSchema,
  groupExpenseSchema,
  groupSettlementSchema,
} from './expense-groups-contract'
import { groupFixture, transactionSide } from './test-fixtures'

describe('expense group endpoints', () => {
  it('names the routes of the API contract', () => {
    expect(expenseGroupsEndpoint).toMatchObject({ method: 'GET', path: '/v1/expense-groups' })
    expect(createExpenseGroupDetailEndpoint(4)).toMatchObject({ method: 'GET', path: '/v1/expense-groups/4' })
    expect(createUpdateExpenseGroupEndpoint(4)).toMatchObject({ method: 'PATCH', path: '/v1/expense-groups/4' })
    expect(createDeleteExpenseGroupEndpoint(4)).toMatchObject({ method: 'DELETE', path: '/v1/expense-groups/4' })
    expect(createGroupBalancesEndpoint(4)).toMatchObject({ method: 'GET', path: '/v1/expense-groups/4/balances' })
    expect(createAddGroupMemberEndpoint(4)).toMatchObject({ method: 'POST', path: '/v1/expense-groups/4/members' })
    expect(createRemoveGroupMemberEndpoint(4, 9)).toMatchObject({ method: 'DELETE', path: '/v1/expense-groups/4/members/9' })
    expect(createGroupExpensesEndpoint(4)).toMatchObject({ method: 'GET', path: '/v1/expense-groups/4/shares' })
    expect(createGroupExpenseEndpoint(4, 41)).toMatchObject({ method: 'GET', path: '/v1/expense-groups/4/shares/41' })
    expect(createShareExpenseEndpoint(4)).toMatchObject({ method: 'POST', path: '/v1/expense-groups/4/shares' })
    expect(createUnshareExpenseEndpoint(4, 41)).toMatchObject({ method: 'DELETE', path: '/v1/expense-groups/4/shares/41' })
    expect(createGroupSettlementsEndpoint(4)).toMatchObject({ method: 'GET', path: '/v1/expense-groups/4/settlements' })
    expect(createRecordSettlementEndpoint(4)).toMatchObject({ method: 'POST', path: '/v1/expense-groups/4/settlements' })
    expect(createDeleteSettlementEndpoint(4, 3)).toMatchObject({ method: 'DELETE', path: '/v1/expense-groups/4/settlements/3' })
    expect(() => createExpenseGroupDetailEndpoint(0)).toThrow()
    expect(() => createRemoveGroupMemberEndpoint(4, -1)).toThrow()
  })

  it('asks for settlement suggestions between two people, in a currency, by search', () => {
    expect(createSettlementSuggestionsEndpoint(4, { fromMemberId: 2, toMemberId: 1 }).path)
      .toBe('/v1/expense-groups/4/settlements/suggestions?fromMemberId=2&toMemberId=1&limit=10')
    expect(createSettlementSuggestionsEndpoint(4, { fromMemberId: 2, toMemberId: 1, currencyCode: 'EUR', search: ' café & co ', limit: 20 }).path)
      .toBe('/v1/expense-groups/4/settlements/suggestions?fromMemberId=2&toMemberId=1&currencyCode=EUR&search=caf%C3%A9%20%26%20co&limit=20')
    expect(() => createSettlementSuggestionsEndpoint(4, { fromMemberId: 2, toMemberId: 1, limit: 51 })).toThrow()
  })
})

describe('expense group responses', () => {
  it('reads a group, its balances, expenses and settlements', () => {
    expect(groupFixture.members.map((member) => member.isYou)).toEqual([true, false, false])
    const balances = groupBalancesSchema.parse({
      expenseGroupKey: 4,
      currencies: [{
        currencyCode: 'EUR',
        members: [{ memberKey: 1, paid: 60, share: 20, settlementsPaid: 0, settlementsReceived: 0, balance: 40 }],
        payments: [{ fromMemberKey: 3, toMemberKey: 1, amount: 20 }],
      }],
    })
    expect(balances.currencies[0]?.payments).toHaveLength(1)
    const expense = groupExpenseSchema.parse({
      expenseGroupExpenseKey: 8,
      expenseGroupKey: 4,
      categoryKey: null,
      currencyCode: 'EUR',
      paidByMemberKey: 1,
      splitMethod: 'by-weight',
      shares: [{ expenseGroupMemberKey: 1, amount: -30 }, { expenseGroupMemberKey: 3, amount: -30 }],
      transaction: transactionSide(),
    })
    // A method this build does not know is not a failure.
    expect(expense.splitMethod).toBe('unknown')
    const settlement = groupSettlementSchema.parse({
      expenseGroupSettlementKey: 3,
      expenseGroupKey: 4,
      fromMemberKey: 3,
      toMemberKey: 1,
      amount: 20,
      currencyCode: 'EUR',
      settledOn: '2026-11-01',
      notes: null,
      isLinked: true,
      transaction: null,
      createdAt: '2026-11-01T10:00:00.000Z',
    })
    expect(settlement.isLinked).toBe(true)
    expect(groupSettlementSchema.safeParse({ ...settlement, amount: 0 }).success).toBe(false)
    expect(groupSettlementSchema.safeParse({ ...settlement, settledOn: '1 Nov' }).success).toBe(false)
  })
})

describe('expense group request bodies', () => {
  it('freezes a new group: household people by key, everyone else by name and optional email', () => {
    expect(freezeCreateGroup({
      name: '  Lisbon trip ',
      currencyCode: 'eur',
      people: [{ name: ' Sam ', email: '' }, { name: 'Alex', email: ' alex@example.com ' }],
      householdMemberIds: [12, 12],
    })).toEqual({
      name: 'Lisbon trip',
      currencyCode: 'EUR',
      members: [{ name: '', householdMemberId: 12 }, { name: 'Sam' }, { name: 'Alex', email: 'alex@example.com' }],
    })
    expect(() => freezeCreateGroup({ name: ' ', currencyCode: 'EUR', people: [], householdMemberIds: [] })).toThrow()
    expect(() => freezeCreateGroup({ name: 'Trip', currencyCode: 'EURO', people: [], householdMemberIds: [] })).toThrow()
    expect(() => freezeCreateGroup({ name: 'Trip', currencyCode: 'EUR', people: [{ name: '' }], householdMemberIds: [] })).toThrow()
    expect(() => freezeCreateGroup({ name: 'Trip', currencyCode: 'EUR', people: [{ name: 'Sam', email: 'not-an-email' }], householdMemberIds: [] })).toThrow()
  })

  it('freezes shares by method: people only, positive amounts, or percentages', () => {
    expect(freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'equal', shares: [{ memberId: 1, amount: 3 }, { memberId: 3 }] }).shares)
      .toEqual([{ memberId: 1 }, { memberId: 3 }])
    expect(freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'amounts', shares: [{ memberId: 1, amount: 12.5 }, { memberId: 3, amount: 7.5 }] }).shares)
      .toEqual([{ memberId: 1, amount: 12.5 }, { memberId: 3, amount: 7.5 }])
    expect(freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'percentages', shares: [{ memberId: 1, percentage: 60 }, { memberId: 3, percentage: 40 }] }).shares)
      .toEqual([{ memberId: 1, percentage: 60 }, { memberId: 3, percentage: 40 }])
    expect(() => freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'amounts', shares: [{ memberId: 1, amount: -5 }] })).toThrow()
    expect(() => freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'percentages', shares: [{ memberId: 1 }] })).toThrow()
    expect(() => freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'equal', shares: [{ memberId: 1 }, { memberId: 1 }] })).toThrow()
    expect(() => freezeShareExpense({ transactionId: 41, paidByMemberId: 1, method: 'equal', shares: [] })).toThrow()
  })

  it('freezes a settlement: two people, a positive amount, a day, notes and an optional transaction', () => {
    expect(freezeRecordSettlement({ fromMemberId: 3, toMemberId: 1, amount: ' 20.5 ', settledOn: '2026-11-01', currencyCode: 'EUR', notes: '  ', transactionId: null }))
      .toEqual({ fromMemberId: 3, toMemberId: 1, amount: 20.5, settledOn: '2026-11-01', currencyCode: 'EUR', notes: null, transactionId: null })
    expect(freezeRecordSettlement({ fromMemberId: 3, toMemberId: 1, amount: '20', settledOn: '2026-11-01', currencyCode: 'EUR', notes: ' Cash ', transactionId: 77 }))
      .toMatchObject({ notes: 'Cash', transactionId: 77 })
    for (const amount of ['0', '-5', '1.23456', 'abc', '']) {
      expect(() => freezeRecordSettlement({ fromMemberId: 3, toMemberId: 1, amount, settledOn: '2026-11-01', currencyCode: 'EUR', notes: '', transactionId: null })).toThrow()
    }
    expect(() => freezeRecordSettlement({ fromMemberId: 3, toMemberId: 3, amount: '5', settledOn: '2026-11-01', currencyCode: 'EUR', notes: '', transactionId: null })).toThrow()
    expect(() => freezeRecordSettlement({ fromMemberId: 3, toMemberId: 1, amount: '5', settledOn: 'today', currencyCode: 'EUR', notes: '', transactionId: null })).toThrow()
  })
})
