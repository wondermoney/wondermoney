import { formatCategoryName } from './category-name'

describe('formatCategoryName', () => {
  it('brings a shouted category back to sentence case', () => {
    expect(formatCategoryName('HOUSING')).toBe('Housing')
    expect(formatCategoryName('FOOD & DRINK')).toBe('Food & Drink')
  })

  it('leaves names the API already sends in sentence case alone', () => {
    expect(formatCategoryName('Groceries')).toBe('Groceries')
    expect(formatCategoryName('Cafe, Restaurants & Bars')).toBe('Cafe, Restaurants & Bars')
  })

  it('leaves short all-caps words as the acronyms they are', () => {
    expect(formatCategoryName('ETF')).toBe('ETF')
    expect(formatCategoryName('IVA')).toBe('IVA')
    expect(formatCategoryName('TV, Phone & Internet')).toBe('TV, Phone & Internet')
  })

  it('turns a raw API key into something readable', () => {
    // The reports endpoints return the key rather than a display name.
    expect(formatCategoryName('RENT_MORTGAGE')).toBe('Rent Mortgage')
    expect(formatCategoryName('CAFE_RESTAURANTS_BARS')).toBe('Cafe Restaurants Bars')
    expect(formatCategoryName('TV_PHONE_INTERNET')).toBe('TV Phone Internet')
  })

  it('does not mistake a joining word for an acronym', () => {
    expect(formatCategoryName('HOBBIES_AND_LEISURE')).toBe('Hobbies and Leisure')
    expect(formatCategoryName('BANK_OF_PORTUGAL')).toBe('Bank of Portugal')
    // Still an acronym, still left alone.
    expect(formatCategoryName('TV_PHONE_INTERNET')).toBe('TV Phone Internet')
  })

  it('preserves the separators it splits on', () => {
    expect(formatCategoryName('RENT & MORTGAGE')).toBe('Rent & Mortgage')
    expect(formatCategoryName('HEALTH/WELLNESS')).toBe('Health/Wellness')
  })
})
