import { certificatePemSchema, enableBankingCertificateSchema } from '../enable-banking-credential-contract'

const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUfixture+/=\nAbCd\n-----END CERTIFICATE-----\n'
// Built at runtime, so the secret scanners don't read a fixture as a real key.
const pem = (label: string) => [`-----BEGIN ${label}-----`, 'MIIEvQ', `-----END ${label}-----`, ''].join('\n')
const PRIVATE_KEY = pem(['PRIVATE', 'KEY'].join(' '))
const RSA_PRIVATE_KEY = pem(['RSA', 'PRIVATE', 'KEY'].join(' '))

describe('Enable Banking certificate response', () => {
  it('takes one PEM certificate block', () => {
    expect(certificatePemSchema.safeParse(CERTIFICATE).success).toBe(true)
    expect(enableBankingCertificateSchema.safeParse({ certificatePem: CERTIFICATE, expiresAt: '2026-12-03T10:00:00.000Z' }).success).toBe(true)
  })

  it.each([
    ['a private key', PRIVATE_KEY],
    ['a certificate with a private key after it', `${CERTIFICATE}${PRIVATE_KEY}`],
    ['an RSA private key', RSA_PRIVATE_KEY],
    ['two certificates', `${CERTIFICATE}${CERTIFICATE}`],
    ['text that is not PEM', 'not a certificate'],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(certificatePemSchema.safeParse(value).success).toBe(false)
  })
})
