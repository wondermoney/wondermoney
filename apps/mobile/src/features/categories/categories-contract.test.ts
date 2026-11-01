import { categoriesEndpoint, categoriesResponseSchema, categoryCreateWriteSchema, categoryEditWriteSchema, createCategoryEditEndpoint, createCategoryEndpoint, parseCategoryId } from './categories-contract'
import { categoriesKey } from './use-categories'

const item = { categoryKey: 1, name: 'HOUSING', textColor: '#111827', bgColor: '#fed7aa', icon: null, isSystemCategory: true }

describe('categories read contract', () => {
  it('uses only the category GET and accepts an optional or null icon', () => {
    expect(categoriesEndpoint).toMatchObject({ method: 'GET', path: '/v1/category' })
    expect(categoriesKey(7)).toEqual(['categories', 'read', 7])
    expect(categoriesResponseSchema.parse({ categories: [{ ...item, childCategory: [{ ...item, categoryKey: 2, icon: undefined }] }] }).categories[0].icon).toBeNull()
  })

  it.each([
    ['non-safe id', { categories: [{ ...item, categoryKey: Number.MAX_SAFE_INTEGER + 1, childCategory: [] }] }],
    ['missing children', { categories: [item] }],
  ])('rejects %s', (_label, value) => expect(() => categoriesResponseSchema.parse(value)).toThrow())

  it('strips fields the API adds instead of rejecting the list', () => {
    const parsed = categoriesResponseSchema.parse({ categories: [{ ...item, owner: 2, childCategory: [{ ...item, categoryKey: 2, owner: 2 }] }], extra: true })
    expect(parsed).toEqual({ categories: [{ ...item, childCategory: [{ ...item, categoryKey: 2 }] }] })
  })
})

describe('category write contracts', () => {
  it('defines the POST and PATCH endpoints and validates the category they return', () => {
    expect(createCategoryEndpoint).toMatchObject({ method: 'POST', path: '/v1/category', successStatuses: [201] })
    expect(createCategoryEditEndpoint(9)).toMatchObject({ method: 'PATCH', path: '/v1/category/9', successStatuses: [200] })
    const response = { category: { categoryKey: 9, name: 'Travel', icon: 'plane', bgColor: '#123ABC' } }
    expect(createCategoryEndpoint.schema.parse(response)).toEqual(response)
    expect(createCategoryEndpoint.schema.parse({ ...response, extra: true })).toEqual(response)
    expect(createCategoryEndpoint.schema.parse({ category: { ...response.category, extra: true } })).toEqual(response)
    // An icon this build can't draw reads as null rather than failing a write that already succeeded.
    expect(createCategoryEndpoint.schema.parse({ category: { ...response.category, icon: 'server-icon' } }).category.icon).toBeNull()
    expect(() => createCategoryEndpoint.schema.parse({ category: { ...response.category, bgColor: '#123abc' } })).toThrow()
  })

  it('trims visible names, requires uppercase colors and allowlisted icons, and never permits PATCH reparenting', () => {
    expect(categoryCreateWriteSchema.parse({ name: '  Travel  ', color: '#12ABEF', icon: 'plane', parentCategoryKey: '7' })).toEqual({ name: 'Travel', color: '#12ABEF', icon: 'plane', parentCategoryKey: '7' })
    expect(categoryEditWriteSchema.parse({ name: ' New ', color: '#112233', icon: 'folder' })).toEqual({ name: 'New', color: '#112233', icon: 'folder' })
    for (const invalid of [
      { name: ' ', color: '#12ABEF', icon: 'plane' },
      { name: 'x'.repeat(256), color: '#12ABEF', icon: 'plane' },
      { name: 'Travel', color: '#12abef', icon: 'plane' },
      { name: 'Travel', color: '#12ABEF', icon: '🔥' },
      { name: 'Travel', color: '#12ABEF', icon: 'plane', parentCategoryKey: '0' },
      { name: 'Travel', color: '#12ABEF', icon: 'plane', parentCategoryKey: String(Number.MAX_SAFE_INTEGER + 1) },
    ]) expect(() => categoryCreateWriteSchema.parse(invalid)).toThrow()
    expect(() => categoryEditWriteSchema.parse({ name: 'Travel', parentCategoryKey: '7' })).toThrow()
    expect(() => categoryEditWriteSchema.parse({})).toThrow()
  })

  it('accepts only positive safe route ids', () => {
    expect(parseCategoryId('42')).toBe(42)
    for (const value of [undefined, ['2'], '0', '01', '-1', '1.2', String(Number.MAX_SAFE_INTEGER + 1)]) expect(parseCategoryId(value)).toBeNull()
    expect(() => createCategoryEditEndpoint(0)).toThrow()
  })
})
