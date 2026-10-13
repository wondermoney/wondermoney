import { createRepaymentAllocation, freezeRepaymentWrite, parseUnsignedLocaleAmount } from './loan-repayment-allocation'

describe('loan repayment allocation', () => {
  it.each([
    ['en', '0', 0], ['en-US', '1234', 1234], ['en', '1234.56', 1234.56], ['en', '1,234.56', 1234.56], ['en', '12,345,678.9012', 12345678.9012],
    ['pt-PT', '0', 0], ['pt', '1234', 1234], ['pt-PT', '1234,56', 1234.56], ['pt-PT', '1 234,56', 1234.56], ['pt-PT', '1\u00a0234,56', 1234.56], ['pt-PT', '12\u202f345\u202f678,9', 12345678.9],
    ['es', '0', 0], ['es-ES', '1234', 1234], ['es', '1234,56', 1234.56], ['es', '1.234,56', 1234.56], ['es', '12.345.678,9012', 12345678.9012],
  ] as const)('strictly parses %s locale input %s', (locale, input, expected) => {
    expect(parseUnsignedLocaleAmount(input, locale)).toBe(expected)
  })

  it.each([
    ['en', '1,2'], ['en', '12,34'], ['en', '1,234,56'], ['en', '1.234,56'], ['en', '1,234.5.6'], ['en', '1 234.56'],
    ['pt-PT', '1.2'], ['pt-PT', '12 34'], ['pt-PT', '1 234.56'], ['pt-PT', '1.234,56'], ['pt-PT', '1,2,3'], ['pt-PT', '1,234,56'],
    ['es', '1.2'], ['es', '12.34'], ['es', '1 234,56'], ['es', '1,234.56'], ['es', '1.234.5,6'], ['es', '1,2,3'],
    ['en', '-1'], ['en', '+1'], ['en', 'Infinity'], ['en', '1e3'], ['en', 'NaN'], ['en', ''], ['en', '.5'], ['en', '1.'],
    ['pt-PT', '-1,2'], ['pt-PT', ',5'], ['pt-PT', '1,'], ['es', '-1,2'], ['es', ',5'], ['es', '1,'], ['fr', '1,00'],
  ] as const)('rejects malformed %s locale input %s', (locale, input) => {
    expect(() => parseUnsignedLocaleAmount(input, locale)).toThrow()
  })

  it('reconciles components and prechecks outstanding principal and transaction amount', () => {
    expect(createRepaymentAllocation({ principal: '645', interest: '300', fee: '5', total: '950' }, 'en', { maximumPrincipal: 180_000, transactionAmount: 950 })).toEqual({ principalAmount: 645, interestAmount: 300, feeAmount: 5, totalPaymentAmount: 950 })
    expect(() => createRepaymentAllocation({ principal: '646', interest: '300', fee: '5', total: '951' }, 'en', { maximumPrincipal: 645, transactionAmount: 951 })).toThrow(/outstanding/i)
    expect(() => createRepaymentAllocation({ principal: '645', interest: '300', fee: '5', total: '950' }, 'en', { maximumPrincipal: 645, transactionAmount: 949 })).toThrow(/transaction/i)
    expect(() => createRepaymentAllocation({ principal: '645', interest: '300', fee: '5', total: '949' }, 'en', { maximumPrincipal: 645, transactionAmount: 950 })).toThrow(/reconcile/i)
  })

  it('freezes only positive persisted identities and exact allocation fields', () => {
    const allocation = { principalAmount: 645, interestAmount: 300, feeAmount: 5, totalPaymentAmount: 950 }
    const frozen = freezeRepaymentWrite({ type: 'link', loanId: 7, transactionKey: 82, allocation })
    expect(frozen).toEqual({ type: 'link', loanId: 7, transactionKey: 82, allocation })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(() => freezeRepaymentWrite({ type: 'unlink', loanId: 7, repaymentLinkId: 0 })).toThrow(/persisted repayment/i)
  })
})
