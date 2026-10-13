import type { BankInstitutionDto } from '../institutions-contract'
import { filterBankInstitutions, mapBankInstitutions } from '../institutions-view-model'

const dto = (over: Partial<BankInstitutionDto> = {}): BankInstitutionDto => ({
  id: 'REVOLUT_REVOGB21',
  name: 'Revolut',
  logo: 'https://cdn-logos.gocardless.com/ais/REVOLUT_REVOGB21.png',
  ...over,
})

describe('mapBankInstitutions', () => {
  it('projects the DTO into the render row shape', () => {
    expect(mapBankInstitutions([dto()])).toEqual([
      { id: 'REVOLUT_REVOGB21', name: 'Revolut', logo: 'https://cdn-logos.gocardless.com/ais/REVOLUT_REVOGB21.png' },
    ])
  })

  it('returns an empty list for an empty response', () => {
    expect(mapBankInstitutions([])).toEqual([])
  })

  it('preserves a null logo rather than coercing it', () => {
    expect(mapBankInstitutions([dto({ logo: null })])).toEqual([
      { id: 'REVOLUT_REVOGB21', name: 'Revolut', logo: null },
    ])
  })
})

describe('filterBankInstitutions', () => {
  const rows = mapBankInstitutions([
    dto({ id: '1', name: 'Revolut' }),
    dto({ id: '2', name: 'N26' }),
    dto({ id: '3', name: '🧪 Sandbox Finance (test)' }),
  ])

  it('returns every row for a blank query', () => {
    expect(filterBankInstitutions(rows, '')).toEqual(rows)
    expect(filterBankInstitutions(rows, '   ')).toEqual(rows)
  })

  it('matches case-insensitively on a substring of the name', () => {
    expect(filterBankInstitutions(rows, 'revo').map((row) => row.id)).toEqual(['1'])
    expect(filterBankInstitutions(rows, 'N26').map((row) => row.id)).toEqual(['2'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterBankInstitutions(rows, 'nonexistent-bank')).toEqual([])
  })
})
