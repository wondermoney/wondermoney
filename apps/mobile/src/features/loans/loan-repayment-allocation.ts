import { parseNumberInput } from '@/lib/formatters/decimal-input'

import { loanRepaymentAllocationSchema, type LoanRepaymentAllocation } from './loans-contract'

export type RepaymentAllocationInputs = Readonly<{
  principal: string
  interest: string
  fee: string
  total: string
}>

export type RepaymentAllocationBounds = Readonly<{
  maximumPrincipal: number
  transactionAmount: number | null
}>

/** One typed allocation component, read in the app's language; throws unless it is a number >= 0. */
export function parseUnsignedLocaleAmount(value: string, locale: string): number {
  const parsed = parseNumberInput(value, locale)
  if (parsed === null) throw new Error('Enter a correctly grouped unsigned number.')
  if (parsed < 0 || value.trim().startsWith('-')) throw new Error('Enter an unsigned number.')
  return parsed
}

export function createRepaymentAllocation(
  input: RepaymentAllocationInputs,
  locale: string,
  bounds: RepaymentAllocationBounds,
): LoanRepaymentAllocation {
  if (!Number.isFinite(bounds.maximumPrincipal) || bounds.maximumPrincipal < 0) throw new Error('Outstanding principal is unavailable.')
  if (bounds.transactionAmount !== null && (!Number.isFinite(bounds.transactionAmount) || bounds.transactionAmount <= 0)) throw new Error('Transaction amount is unavailable.')
  const allocation = loanRepaymentAllocationSchema.parse({
    principalAmount: parseUnsignedLocaleAmount(input.principal, locale),
    interestAmount: parseUnsignedLocaleAmount(input.interest, locale),
    feeAmount: parseUnsignedLocaleAmount(input.fee, locale),
    totalPaymentAmount: parseUnsignedLocaleAmount(input.total, locale),
  })
  if (allocation.principalAmount > bounds.maximumPrincipal + 0.01) throw new Error('Principal exceeds the current outstanding amount.')
  if (bounds.transactionAmount !== null && allocation.totalPaymentAmount > bounds.transactionAmount + 0.01) throw new Error('Allocation exceeds the transaction amount.')
  return Object.freeze(allocation)
}

export type FrozenRepaymentWrite =
  | Readonly<{ type: 'link'; loanId: number; transactionKey: number; allocation: LoanRepaymentAllocation }>
  | Readonly<{ type: 'edit'; loanId: number; repaymentLinkId: number; allocation: LoanRepaymentAllocation }>
  | Readonly<{ type: 'unlink'; loanId: number; repaymentLinkId: number }>

export function freezeRepaymentWrite(value: FrozenRepaymentWrite): FrozenRepaymentWrite {
  if (!Number.isSafeInteger(value.loanId) || value.loanId <= 0) throw new Error('A positive persisted loan id is required.')
  if (value.type === 'link') {
    if (!Number.isSafeInteger(value.transactionKey) || value.transactionKey <= 0) throw new Error('A positive persisted transaction id is required.')
    return Object.freeze({ ...value, allocation: Object.freeze(loanRepaymentAllocationSchema.parse(value.allocation)) })
  }
  if (!Number.isSafeInteger(value.repaymentLinkId) || value.repaymentLinkId <= 0) throw new Error('A positive persisted repayment id is required.')
  return value.type === 'edit'
    ? Object.freeze({ ...value, allocation: Object.freeze(loanRepaymentAllocationSchema.parse(value.allocation)) })
    : Object.freeze({ ...value })
}
