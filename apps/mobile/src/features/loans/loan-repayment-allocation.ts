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

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const localeSeparators = (locale: string): { decimal: string; groupPattern: string } => {
  const normalized = locale.toLowerCase()
  if (normalized === 'en' || normalized.startsWith('en-')) return { decimal: '.', groupPattern: ',' }
  if (normalized === 'pt' || normalized.startsWith('pt-')) return { decimal: ',', groupPattern: '[\\u0020\\u00a0\\u202f]' }
  if (normalized === 'es' || normalized.startsWith('es-')) return { decimal: ',', groupPattern: '\\.' }
  throw new Error('Unsupported money locale.')
}

export function parseUnsignedLocaleAmount(value: string, locale: string): number {
  const { decimal, groupPattern } = localeSeparators(locale)
  const trimmed = value.trim()
  const integerPattern = `(?:\\d+|\\d{1,3}(?:${groupPattern}\\d{3})+)`
  const pattern = new RegExp(`^${integerPattern}(?:${escapeRegex(decimal)}\\d+)?$`, 'u')
  if (!pattern.test(trimmed)) throw new Error('Enter a correctly grouped unsigned number.')
  const withoutGroups = trimmed.replace(new RegExp(groupPattern, 'gu'), '')
  const normalized = decimal === '.' ? withoutGroups : withoutGroups.replace(decimal, '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error('Enter a finite number.')
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
