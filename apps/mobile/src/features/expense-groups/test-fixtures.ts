import type {
  ExpenseGroupDto,
  ExpenseGroupMemberDto,
  GroupBalancesDto,
  GroupExpenseDto,
  GroupSettlementDto,
  GroupTransactionDto,
  SettlementSuggestionDto,
} from './expense-groups-contract'

export const member = (overrides: Partial<ExpenseGroupMemberDto> = {}): ExpenseGroupMemberDto => ({
  expenseGroupMemberKey: 1,
  name: 'Ana',
  email: null,
  appuserKey: 10,
  isHouseholdMember: true,
  isYou: true,
  position: 0,
  ...overrides,
})

/** Ana (the reader), Rui (household) and Sam (no account). */
export const groupMembers: ExpenseGroupMemberDto[] = [
  member(),
  member({ expenseGroupMemberKey: 2, name: 'Rui', appuserKey: 11, isYou: false, position: 1 }),
  member({ expenseGroupMemberKey: 3, name: 'Sam', appuserKey: null, isHouseholdMember: false, isYou: false, position: 2, email: 'sam@example.com' }),
]

export const groupFixture: ExpenseGroupDto = {
  expenseGroupKey: 4,
  name: 'Lisbon trip',
  currencyCode: 'EUR',
  archived: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  members: groupMembers,
  yourBalances: [{ currencyCode: 'EUR', amount: 40 }],
}

export const transactionSide = (overrides: Partial<GroupTransactionDto> = {}): GroupTransactionDto => ({
  transactionKey: 41,
  description: 'Dinner',
  merchantName: 'Tasca',
  transactionDate: '2026-11-02T20:00:00.000Z',
  settlementAmount: -60,
  currencyCode: 'EUR',
  accountKey: 7,
  accountName: 'Daily account',
  ...overrides,
})

export const expenseFixture = (overrides: Partial<GroupExpenseDto> = {}): GroupExpenseDto => ({
  expenseGroupExpenseKey: 8,
  expenseGroupKey: 4,
  categoryKey: 3,
  currencyCode: 'EUR',
  paidByMemberKey: 1,
  splitMethod: 'equal',
  shares: [
    { expenseGroupMemberKey: 1, amount: -20 },
    { expenseGroupMemberKey: 2, amount: -20 },
    { expenseGroupMemberKey: 3, amount: -20 },
  ],
  transaction: transactionSide(),
  ...overrides,
})

export const settlementFixture = (overrides: Partial<GroupSettlementDto> = {}): GroupSettlementDto => ({
  expenseGroupSettlementKey: 3,
  expenseGroupKey: 4,
  fromMemberKey: 2,
  toMemberKey: 1,
  amount: 10,
  currencyCode: 'EUR',
  settledOn: '2026-11-03',
  notes: null,
  isLinked: false,
  transaction: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  ...overrides,
})

export const balancesFixture: GroupBalancesDto = {
  expenseGroupKey: 4,
  currencies: [{
    currencyCode: 'EUR',
    members: [
      { memberKey: 1, paid: 60, share: 20, settlementsPaid: 0, settlementsReceived: 10, balance: 30 },
      { memberKey: 2, paid: 0, share: 20, settlementsPaid: 10, settlementsReceived: 0, balance: -10 },
      { memberKey: 3, paid: 0, share: 20, settlementsPaid: 0, settlementsReceived: 0, balance: -20 },
    ],
    payments: [
      { fromMemberKey: 3, toMemberKey: 1, amount: 20 },
      { fromMemberKey: 2, toMemberKey: 1, amount: 10 },
    ],
  }],
}

export const suggestionFixture = (overrides: Partial<SettlementSuggestionDto> = {}): SettlementSuggestionDto => ({
  ...transactionSide({ transactionKey: 77, description: 'Transfer from Sam', merchantName: null, settlementAmount: 20, transactionDate: '2026-11-05T10:00:00.000Z' }),
  remainingAmount: 20,
  ...overrides,
})
