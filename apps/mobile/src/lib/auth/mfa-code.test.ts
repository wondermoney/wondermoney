import { isValidTotpCode, normalizeBackupCode, normalizeTotpCode } from './mfa-code'

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

describe('normalizeBackupCode', () => {
  it('keeps the case and drops pasted whitespace', () => {
    expect(normalizeBackupCode('  AbCdE-12345 \n')).toBe('AbCdE-12345')
    expect(normalizeBackupCode('AbCdE 12345')).toBe('AbCdE-12345')
  })

  it('puts back the hyphen of a code typed without it', () => {
    expect(normalizeBackupCode('abcde12345')).toBe('abcde-12345')
  })

  it('sends a code of another shape as typed', () => {
    expect(normalizeBackupCode('abc-12345')).toBe('abc-12345')
    expect(normalizeBackupCode('abcdef123456')).toBe('abcdef123456')
  })
})
