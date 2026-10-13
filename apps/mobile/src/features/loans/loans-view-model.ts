import type { LoanDto, LoanRepaymentDto } from './loans-contract'

export type LoanViewModel = Readonly<{
  id: number
  name: string
  type: LoanDto['type']
  status: LoanDto['status']
  currencyCode: string
  outstanding: number
  openingBalance: number
  originalPrincipal: number | null
  regularPayment: number | null
  paymentFrequency: LoanDto['paymentFrequency']
  paymentDay: number | null
  annualRatePercent: number | null
  rateType: LoanDto['rateType']
  termMonths: number | null
  remainingTermMonths: number | null
  progressPercentage: number
  meterPercentage: number
  progressBasis: LoanDto['progressBasis']
  nextPaymentDate: string | null
  maturityDate: string | null
  openingBalanceDate: string
  providerName: string | null
  notes: string | null
}>

export type LoanRepaymentViewModel = Readonly<{
  id: number
  paymentDate: string
  principal: number
  interest: number
  fee: number
  total: number
  allocationSource: LoanRepaymentDto['allocationSource']
  needsReview: boolean
  notes: string | null
  transaction: Readonly<{
    id: number
    description: string | null
    merchantName: string | null
    settlementAmount: number | null
    date: string | null
  }>
}>

export const mapLoan = (dto: LoanDto): LoanViewModel => ({
  id: dto.loanKey,
  name: dto.name,
  type: dto.type,
  status: dto.status,
  currencyCode: dto.currency.code,
  outstanding: dto.outstandingPrincipal,
  openingBalance: dto.openingPrincipalBalance,
  originalPrincipal: dto.originalPrincipal ?? null,
  regularPayment: dto.regularPaymentAmount ?? null,
  paymentFrequency: dto.paymentFrequency,
  paymentDay: dto.paymentDayOfMonth ?? null,
  annualRatePercent: dto.annualInterestRateBps == null ? null : dto.annualInterestRateBps / 100,
  rateType: dto.rateType,
  termMonths: dto.termMonths ?? null,
  remainingTermMonths: dto.remainingTermMonthsEstimated,
  progressPercentage: dto.progressPercentage,
  meterPercentage: Math.min(100, Math.max(0, dto.progressPercentage)),
  progressBasis: dto.progressBasis,
  nextPaymentDate: dto.nextPaymentDate,
  maturityDate: dto.maturityDate ?? null,
  openingBalanceDate: dto.openingBalanceDate,
  providerName: dto.providerName ?? null,
  notes: dto.notes ?? null,
})

export const mapLoans = (response: { loans: LoanDto[] }): LoanViewModel[] => response.loans.map(mapLoan)

export const mapRepayments = (response: { repayments: LoanRepaymentDto[] }): LoanRepaymentViewModel[] => (
  response.repayments.map((dto) => ({
    id: dto.loanRepaymentLinkKey,
    paymentDate: dto.paymentDate,
    principal: dto.principalAmount,
    interest: dto.interestAmount,
    fee: dto.feeAmount,
    total: dto.totalPaymentAmount,
    allocationSource: dto.allocationSource,
    needsReview: dto.needsReview,
    notes: dto.notes ?? null,
    transaction: {
      id: dto.transaction.transactionKey,
      description: dto.transaction.description ?? null,
      merchantName: dto.transaction.merchantName ?? null,
      settlementAmount: dto.transaction.settlementAmount ?? null,
      date: dto.transaction.transactionDate ?? null,
    },
  })).sort((a, b) => Date.parse(b.paymentDate) - Date.parse(a.paymentDate))
)
