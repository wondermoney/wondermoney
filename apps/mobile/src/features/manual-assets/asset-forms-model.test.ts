import { buildManualAssetCreatePayload, buildValuationPayload, type ManualAssetCreateDraft } from './asset-forms-model'

const draft: ManualAssetCreateDraft = {
  name: ' Family home ',
  kind: 'property',
  currencyId: 1,
  value: '250000.5',
  valuationDate: '2026-11-10',
  purchasePrice: '',
  purchaseDate: '',
  growthRatePercent: '',
  isPrivate: false,
  notes: '',
}

describe('asset forms', () => {
  it('builds the smallest Add asset payload, leaving empty optional fields out', () => {
    expect(buildManualAssetCreatePayload(draft)).toEqual({
      success: true,
      payload: { name: 'Family home', kind: 'property', currencyKey: 1, value: 250_000.5, valuationDate: '2026-11-10', isPrivate: false },
    })
  })

  it('adds the purchase, a depreciation rule, privacy and notes when given', () => {
    const result = buildManualAssetCreatePayload({ ...draft, purchasePrice: '200000', purchaseDate: '2025-01-10', growthRatePercent: '-15.5', isPrivate: true, notes: ' Keys with Ana ' })
    expect(result).toMatchObject({ success: true, payload: { purchasePrice: 200_000, purchaseDate: '2025-01-10', growthRule: { annualRatePercent: -15.5 }, isPrivate: true, notes: 'Keys with Ana' } })
  })

  it('reports every wrong field in one pass, and an unreadable amount is never another number', () => {
    const result = buildManualAssetCreatePayload({ ...draft, name: ' ', kind: null, currencyId: null, value: 'invalid', purchasePrice: '-1', growthRatePercent: '-100' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect([...result.invalidFields].sort()).toEqual(['currencyId', 'growthRatePercent', 'kind', 'name', 'purchasePrice', 'value'])
  })

  it('needs a value to add an asset', () => {
    const result = buildManualAssetCreatePayload({ ...draft, value: '' })
    expect(result.success).toBe(false)
  })

  it('records a valuation with a trimmed note, and refuses a negative or missing value', () => {
    expect(buildValuationPayload({ value: '265000', date: '2026-11-10', note: '  Agent ' })).toEqual({ success: true, payload: { value: 265_000, date: '2026-11-10', note: 'Agent' } })
    expect(buildValuationPayload({ value: '-1', date: '2026-11-10', note: '' })).toMatchObject({ success: false })
    expect(buildValuationPayload({ value: '', date: '2026-11-10', note: '' })).toMatchObject({ success: false })
    expect(buildValuationPayload({ value: '1', date: 'soon', note: '' })).toMatchObject({ success: false })
  })
})
