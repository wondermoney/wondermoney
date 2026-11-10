import { z } from 'zod'

import { formatRateDate, fxRateDateSchema, fxStatusSchema, resolveFxState } from './fx-status'

const foreign = { converted: -60, original: -10_000, fromCurrency: 'JPY', toCurrency: 'EUR' } as const

describe('resolveFxState', () => {
  it('reads an amount with no exchange rate as not converted, carrying the original to show', () => {
    expect(resolveFxState({ ...foreign, converted: null, fxStatus: 'missing' })).toEqual({ status: 'missing', amount: -10_000, currency: 'JPY' })
  })

  it('reads an amount converted at an old rate as estimated, with the rate date', () => {
    expect(resolveFxState({ ...foreign, fxStatus: 'provisional', fxRateDate: '2026-11-03' })).toEqual({ status: 'provisional', rateDate: '2026-11-03' })
  })

  it('reads a converted amount as exact', () => {
    expect(resolveFxState({ ...foreign, fxStatus: 'exact' })).toEqual({ status: 'exact' })
  })

  it('reads a legacy row with no status and no converted amount in another currency as not converted', () => {
    expect(resolveFxState({ ...foreign, converted: null, fxStatus: null })).toEqual({ status: 'missing', amount: -10_000, currency: 'JPY' })
  })

  it('reads an older API that sends no status, with a converted amount, as exact', () => {
    expect(resolveFxState(foreign)).toEqual({ status: 'exact' })
  })

  it('never marks an amount already in the user currency', () => {
    expect(resolveFxState({ ...foreign, converted: null, fromCurrency: 'EUR', fxStatus: 'missing' })).toEqual({ status: 'exact' })
  })
})

describe('fx status fields', () => {
  const schema = z.object({ fxStatus: fxStatusSchema, fxRateDate: fxRateDateSchema })

  it('parses the known statuses and the rate date', () => {
    expect(schema.parse({ fxStatus: 'provisional', fxRateDate: '2026-11-03' })).toEqual({ fxStatus: 'provisional', fxRateDate: '2026-11-03' })
  })

  it('reads an unknown status, a malformed date or absent fields as unknown, never failing the response', () => {
    expect(schema.parse({ fxStatus: 'guessed', fxRateDate: 'yesterday' })).toEqual({ fxStatus: null, fxRateDate: null })
    expect(schema.parse({})).toEqual({})
  })
})

describe('formatRateDate', () => {
  it('formats the calendar day in the reader locale, with no time zone shift', () => {
    expect(formatRateDate('2026-11-03', 'en-GB')).toBe('3 Nov 2026')
    expect(formatRateDate('2026-11-03', 'pt-PT')).toMatch(/3.*(11|nov).*2026/i)
  })
})
