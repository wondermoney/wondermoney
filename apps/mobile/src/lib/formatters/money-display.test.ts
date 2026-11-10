import { formatMoneyForDisplay, formatQuantityForDisplay, maskMoney, PRIVACY_MASK } from './money-display'

describe('maskMoney', () => {
  it('keeps the currency symbol where the locale puts it', () => {
    expect(maskMoney('en', 'EUR')).toBe(`€${PRIVACY_MASK}`)
    expect(maskMoney('pt-PT', 'EUR').endsWith('€')).toBe(true)
    expect(maskMoney('pt-PT', 'EUR').startsWith(PRIVACY_MASK)).toBe(true)
  })

  it('is the bare mask when the currency is unknown', () => {
    expect(maskMoney('en', null)).toBe(PRIVACY_MASK)
  })

  it('falls back to the mask beside the code for a malformed currency', () => {
    expect(maskMoney('en', 'not-a-code')).toBe(`${PRIVACY_MASK} not-a-code`)
  })
})

describe('formatMoneyForDisplay', () => {
  it('formats the amount when privacy mode is off', () => {
    expect(formatMoneyForDisplay(1234.5, { locale: 'en', currency: 'EUR' }, false)).toBe('€1,234.50')
    expect(formatMoneyForDisplay(1850, { locale: 'en', currency: null }, false)).toBe('1,850.00')
  })

  it('carries no digit of the amount when privacy mode is on', () => {
    for (const value of [0, 12, -12_345.67, 9_999_999]) {
      const masked = formatMoneyForDisplay(value, { locale: 'en', currency: 'EUR' }, true)
      expect(masked).toBe(`€${PRIVACY_MASK}`)
      expect(masked).not.toMatch(/\d/)
    }
    expect(formatMoneyForDisplay(1850, { locale: 'en', currency: null }, true)).toBe(PRIVACY_MASK)
  })
})

describe('formatQuantityForDisplay', () => {
  it('formats the unit count in the locale when privacy mode is off', () => {
    expect(formatQuantityForDisplay(1234.5, { locale: 'en' }, false)).toBe('1,234.5')
    expect(formatQuantityForDisplay(0.123456789, { locale: 'en', maximumFractionDigits: 6 }, false)).toBe('0.123457')
  })

  it('is the fixed mask, with no digit or magnitude, when privacy mode is on', () => {
    for (const value of [0, 1, -3, 0.00000001, 12_345_678.9]) {
      const masked = formatQuantityForDisplay(value, { locale: 'pt-PT' }, true)
      expect(masked).toBe(PRIVACY_MASK)
      expect(masked).not.toMatch(/\d/)
    }
  })
})
