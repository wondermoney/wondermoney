import type { TransactionFilters } from '@/features/transactions/transactions-contract'

import type { InstallmentDto } from './installments-contract'

/**
 * Choosing a posted card row to link to an installment by hand (web:
 * `lib/installments/installment-link-candidates.ts`, same rules). The API links a row by itself only
 * when its marker, amount, card and date fit exactly one plan; the rest is linked here. The picker
 * offers posted charges on the plan's card within about a month of the scheduled day, of about the
 * installment's amount; "Show other amounts" drops the amount rule.
 */

/** How far either side of the scheduled day a posted row is still offered. */
export const LINK_WINDOW_DAYS = 31
/** The most rows one search reads: two months of a busy card. */
export const LINK_SEARCH_LIMIT = 500

const DAY_MS = 24 * 60 * 60 * 1000

/** The most an amount may differ and still read as the installment: 10%, at least 1.00. */
export const amountTolerance = (amount: number): number => Math.max(1, Math.abs(amount) * 0.1)

const dayNumber = (value: string): number => Math.round(Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`) / DAY_MS)
const cents = (amount: number): number => Math.round(Math.abs(amount) * 100)
const isoDay = (dayIndex: number): string => new Date(dayIndex * DAY_MS).toISOString().slice(0, 10)

/** The transaction-list filters that search for an installment's charge. */
export function linkSearchFilters(scheduledDate: string): TransactionFilters {
  const day = dayNumber(scheduledDate)
  return {
    fromDate: `${isoDay(day - LINK_WINDOW_DAYS)}T00:00:00.000Z`,
    toDate: `${isoDay(day + LINK_WINDOW_DAYS)}T23:59:59.999Z`,
    direction: 'out',
    statuses: ['BOOKED'],
    limit: LINK_SEARCH_LIMIT,
  }
}

/** The fields of a transaction row the picker reads. */
export type LinkableRow = Readonly<{
  transactionKey: number
  transactionDate: string
  settlementAmount?: number | null
  hidden?: boolean
  installment?: unknown
  description?: string | null
  transactionMerchantKey?: { name?: string | null } | null
}>

/** A real (not synthetic opening-balance) charge, not hidden, that pays no installment yet. */
export const isLinkableRow = (row: LinkableRow): boolean => (
  row.transactionKey > 0 && (row.settlementAmount ?? 0) < 0 && row.hidden !== true && !row.installment
)

export type LinkCandidate = Readonly<{
  transactionKey: number
  title: string
  /** `YYYY-MM-DD`. */
  day: string
  /** What the row charged, as a positive amount. */
  amount: number
  /** Row amount minus installment amount; 0 when they agree to the cent. */
  amountDifference: number
  dayDistance: number
}>

/**
 * The posted rows that could pay `installment`, closest first (amount, then date): within the date
 * window, and of about the installment's amount unless `showAllAmounts`.
 */
export function linkCandidates(
  rows: readonly LinkableRow[],
  installment: Pick<InstallmentDto, 'amount' | 'scheduledDate'>,
  { showAllAmounts = false }: { showAllAmounts?: boolean } = {},
): LinkCandidate[] {
  const scheduled = dayNumber(installment.scheduledDate)
  const tolerance = amountTolerance(installment.amount)
  return rows
    .filter(isLinkableRow)
    .map((row) => {
      const amountDifference = (cents(row.settlementAmount ?? 0) - cents(installment.amount)) / 100
      return {
        transactionKey: row.transactionKey,
        title: row.transactionMerchantKey?.name?.trim() || row.description?.trim() || '—',
        day: row.transactionDate.slice(0, 10),
        amount: cents(row.settlementAmount ?? 0) / 100,
        amountDifference,
        dayDistance: Math.abs(dayNumber(row.transactionDate) - scheduled),
      }
    })
    .filter((candidate) => candidate.dayDistance <= LINK_WINDOW_DAYS && (showAllAmounts || Math.abs(candidate.amountDifference) <= tolerance + 1e-9))
    .sort((a, b) => Math.abs(a.amountDifference) - Math.abs(b.amountDifference) || a.dayDistance - b.dayDistance)
}
