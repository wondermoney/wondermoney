import { isValidTotpCode, normalizeTotpCode } from './mfa-code'

describe('normalizeTotpCode', () => {
  it('strips whitespace around and inside the code', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456')
  })
})

describe('isValidTotpCode', () => {
  it('accepts exactly six digits', () => {
    expect(isValidTotpCode('123456')).toBe(true)
  })

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['non-digit characters', '12345a'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidTotpCode(value)).toBe(false)
  })
})
