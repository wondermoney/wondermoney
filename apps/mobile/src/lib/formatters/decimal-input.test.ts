import { formatNumberInput, parseDecimalInput, parseNumberInput, toWireDecimalInput } from './decimal-input'

describe('decimal input', () => {
  it.each([
    ['1.234,56', 'pt-PT', 1234.56],
    ['1.234,56', 'es', 1234.56],
    ['1.234,56', 'en', 1234.56],
    ['1.000', 'pt-PT', 1000],
    ['1.000', 'es', 1000],
    ['1.000', 'en', 1],
    ['1,000', 'en', 1000],
    ['0,5', 'en', 0.5],
    ['-12,30', 'pt-PT', -12.3],
  ])('%s in %s is %s', (input, locale, expected) => {
    expect(parseNumberInput(input, locale)).toBe(expected)
  })

  it('rejects what it cannot read', () => {
    expect(parseNumberInput('1.2.3', 'pt-PT')).toBeNull()
    expect(parseNumberInput('abc', 'en')).toBeNull()
    expect(parseNumberInput('', 'en')).toBeNull()
  })

  it('returns a canonical dot-decimal string', () => {
    expect(parseDecimalInput('1.234,50', 'es')).toBe('1234.50')
  })
})

describe('formatNumberInput', () => {
  it.each([
    [1.234, 'pt-PT', '1,234'],
    [1.234, 'en', '1.234'],
    [1234.5, 'es', '1234,5'],
    [-12, 'en', '-12'],
  ])('writes %s for a %s input as %s', (value, locale, text) => {
    expect(formatNumberInput(value, locale)).toBe(text)
    expect(parseNumberInput(formatNumberInput(value, locale), locale)).toBe(value)
  })

  it('writes a wire decimal string in the locale', () => {
    expect(formatNumberInput('1.234', 'pt-PT')).toBe('1,234')
  })
})

describe('toWireDecimalInput', () => {
  it('turns what was typed into the dot-decimal text the models read', () => {
    expect(toWireDecimalInput('1.234,56', 'pt-PT')).toBe('1234.56')
    expect(toWireDecimalInput('1.000', 'es')).toBe('1000')
    expect(toWireDecimalInput('1.000', 'en')).toBe('1.000')
    expect(toWireDecimalInput('  ', 'en')).toBe('')
  })

  it('turns what it cannot read into text no number parser accepts', () => {
    for (const value of ['1.2.3', '1e3', 'Infinity', '0x10']) {
      expect(Number.isNaN(Number(toWireDecimalInput(value, 'pt-PT')))).toBe(true)
    }
  })
})
