import { buildManualAssetCreatePayload, buildManualAssetUpdatePayload, buildValuationPayload, manualAssetEditDraftOf, type ManualAssetCreateDraft } from './asset-forms-model'
import { assetFixture, walletAssetFixture } from './test-fixtures'

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

describe('Edit asset payload', () => {
  const start = manualAssetEditDraftOf(assetFixture, String)

  it('starts from the asset as it is, and has nothing to save until something changes', () => {
    expect(start).toEqual({ name: 'Family home', kind: 'property', purchasePrice: '200000', purchaseDate: '2025-01-10', growthRatePercent: '', growthStartDate: '', isPrivate: false, notes: '' })
    expect(buildManualAssetUpdatePayload(assetFixture, start)).toEqual({ success: true, payload: null })
    // Whitespace alone changes nothing.
    expect(buildManualAssetUpdatePayload(assetFixture, { ...start, name: ' Family home ', notes: '  ' })).toEqual({ success: true, payload: null })
  })

  it('sends only what changed, trimmed', () => {
    expect(buildManualAssetUpdatePayload(assetFixture, { ...start, name: ' Beach house ', kind: 'other', notes: ' Keys with Rui ' })).toEqual({
      success: true, payload: { name: 'Beach house', kind: 'other', notes: 'Keys with Rui' },
    })
  })

  it('clears an optional field with null, as the web does', () => {
    expect(buildManualAssetUpdatePayload({ ...assetFixture, notes: 'Old note' }, { ...start, purchasePrice: '', purchaseDate: '', notes: '' })).toEqual({
      success: true, payload: { purchasePrice: null, purchaseDate: null, notes: null },
    })
    const growing = { ...assetFixture, growthRule: { annualRatePercent: 3, startDate: '2027-01-01' } }
    expect(buildManualAssetUpdatePayload(growing, { ...manualAssetEditDraftOf(growing, String), growthRatePercent: '' })).toEqual({ success: true, payload: { growthRule: null } })
  })

  it('sends a yearly change with its start date, and a start date only with a change', () => {
    expect(buildManualAssetUpdatePayload(assetFixture, { ...start, growthRatePercent: '-15', growthStartDate: '2027-01-01' })).toEqual({
      success: true, payload: { growthRule: { annualRatePercent: -15, startDate: '2027-01-01' } },
    })
    expect(buildManualAssetUpdatePayload(assetFixture, { ...start, growthStartDate: '2027-01-01' })).toEqual({ success: true, payload: null })
  })

  it('flags every wrong field in one pass', () => {
    const result = buildManualAssetUpdatePayload(assetFixture, { ...start, name: '  ', purchasePrice: '-1', growthRatePercent: '-100' })
    expect(result.success).toBe(false)
    if (!result.success) expect([...result.invalidFields].sort()).toEqual(['growthRatePercent', 'name', 'purchasePrice'])
    const unreadable = buildManualAssetUpdatePayload(assetFixture, { ...start, purchasePrice: 'invalid', growthRatePercent: '1001' })
    if (!unreadable.success) expect([...unreadable.invalidFields].sort()).toEqual(['growthRatePercent', 'purchasePrice'])
    else throw new Error('expected a failure')
  })

  it('changes privacy only for the owner', () => {
    expect(buildManualAssetUpdatePayload(assetFixture, { ...start, isPrivate: true })).toEqual({ success: true, payload: { isPrivate: true } })
    const notMine = { ...assetFixture, isOwner: false }
    expect(buildManualAssetUpdatePayload(notMine, { ...manualAssetEditDraftOf(notMine, String), isPrivate: true })).toEqual({ success: true, payload: null })
  })

  it('changes only the name, notes and privacy of a crypto wallet', () => {
    const wallet = manualAssetEditDraftOf(walletAssetFixture, String)
    expect(buildManualAssetUpdatePayload(walletAssetFixture, { ...wallet, name: 'Ledger', kind: 'vehicle', purchasePrice: '5', notes: 'Hardware' })).toEqual({
      success: true, payload: { name: 'Ledger', notes: 'Hardware' },
    })
  })
})
