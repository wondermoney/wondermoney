import { amountExpressionResult, formatNumberInput, parseAmountInput, parseDecimalInput, parseNumberInput, toWireDecimalInput } from './decimal-input'

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

describe('parseAmountInput', () => {
  it('reads a plain number exactly as before', () => {
    expect(parseAmountInput('1.234,56', 'pt-PT')).toBe('1234.56')
    expect(parseAmountInput('1.000', 'es')).toBe('1000')
    expect(parseAmountInput('1.000', 'en')).toBe('1.000')
    expect(parseAmountInput('-12,50', 'es')).toBe('-12.50')
  })

  it('evaluates an expression in the reader\'s locale', () => {
    expect(parseAmountInput('12.40+3.15', 'en')).toBe('15.55')
    expect(parseAmountInput('12,40+3,15', 'pt-PT')).toBe('15.55')
    expect(parseAmountInput('12,40+3,15', 'es')).toBe('15.55')
    expect(parseAmountInput('100+27', 'en')).toBe('127')
  })

  it('rejects what is neither a number nor a usable expression', () => {
    for (const value of ['', 'abc', '2+', '(2+3', '1/0']) {
      expect(parseAmountInput(value, 'en')).toBeNull()
    }
  })
})

describe('amountExpressionResult', () => {
  it('has no hint for a plain number or a blank field', () => {
    expect(amountExpressionResult('12.50', 'en')).toBeNull()
    expect(amountExpressionResult('-12,50', 'pt-PT')).toBeNull()
    expect(amountExpressionResult('', 'en')).toBeNull()
  })

  it('returns the result while the text is an expression', () => {
    expect(amountExpressionResult('12.40+3.15', 'en')).toBe(15.55)
    expect(amountExpressionResult('12,40+3,15', 'pt-PT')).toBe(15.55)
    expect(amountExpressionResult('12,40+', 'pt-PT')).toBeNull()
  })
})
