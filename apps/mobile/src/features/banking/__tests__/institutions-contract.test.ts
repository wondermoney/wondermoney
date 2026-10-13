import { bankInstitutionsResponseSchema, createBankInstitutionsEndpoint } from '../institutions-contract'

const institution = {
  id: 'REVOLUT_REVOGB21',
  name: 'Revolut',
  bic: 'REVOGB21',
  transaction_total_days: '90',
  countries: ['GB'],
  logo: 'https://cdn-logos.gocardless.com/ais/REVOLUT_REVOGB21.png',
}

describe('bankInstitutionsResponseSchema', () => {
  it('accepts the raw GoCardless institution array', () => {
    const parsed = bankInstitutionsResponseSchema.parse([institution])
    expect(parsed).toEqual([{ id: institution.id, name: institution.name, logo: institution.logo }])
  })

  it('accepts an empty list', () => {
    expect(bankInstitutionsResponseSchema.parse([])).toEqual([])
  })

  it('tolerates upstream fields beyond id/name/logo (passthrough, not our own DTO)', () => {
    expect(() => bankInstitutionsResponseSchema.parse([institution])).not.toThrow()
  })

  it('rejects an entry missing a required field', () => {
    const { name: _name, ...missingName } = institution
    expect(bankInstitutionsResponseSchema.safeParse([missingName]).success).toBe(false)
  })

  it('rejects a blank id or name', () => {
    expect(bankInstitutionsResponseSchema.safeParse([{ ...institution, id: '' }]).success).toBe(false)
    expect(bankInstitutionsResponseSchema.safeParse([{ ...institution, name: '  ' }]).success).toBe(false)
  })

  it('accepts a missing/null logo', () => {
    const parsed = bankInstitutionsResponseSchema.parse([{ ...institution, logo: null }])
    expect(parsed).toEqual([{ id: institution.id, name: institution.name, logo: null }])
  })
})

describe('createBankInstitutionsEndpoint', () => {
  it('targets GET /v1/banking/bank with no query string when no country is known', () => {
    const endpoint = createBankInstitutionsEndpoint()
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/banking/bank')
    expect(endpoint.schema).toBe(bankInstitutionsResponseSchema)
  })

  it('appends an encoded country query param when known', () => {
    const endpoint = createBankInstitutionsEndpoint('PT')
    expect(endpoint.path).toBe('/v1/banking/bank?country=PT')
  })
})
