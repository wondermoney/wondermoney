export const loansKey = (epochId: number) => ['loans', 'list', epochId] as const
export const loanKey = (epochId: number, loanId: number) => ['loans', 'detail', epochId, loanId] as const
export const loanRepaymentsKey = (epochId: number, loanId: number) => ['loans', 'repayments', epochId, loanId] as const
export const loanRepaymentCandidatesKey = (epochId: number, loanId: number) => ['loans', 'repayment-candidates', epochId, loanId] as const
