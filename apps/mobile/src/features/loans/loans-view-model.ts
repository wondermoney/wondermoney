import type { LoanDto, LoanProjectionDto, LoanRepaymentDto } from './loans-contract'

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
  /**
   * The remaining term shown on the detail screen. `contract` counts the months left to the
   * maturity date; `estimate` is the API's payoff estimate at the stored payment and rate,
   * used only when the loan has no maturity date.
   */
  remainingTerm: Readonly<{ months: number; basis: 'contract' | 'estimate' }> | null
  /**
   * The API's estimate when it runs past the contract — the stored payment is below what
   * clears the balance by maturity (or within the original term). The screen says so rather
   * than showing a remaining term longer than the loan itself.
   */
  payoffBeyondContractMonths: number | null
  progressPercentage: number
  meterPercentage: number
  progressBasis: LoanDto['progressBasis']
  nextPaymentDate: string | null
  maturityDate: string | null
  openingBalanceDate: string
  providerName: string | null
  notes: string | null
}>

export type LoanProjectionViewModel = Readonly<{
  paysOff: boolean
  payoffDate: string | null
  /** Whole months sooner than the contract maturity; 0 when on schedule or behind. */
  monthsSaved: number
  /** Interest the contract would still charge minus the projected interest; 0 when not lower. */
  interestSaved: number
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

/** Whole monthly payments left between `now` and the maturity date; never negative. */
export function monthsUntil(maturityDate: string, now: Date): number {
  const maturity = new Date(maturityDate)
  if (Number.isNaN(maturity.getTime())) return 0
  const months = (maturity.getUTCFullYear() - now.getUTCFullYear()) * 12 + (maturity.getUTCMonth() - now.getUTCMonth()) + (maturity.getUTCDate() > now.getUTCDate() ? 1 : 0)
  return Math.max(0, months)
}

function remainingTerm(dto: LoanDto, now: Date): Pick<LoanViewModel, 'remainingTerm' | 'payoffBeyondContractMonths'> {
  const estimate = dto.remainingTermMonthsEstimated
  const contractMonths = dto.maturityDate ? monthsUntil(dto.maturityDate, now) : null
  // Without a maturity date the original term is the only contract there is: no balance
  // can honestly have more left to run than the whole loan had.
  const limit = contractMonths ?? dto.termMonths ?? null
  const beyond = estimate !== null && limit !== null && estimate > limit ? estimate : null
  if (contractMonths !== null) return { remainingTerm: { months: contractMonths, basis: 'contract' }, payoffBeyondContractMonths: beyond }
  if (estimate !== null && beyond === null) return { remainingTerm: { months: estimate, basis: 'estimate' }, payoffBeyondContractMonths: null }
  return { remainingTerm: null, payoffBeyondContractMonths: beyond }
}

export const mapLoan = (dto: LoanDto, now: Date = new Date()): LoanViewModel => ({
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
  ...remainingTerm(dto, now),
  progressPercentage: dto.progressPercentage,
  meterPercentage: Math.min(100, Math.max(0, dto.progressPercentage)),
  progressBasis: dto.progressBasis,
  nextPaymentDate: dto.nextPaymentDate,
  maturityDate: dto.maturityDate ?? null,
  openingBalanceDate: dto.openingBalanceDate,
  providerName: dto.providerName ?? null,
  notes: dto.notes ?? null,
})

export const mapLoans = (response: { loans: LoanDto[] }): LoanViewModel[] => response.loans.map((dto) => mapLoan(dto))

/**
 * Mobile has no extra-payment input, so the two savings figures compare the projection
 * with the contract: months sooner than maturity, and interest the contract would still
 * charge minus the projected interest. Both are 0 when the loan is on schedule or behind.
 */
export const mapLoanProjection = (dto: LoanProjectionDto): LoanProjectionViewModel => ({
  paysOff: dto.paysOff,
  payoffDate: dto.payoffDate,
  monthsSaved: Math.max(0, dto.aheadOrBehindMonths ?? 0),
  interestSaved: Math.max(0, +(dto.contractInterest - dto.totalInterest).toFixed(2)),
})

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
