import {
  formatCurrency,
  formatPercentagePoints,
  formatPercent,
  formatSignedNumber,
} from './financial'

class IosHermesNumberFormat {
  locale: string

  options: Intl.NumberFormatOptions

  constructor(locale: string, options: Intl.NumberFormatOptions = {}) {
    if ('signDisplay' in options) {
      throw new TypeError('signDisplay is not supported')
    }

    this.locale = locale
    this.options = options
  }

  format(value: number) {
    if (this.options.style === 'currency') {
      return `currency:${this.locale}:${this.options.currency}:${value}`
    }

    if (this.options.style === 'percent') {
      return `percent:${this.locale}:${value}`
    }

    return `number:${this.locale}:${value}`
  }
}

describe('financial formatters', () => {
  const originalNumberFormat = Intl.NumberFormat

  afterEach(() => {
    Intl.NumberFormat = originalNumberFormat
  })

  it('formats with format() only on iOS-limited Hermes', () => {
    Intl.NumberFormat = IosHermesNumberFormat as never

    expect(formatCurrency(1234.5, { locale: 'pt-PT', currency: 'EUR' })).toBe(
      'currency:pt-PT:EUR:1234.5',
    )
    expect(formatSignedNumber(12.5, 'en-US')).toBe('+number:en-US:12.5')
    expect(formatSignedNumber(-12.5, 'en-US')).toBe('number:en-US:-12.5')
    expect(formatSignedNumber(0, 'en-US')).toBe('number:en-US:0')
    expect(formatSignedNumber(-0, 'en-US')).toBe('number:en-US:0')
    expect(formatPercent(0.125, 'en-US')).toBe('+percent:en-US:0.125')
    expect(formatPercent(-0.125, 'en-US')).toBe('percent:en-US:-0.125')
    expect(formatPercent(0, 'en-US')).toBe('percent:en-US:0')
    expect(formatPercent(-0, 'en-US')).toBe('percent:en-US:0')
    expect(formatPercentagePoints(12.5, 'en-US')).toBe('+percent:en-US:0.125')
  })

  it('normalizes negative zero before formatting', () => {
    class NegativeZeroAwareNumberFormat extends IosHermesNumberFormat {
      override format(value: number) {
        if (Object.is(value, -0)) {
          if (this.options.style === 'percent') {
            return `percent:${this.locale}:-0`
          }

          return `number:${this.locale}:-0`
        }

        return super.format(value)
      }
    }

    Intl.NumberFormat = NegativeZeroAwareNumberFormat as never

    expect(formatSignedNumber(-0, 'en-US')).toBe('number:en-US:0')
    expect(formatPercent(-0, 'en-US')).toBe('percent:en-US:0')
  })

  it('rejects non-finite values before formatting', () => {
    expect(() => formatCurrency(Number.NaN, { locale: 'en-US', currency: 'USD' })).toThrow(
      /finite/i,
    )
    expect(() => formatPercent(Number.POSITIVE_INFINITY, 'en-US')).toThrow(/finite/i)
    expect(() => formatSignedNumber(Number.NEGATIVE_INFINITY, 'en-US')).toThrow(/finite/i)
  })
})

describe('financial formatters with native Intl', () => {
  it('formats currency with explicit locale and currency', () => {
    expect(formatCurrency(1234.5, { locale: 'en-US', currency: 'USD' })).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5),
    )
  })

  it('formats pt-PT currency and decimal punctuation', () => {
    expect(formatCurrency(12.5, { locale: 'pt-PT', currency: 'EUR' })).toContain('€')
    expect(formatCurrency(12.5, { locale: 'pt-PT', currency: 'EUR' })).toBe(
      new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(12.5),
    )
  })

  it('formats negative values with a visible sign rather than color-only meaning', () => {
    expect(formatPercent(0.125, 'en-US')).toBe(
      `+${new Intl.NumberFormat('en-US', { style: 'percent' }).format(0.125)}`,
    )

    expect(formatSignedNumber(12.5, 'en-US')).toBe(`+${new Intl.NumberFormat('en-US').format(12.5)}`)
    expect(formatSignedNumber(-12.5, 'en-US')).toBe(new Intl.NumberFormat('en-US').format(-12.5))
    expect(formatPercent(-0.125, 'en-US')).toBe(
      new Intl.NumberFormat('en-US', { style: 'percent' }).format(-0.125),
    )
  })

  it('converts API percentage points to a ratio explicitly', () => {
    expect(formatPercentagePoints(12.4, 'en-US', { maximumFractionDigits: 1 })).toBe('+12.4%')
    expect(formatPercentagePoints(-3.2, 'en-US', { maximumFractionDigits: 1 })).toBe('-3.2%')
  })

  it('requires explicit currency and locale control', () => {
    expect(() => formatCurrency(10, { locale: 'en-US', currency: undefined as never })).toThrow()
    expect(() => formatCurrency(10, { locale: 'en-US', currency: '' as never })).toThrow()
  })

  it('keeps negative zero unsigned for signed numbers and percent', () => {
    expect(formatSignedNumber(-0, 'en-US')).toBe('0')
    expect(formatPercent(-0, 'en-US')).toBe('0%')
  })
})
