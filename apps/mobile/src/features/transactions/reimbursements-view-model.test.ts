import { ApiError } from '@/lib/api/errors'

import type { LinkedTransactionDto, ReimbursementLinkDto } from './reimbursements-contract'
import {
  canMarkAsReimbursement,
  classifyReimbursementFailure,
  defaultLinkAmountUnits,
  linkedSide,
  linkedTitle,
  readLinkAmount,
  reimbursementBadge,
  reimbursementRoleOf,
} from './reimbursements-view-model'
import { transactionFixture } from './test-fixtures'
import { mapTransactions } from './transactions-view-model'

const row = (overrides: Partial<typeof transactionFixture> = {}) => mapTransactions({ transactions: [{ ...transactionFixture, ...overrides }] })[0]!
const refund = (overrides: Partial<typeof transactionFixture> = {}) => row({ transactionKey: 90, settlementAmount: 20, appuserSettlementAmount: 20, transactionTypeKey: { name: 'credit' }, ...overrides })
const expense = (overrides: Partial<typeof transactionFixture> = {}) => row({ transactionKey: 41, settlementAmount: -50, appuserSettlementAmount: -50, ...overrides })

const side = (overrides: Partial<LinkedTransactionDto> = {}): LinkedTransactionDto => ({
  transactionKey: 41,
  accountKey: 7,
  accountName: 'Daily account',
  description: 'Card purchase',
  merchantName: 'Corner shop',
  transactionDate: '2026-07-18T10:00:00.000Z',
  settlementAmount: -50,
  currencyCode: 'EUR',
  ...overrides,
})

const link = (overrides: Partial<ReimbursementLinkDto> = {}): ReimbursementLinkDto => ({
  transactionReimbursementKey: 5,
  amount: 20,
  currencyCode: 'EUR',
  createdAt: '2026-07-20T10:00:00.000Z',
  expense: side(),
  reimbursement: side({ transactionKey: 90, merchantName: null, description: 'Refund Corner shop', settlementAmount: 20 }),
  ...overrides,
})

describe('which transactions take part in a reimbursement', () => {
  it('reads money out as the expense and money in as the reimbursement', () => {
    expect(reimbursementRoleOf(expense())).toBe('expense')
    expect(reimbursementRoleOf(refund())).toBe('reimbursement')
  })

  it('offers "Mark as reimbursement" only on ordinary money in', () => {
    expect(canMarkAsReimbursement(refund())).toBe(true)
    expect(canMarkAsReimbursement(expense())).toBe(false)
    expect(canMarkAsReimbursement(refund({ transactionTypeKey: { name: 'TRANSFER_IN' } }))).toBe(false)
    expect(canMarkAsReimbursement(refund({ transactionKey: -3 }))).toBe(false)
    expect(canMarkAsReimbursement(refund({ settlementAmount: null, appuserSettlementAmount: null }))).toBe(false)
    expect(canMarkAsReimbursement(refund({ loanRepayment: { loanKey: 1, loanKeys: [1], loanName: 'Car', principalAmount: 1, interestAmount: 0, feeAmount: 0, spendingAmount: 0 } }))).toBe(false)
  })
})

describe('row badges', () => {
  it('marks an expense reimbursed, fully or in part, and an incoming row as a reimbursement', () => {
    expect(reimbursementBadge(expense())).toBeNull()
    expect(reimbursementBadge(expense({ reimbursements: [link()] }))).toBe('partly-reimbursed')
    expect(reimbursementBadge(expense({ reimbursements: [link(), link({ transactionReimbursementKey: 6, amount: 30 })] }))).toBe('reimbursed')
    expect(reimbursementBadge(refund({ reimbursements: [link()] }))).toBe('reimbursement')
  })

  it('takes a person’s edited amount as the expense’s size', () => {
    expect(reimbursementBadge(expense({ editedSettlementAmount: -20, reimbursements: [link()] }))).toBe('reimbursed')
  })
})

describe('the other side of a link', () => {
  it('is the reimbursement from the expense and the expense from the reimbursement', () => {
    expect(linkedSide(link(), 41).transactionKey).toBe(90)
    expect(linkedSide(link(), 90).transactionKey).toBe(41)
  })

  it('is named by its merchant, then its description', () => {
    expect(linkedTitle(side())).toBe('Corner shop')
    expect(linkedTitle(side({ merchantName: null }))).toBe('Card purchase')
    expect(linkedTitle(side({ merchantName: null, description: null }))).toBeNull()
  })
})

describe('the link amount', () => {
  it('defaults to what is left on both sides, whichever is smaller', () => {
    expect(defaultLinkAmountUnits(20, 50)).toBe(200000n)
    expect(defaultLinkAmountUnits(80, 32.5)).toBe(325000n)
    expect(defaultLinkAmountUnits(0, 50)).toBe(0n)
  })

  it('reads the typed amount in the reader’s format and caps it at that default', () => {
    expect(readLinkAmount('12,5', 200000n, 'pt-PT')).toEqual({ units: 125000n, error: null })
    expect(readLinkAmount('12.5', 200000n, 'en')).toEqual({ units: 125000n, error: null })
    expect(readLinkAmount('20', 200000n, 'en')).toEqual({ units: 200000n, error: null })
    expect(readLinkAmount('20.01', 200000n, 'en')).toEqual({ units: 200100n, error: 'over' })
    expect(readLinkAmount('', 200000n, 'en')).toEqual({ units: null, error: null })
    expect(readLinkAmount('abc', 200000n, 'en')).toEqual({ units: null, error: 'invalid' })
    expect(readLinkAmount('0', 200000n, 'en')).toEqual({ units: null, error: 'zero' })
    expect(readLinkAmount('1.23456', 200000n, 'en')).toEqual({ units: null, error: 'too-precise' })
    // A sign is read as the magnitude: the link amount is always positive.
    expect(readLinkAmount('-5', 200000n, 'en')).toEqual({ units: 50000n, error: null })
  })
})

describe('why a link change failed', () => {
  it.each([
    [400, 'reimbursement_currency_mismatch', 'currency-mismatch'],
    [400, 'reimbursement_amount_exceeded', 'amount-exceeded'],
    [400, 'reimbursement_visibility_mismatch', 'visibility-mismatch'],
    [400, 'reimbursement_invalid', 'invalid'],
    [409, 'reimbursement_link_exists', 'exists'],
    [404, 'not_found', 'not-found'],
    [404, undefined, 'not-found'],
    [409, undefined, 'exists'],
    [400, 'validation_failed', 'error'],
  ] as const)('maps a %i %s to %s', (status, serverCode, expected) => {
    expect(classifyReimbursementFailure(new ApiError('http', status, serverCode ? { serverCode } : undefined))).toBe(expected)
  })

  it('keeps the app’s own failures apart', () => {
    expect(classifyReimbursementFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyReimbursementFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyReimbursementFailure(new ApiError('network'))).toBe('network')
    expect(classifyReimbursementFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyReimbursementFailure(new Error('boom'))).toBe('error')
  })
})
