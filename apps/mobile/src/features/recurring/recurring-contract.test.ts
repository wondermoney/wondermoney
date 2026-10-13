import { createConfirmRecurringEndpoint, createDismissRecurringEndpoint, createUpdateRecurringEndpoint, recurringDetectionEndpoint, recurringDetectionResponseSchema, recurringItemsEndpoint, recurringItemsResponseSchema, recurringMetadataSchema, recurringRestoreSchema, recurringSummaryEndpoint, recurringSummarySchema } from './recurring-contract'
import { recurringItemFixture, recurringSummaryFixture } from './test-fixtures'

describe('recurring API contracts', () => {
  it('parses the actual strict list shape with nullish documented context', () => {
    const result = recurringItemsResponseSchema.parse({ items: [{ ...recurringItemFixture, accountKey: null, currency: undefined, category: null, expectedAmount: undefined, nextExpectedAt: null }] })
    expect(result.items[0]).toMatchObject({ accountKey: null, category: null, nextExpectedAt: null })
    expect(recurringItemsEndpoint).toMatchObject({ method: 'GET', path: '/v1/recurring' })
  })
  it('parses the flat server summary and strict per-currency totals', () => {
    expect(recurringSummarySchema.parse(recurringSummaryFixture)).toEqual(recurringSummaryFixture)
    expect(recurringSummaryEndpoint).toMatchObject({ method: 'GET', path: '/v1/recurring/summary' })
  })
  it.each([
    ['number account relation', { ...recurringItemFixture, accountKey: 2 }],
    ['currency symbol', { ...recurringItemFixture, currency: { currencyKey: 1, code: 'EUR', symbol: '€' } }],
    ['invalid currency code', { ...recurringItemFixture, currency: { currencyKey: 1, code: 'eur' } }],
    ['non-finite money', { ...recurringItemFixture, expectedAmount: Infinity }],
    ['unknown enum', { ...recurringItemFixture, cadence: 'daily' }],
    ['invalid date', { ...recurringItemFixture, lastSeenAt: 'yesterday' }],
  ])('rejects %s', (_name, item) => {
    expect(recurringItemsResponseSchema.safeParse({ items: [item] }).success).toBe(false)
  })
  it('rejects wrapped, partial, and non-finite summaries', () => {
    expect(recurringSummarySchema.safeParse({ summary: recurringSummaryFixture }).success).toBe(false)
    expect(recurringSummarySchema.safeParse({ ...recurringSummaryFixture, monthlyTotal: Infinity }).success).toBe(false)
    const { needsReviewCount: _missing, ...partial } = recurringSummaryFixture
    expect(recurringSummarySchema.safeParse(partial).success).toBe(false)
  })
  it('defines strict confirm, dismiss, and returned-DTO update contracts', () => {
    expect(createConfirmRecurringEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/recurring/7/confirm' })
    expect(createDismissRecurringEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/recurring/7/dismiss' })
    const update = createUpdateRecurringEndpoint(7)
    expect(update).toMatchObject({ method: 'PATCH', path: '/v1/recurring/7' })
    expect(update.schema.parse({ recurringSeries: recurringItemFixture })).toEqual({ recurringSeries: recurringItemFixture })
    expect(() => createConfirmRecurringEndpoint(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => createDismissRecurringEndpoint(0)).toThrow()
  })
  it('defines the exact no-body detection endpoint and strict safe counts', () => {
    expect(recurringDetectionEndpoint).toMatchObject({ method: 'POST', path: '/v1/recurring/detect' })
    expect(recurringDetectionResponseSchema.parse({ created: 1, updated: 2, skipped: 3 })).toEqual({ created: 1, updated: 2, skipped: 3 })
    for (const response of [
      { created: -1, updated: 0, skipped: 0 },
      { created: 0.5, updated: 0, skipped: 0 },
      { created: Number.POSITIVE_INFINITY, updated: 0, skipped: 0 },
      { created: Number.MAX_SAFE_INTEGER + 1, updated: 0, skipped: 0 },
      { created: 0, updated: 0, skipped: 0, extra: 1 },
      { created: 0, updated: 0 },
    ]) expect(recurringDetectionResponseSchema.safeParse(response).success).toBe(false)
  })
  it('validates partial metadata with API enums, non-negative money, ranges, and category ids', () => {
    expect(recurringMetadataSchema.parse({ displayName: 'Rent', categoryKey: null, expectedAmount: 0 })).toEqual({ displayName: 'Rent', categoryKey: null, expectedAmount: 0 })
    expect(recurringMetadataSchema.safeParse({ cadence: 'daily' }).success).toBe(false)
    expect(recurringMetadataSchema.safeParse({ expectedAmount: -1 }).success).toBe(false)
    expect(recurringMetadataSchema.safeParse({ expectedAmountMin: 20, expectedAmountMax: 10 }).success).toBe(false)
    expect(recurringMetadataSchema.safeParse({ categoryKey: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false)
    expect(recurringMetadataSchema.safeParse({ displayName: 'Rent', status: 'paused' }).success).toBe(false)
  })
  it('restores only via the literal candidate status, reusing the update endpoint', () => {
    expect(recurringRestoreSchema.parse({ status: 'candidate' })).toEqual({ status: 'candidate' })
    expect(recurringRestoreSchema.safeParse({ status: 'confirmed' }).success).toBe(false)
    expect(recurringRestoreSchema.safeParse({}).success).toBe(false)
    expect(recurringRestoreSchema.safeParse({ status: 'candidate', displayName: 'Rent' }).success).toBe(false)
    expect(createUpdateRecurringEndpoint(7)).toMatchObject({ method: 'PATCH', path: '/v1/recurring/7' })
  })
})
