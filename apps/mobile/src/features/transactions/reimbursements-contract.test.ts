import {
  createLinkReimbursementEndpoint,
  createReimbursementSuggestionsEndpoint,
  createTransactionReimbursementsEndpoint,
  createUnlinkReimbursementEndpoint,
  freezeLinkReimbursement,
  reimbursementSuggestionsSchema,
  transactionReimbursementsSchema,
} from './reimbursements-contract'

const side = { transactionKey: 41, accountKey: 7, accountName: 'Daily account', description: 'Card purchase', merchantName: 'Corner shop', transactionDate: '2026-07-18T10:00:00.000Z', settlementAmount: -50, currencyCode: 'EUR' }

describe('reimbursement endpoints', () => {
  it('names the routes of the API contract', () => {
    expect(createTransactionReimbursementsEndpoint(90)).toMatchObject({ method: 'GET', path: '/v1/account/transaction/90/reimbursements' })
    expect(createReimbursementSuggestionsEndpoint(90)).toMatchObject({ method: 'GET', path: '/v1/account/transaction/90/reimbursements/suggestions?limit=10' })
    expect(createReimbursementSuggestionsEndpoint(90, { search: '  café & co ', limit: 25 }).path)
      .toBe('/v1/account/transaction/90/reimbursements/suggestions?search=caf%C3%A9%20%26%20co&limit=25')
    expect(createLinkReimbursementEndpoint(90)).toMatchObject({ method: 'POST', path: '/v1/account/transaction/90/reimbursements' })
    expect(createUnlinkReimbursementEndpoint(41, 5)).toMatchObject({ method: 'DELETE', path: '/v1/account/transaction/41/reimbursements/5' })
    expect(() => createTransactionReimbursementsEndpoint(0)).toThrow()
    expect(() => createUnlinkReimbursementEndpoint(41, -1)).toThrow()
    expect(() => createReimbursementSuggestionsEndpoint(90, { limit: 51 })).toThrow()
  })

  it('freezes the exact link body, a positive amount with at most four decimals', () => {
    expect(freezeLinkReimbursement({ transactionId: 90, expenseTransactionId: 41, amount: ' 12.5 ' })).toEqual({ transactionId: 90, payload: { expenseTransactionId: 41, amount: 12.5 } })
    expect(freezeLinkReimbursement({ transactionId: 90, expenseTransactionId: 41, amount: '0.0001' }).payload.amount).toBe(0.0001)
    for (const amount of ['0', '-5', '1.23456', 'abc', '']) {
      expect(() => freezeLinkReimbursement({ transactionId: 90, expenseTransactionId: 41, amount })).toThrow()
    }
    expect(() => freezeLinkReimbursement({ transactionId: 90, expenseTransactionId: 90, amount: '5' })).toThrow()
  })

  it('reads a transaction’s links and its suggestions, tolerating values this build does not know', () => {
    expect(transactionReimbursementsSchema.parse({ role: 'refund', currencyCode: 'EUR', linkedAmount: 0, remainingAmount: 20, links: [] }).role).toBeNull()
    expect(transactionReimbursementsSchema.parse({ role: null, currencyCode: null, linkedAmount: 0, remainingAmount: 0, links: [] }).role).toBeNull()
    const { suggestions } = reimbursementSuggestionsSchema.parse({ suggestions: [
      { ...side, remainingAmount: 50, reason: 'merchant' },
      { ...side, transactionKey: 42, remainingAmount: 10, reason: 'category' },
    ] })
    expect(suggestions.map((suggestion) => suggestion.reason)).toEqual(['merchant', 'other'])
    expect(reimbursementSuggestionsSchema.safeParse({ suggestions: [{ ...side, remainingAmount: -1, reason: 'amount' }] }).success).toBe(false)
  })
})
