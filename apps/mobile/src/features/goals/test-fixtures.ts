import type { DebtStrategyResponseDto, GoalListItemDto } from './goals-contract'

export const goalFixture: GoalListItemDto = {
  accountLinks: [{
    goalAccountLinkKey: 7,
    accountKey: { accountKey: 42, accountName: 'Current account' },
  }],
  currencyCode: 'EUR',
  goalKey: 3,
  monthlyContributionTarget: 125,
  name: 'Emergency reserve',
  priority: 1,
  status: 'active',
  summary: {
    assignedThisMonth: 100,
    availableAmount: 600,
    fundedHistorically: 800,
    monthlyShortfall: 25,
    progressPercentage: 60,
    remainingToTarget: 400,
    requiredMonthlyContribution: 150,
    spentAmount: 200,
    status: 'behind',
  },
  targetAmount: 1000,
  targetDate: '2027-07-18T00:00:00.000Z',
}

export const debtStrategyFixture: DebtStrategyResponseDto = {
  debts: [
    { id: 1, name: 'Visa card', balance: 4000, minimumPayment: 120, annualInterestRateBps: 2200 },
    { id: 2, name: 'Car loan', balance: 12000, minimumPayment: 300, annualInterestRateBps: 900 },
  ],
  extraBudget: 200,
  avalanche: {
    order: [1, 2],
    months: 30,
    totalInterest: 1850,
    perDebt: [{ id: 1, months: 14, totalInterest: 450 }, { id: 2, months: 30, totalInterest: 1400 }],
  },
  snowball: {
    order: [1, 2],
    months: 32,
    totalInterest: 2100,
    perDebt: [{ id: 1, months: 12, totalInterest: 500 }, { id: 2, months: 32, totalInterest: 1600 }],
  },
}
