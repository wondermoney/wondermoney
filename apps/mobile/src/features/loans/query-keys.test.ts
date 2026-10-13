import { loanKey, loanRepaymentCandidatesKey, loanRepaymentsKey, loansKey } from './query-keys'

it('isolates every loan resource by authenticated epoch and loan id', () => {
  expect(loansKey(4)).toEqual(['loans', 'list', 4])
  expect(loanKey(4, 7)).toEqual(['loans', 'detail', 4, 7])
  expect(loanRepaymentsKey(4, 7)).toEqual(['loans', 'repayments', 4, 7])
  expect(loanRepaymentCandidatesKey(4, 7)).toEqual(['loans', 'repayment-candidates', 4, 7])
})
