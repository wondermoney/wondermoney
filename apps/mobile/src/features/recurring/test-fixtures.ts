import type { RecurringItemDto, RecurringSummaryDto } from './recurring-contract'

export const recurringItemFixture: RecurringItemDto = {
  recurringSeriesKey: 7,
  type: 'subscription',
  status: 'confirmed',
  source: 'detected',
  confidenceScore: 96,
  displayName: 'Music service',
  normalizedMerchantKey: 'music-service',
  cadence: 'monthly',
  cadenceConfidence: 94,
  amountType: 'fixed',
  expectedAmount: 10.99,
  expectedAmountMin: null,
  expectedAmountMax: null,
  averageAmount: 10.99,
  lastAmount: 10.99,
  nextExpectedAt: '2026-08-03T10:00:00.000Z',
  lastSeenAt: '2026-07-03T10:00:00.000Z',
  occurrenceCount: 6,
  accountKey: { accountKey: 2 },
  category: { categoryKey: 4, name: 'Entertainment', isSystemCategory: true, bgColor: '#fff', textColor: '#000', icon: null },
  currency: { currencyKey: 1, code: 'EUR' },
}

export const recurringSummaryFixture: RecurringSummaryDto = {
  billMaxTotal: 1260,
  billMinTotal: 1240,
  currencyTotals: {
    EUR: { billMaxTotal: 1260, billMinTotal: 1240, count: 3, fixedTotal: 1210.99, monthlyMaxTotal: 1270.99, monthlyMinTotal: 1250.99, monthlyTotal: 1270.99, subscriptionMaxTotal: 10.99, subscriptionMinTotal: 10.99, variableMaxTotal: 60, variableMinTotal: 40 },
  },
  detectedIncludedCount: 3,
  fixedTotal: 1210.99,
  lastDetectedAt: '2026-07-19T09:00:00.000Z',
  monthlyMaxTotal: 1270.99,
  monthlyMinTotal: 1250.99,
  monthlyTotal: 1270.99,
  needsReviewCount: 1,
  subscriptionMaxTotal: 10.99,
  subscriptionMinTotal: 10.99,
  variableMaxTotal: 60,
  variableMinTotal: 40,
}
