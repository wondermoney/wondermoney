export interface LoanRepaymentSpendingLink {
  feeAmount: number;
  interestAmount: number;
  principalAmount: number;
}

export function calculateEffectiveSpendingAmount(input: {
  loanRepaymentLinks: LoanRepaymentSpendingLink[];
  transactionAmount: number;
}) {
  if (input.loanRepaymentLinks.length === 0) return input.transactionAmount;

  return input.loanRepaymentLinks.reduce((sum, link) => sum + link.interestAmount + link.feeAmount, 0);
}
