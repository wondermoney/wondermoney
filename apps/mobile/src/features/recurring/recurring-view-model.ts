import type { RecurringItemDto, RecurringSummaryDto } from './recurring-contract'

export type RecurringRowViewModel = Readonly<{
  id: number
  name: string
  type: RecurringItemDto['type']
  status: RecurringItemDto['status']
  cadence: RecurringItemDto['cadence']
  amountType: RecurringItemDto['amountType']
  amount: number | null
  amountMin: number | null
  amountMax: number | null
  currency: string | null
  nextExpectedAt: string | null
  lastSeenAt: string | null
  categoryName: string | null
  categoryId: number | null
  accountId: number | null
  accountName: string | null
  confidenceScore: number
  needsReview: boolean
  includedInSummary: boolean
}>

export type RecurringSummaryViewModel = Readonly<{
  lastDetectedAt: string | null
  monthlyTotal: number
  monthlyMinTotal: number
  monthlyMaxTotal: number
  subscriptionMinTotal: number
  subscriptionMaxTotal: number
  billMinTotal: number
  billMaxTotal: number
  detectedIncludedCount: number
  needsReviewCount: number
  currencyTotals: readonly Readonly<{
    currency: string
    count: number
    monthlyTotal: number
    monthlyMinTotal: number
    monthlyMaxTotal: number
  }>[]
}>

export function mapRecurringItems(
  input: { items: readonly RecurringItemDto[] },
  accountNames: ReadonlyMap<number, string | null> = new Map(),
): RecurringRowViewModel[] {
  return input.items.map((item) => ({
    id: item.recurringSeriesKey,
    name: item.displayName,
    type: item.type,
    status: item.status,
    cadence: item.cadence,
    amountType: item.amountType,
    amount: item.expectedAmount ?? null,
    amountMin: item.expectedAmountMin ?? null,
    amountMax: item.expectedAmountMax ?? null,
    currency: item.currency?.code ?? null,
    nextExpectedAt: item.nextExpectedAt ?? null,
    lastSeenAt: item.lastSeenAt ?? null,
    categoryName: item.category?.name ?? null,
    categoryId: item.category?.categoryKey ?? null,
    accountId: item.accountKey?.accountKey ?? null,
    accountName: item.accountKey ? (accountNames.get(item.accountKey.accountKey) ?? null) : null,
    confidenceScore: item.confidenceScore,
    needsReview: item.confidenceScore < 90,
    includedInSummary: item.status === 'confirmed'
      || (item.status === 'candidate' && item.confidenceScore >= 90),
  })).sort((a, b) => {
    if (a.nextExpectedAt === null) return b.nextExpectedAt === null ? 0 : 1
    if (b.nextExpectedAt === null) return -1
    return a.nextExpectedAt.localeCompare(b.nextExpectedAt)
  })
}

export function mapRecurringSummary(summary: RecurringSummaryDto): RecurringSummaryViewModel {
  return {
    lastDetectedAt: summary.lastDetectedAt ?? null,
    monthlyTotal: summary.monthlyTotal,
    monthlyMinTotal: summary.monthlyMinTotal,
    monthlyMaxTotal: summary.monthlyMaxTotal,
    subscriptionMinTotal: summary.subscriptionMinTotal,
    subscriptionMaxTotal: summary.subscriptionMaxTotal,
    billMinTotal: summary.billMinTotal,
    billMaxTotal: summary.billMaxTotal,
    detectedIncludedCount: summary.detectedIncludedCount,
    needsReviewCount: summary.needsReviewCount,
    currencyTotals: Object.entries(summary.currencyTotals).map(([currency, totals]) => ({
      currency,
      count: totals.count,
      monthlyTotal: totals.monthlyTotal,
      monthlyMinTotal: totals.monthlyMinTotal,
      monthlyMaxTotal: totals.monthlyMaxTotal,
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
  }
}
