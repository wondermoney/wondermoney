import type { InstallmentCommitmentDto, InstallmentPlanDetailDto, InstallmentSuggestionDto } from './installments-contract'

/** A €100 purchase in four installments: two paid, one to come, one past and not matched. */
export const planDetailFixture: InstallmentPlanDetailDto = {
  installmentPlanKey: 11,
  accountKey: 7,
  accountName: 'Travel card',
  currency: 'EUR',
  description: 'Laptop',
  purchaseDate: '2026-08-20',
  totalAmount: 100,
  installmentCount: 4,
  categoryKey: null,
  paidCount: 2,
  paidAmount: 50,
  remainingCount: 1,
  remainingAmount: 25,
  unmatchedCount: 1,
  nextInstallment: { installmentNumber: 4, amount: 25, scheduledDate: '2026-12-05', statementDate: '2026-12-01', dueDate: '2026-12-20', status: 'upcoming', transactionKey: null, postedAmount: null, postedDate: null },
  installments: [
    { installmentNumber: 1, amount: 25, scheduledDate: '2026-09-05', statementDate: '2026-09-01', dueDate: '2026-09-20', status: 'paid', transactionKey: 501, postedAmount: 25, postedDate: '2026-09-05' },
    { installmentNumber: 2, amount: 25, scheduledDate: '2026-10-05', statementDate: '2026-10-01', dueDate: '2026-10-20', status: 'paid', transactionKey: 502, postedAmount: 25, postedDate: '2026-10-06' },
    { installmentNumber: 3, amount: 25, scheduledDate: '2026-11-05', statementDate: null, dueDate: null, status: 'unmatched', transactionKey: null, postedAmount: null, postedDate: null },
    { installmentNumber: 4, amount: 25, scheduledDate: '2026-12-05', statementDate: '2026-12-01', dueDate: '2026-12-20', status: 'upcoming', transactionKey: null, postedAmount: null, postedDate: null },
  ],
}

export const commitmentFixture: InstallmentCommitmentDto = {
  accountKey: 7,
  accountName: 'Travel card',
  currency: 'EUR',
  remainingAmount: 75,
  remainingCount: 3,
  activePlanCount: 2,
  nextInstallment: { amount: 25, date: '2026-12-05', installmentPlanKey: 11, installmentNumber: 4, installmentCount: 4, description: 'Laptop' },
}

/** Two posted rows, "PHONE 1/6" and "PHONE 2/6", that look like a six-installment purchase. */
export const suggestionFixture: InstallmentSuggestionDto = {
  key: '7:phone:6',
  accountKey: 7,
  accountName: 'Travel card',
  currency: 'EUR',
  description: 'Phone shop',
  installmentCount: 6,
  installmentAmount: 50,
  totalAmount: 300,
  purchaseDate: '2026-09-15',
  transactions: [
    { transactionKey: 901, installmentNumber: 1, amount: 50, transactionDate: '2026-09-15', description: 'PHONE SHOP 1/6' },
    { transactionKey: 902, installmentNumber: 2, amount: 50, transactionDate: '2026-10-15', description: 'PHONE SHOP 2/6' },
  ],
}
