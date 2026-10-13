import { AVAILABLE_COUNTRIES, AVAILABLE_EXCHANGES, AVAILABLE_INDUSTRIES, AVAILABLE_SECTORS } from './screener-canonical-lists'

describe('screener canonical lists', () => {
  it.each([
    ['sectors', AVAILABLE_SECTORS, 51],
    ['industries', AVAILABLE_INDUSTRIES, 219],
    ['countries', AVAILABLE_COUNTRIES, 95],
    ['exchanges', AVAILABLE_EXCHANGES, 7],
  ] as const)('matches web\'s exact %s count, with no duplicates or blank entries', (_label, list, expectedLength) => {
    expect(list).toHaveLength(expectedLength)
    expect(new Set(list).size).toBe(list.length)
    expect(list.every((value) => value.trim().length > 0)).toBe(true)
  })
})
