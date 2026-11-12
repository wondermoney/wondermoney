import { securedAssetOptions } from './loan-secured-asset'

const asset = (manualAssetKey: number, name: string, archived = false) => ({ manualAssetKey, name, archived })

describe('securedAssetOptions', () => {
  it('offers the assets that count today, by name, leaving archived ones out', () => {
    expect(securedAssetOptions([asset(9, 'family home'), asset(5, 'Sold car', true), asset(2, 'Car')], null))
      .toEqual([{ key: 2, name: 'Car' }, { key: 9, name: 'family home' }])
  })

  it('keeps the linked asset even when it is archived', () => {
    expect(securedAssetOptions([asset(9, 'Family home'), asset(4, 'Old flat', true)], { key: 4, name: 'Old flat' }))
      .toEqual([{ key: 9, name: 'Family home' }, { key: 4, name: 'Old flat' }])
  })

  it('names the linked asset from the loan while the asset list is unavailable', () => {
    expect(securedAssetOptions(undefined, { key: 4, name: 'Family home' })).toEqual([{ key: 4, name: 'Family home' }])
    expect(securedAssetOptions(undefined, null)).toEqual([])
  })
})
