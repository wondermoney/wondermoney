import { initMobileI18n } from '@/lib/i18n'

import { resolveCategorySymbol } from './category-icon'
import { displayCategoryName, mapCategories, parseSafeCategoryColor, resolveCategoryGlyph } from './categories-view-model'

describe('category presentation policy', () => {
  it('orders system categories first with a stable id tie-break and keeps custom names verbatim', async () => {
    const i18n = await initMobileI18n('pt-PT')
    const categories = mapCategories({ categories: [
      { categoryKey: 4, name: '  My CUSTOM name  ', textColor: '#111827', bgColor: '#112233', icon: null, isSystemCategory: false, childCategory: [] },
      { categoryKey: 3, name: 'HOUSING', textColor: '#111827', bgColor: '#fed7aa', icon: 'house', isSystemCategory: true, childCategory: [] },
      { categoryKey: 2, name: 'HOUSING', textColor: '#111827', bgColor: '#fed7aa', icon: 'house', isSystemCategory: true, childCategory: [] },
    ] }, i18n.t, i18n.language)
    expect(categories.map(({ id, name }) => [id, name])).toEqual([[2, 'Habitação'], [3, 'Habitação'], [4, '  My CUSTOM name  ']])
    expect(displayCategoryName({ name: 'Personal Name', isSystemCategory: false }, i18n.t)).toBe('Personal Name')
    expect(displayCategoryName({ name: 'GROCERIES', isSystemCategory: true }, i18n.t)).toBe('Mercearia')
  })

  it('accepts only opaque six-digit hex colors and allowlisted glyphs', () => {
    expect(parseSafeCategoryColor('#a0B1c2')).toBe('#A0B1C2')
    for (const unsafe of ['red', '#fff', '#11223344', ' #112233', 'url(x)']) expect(parseSafeCategoryColor(unsafe)).toBeNull()
    expect(resolveCategoryGlyph('house')).toBe('⌂')
    expect(resolveCategoryGlyph('untrusted-symbol')).toBe('□')
    expect(resolveCategoryGlyph(null)).toBe('□')
  })

  it('resolves a distinct platform symbol per icon name and falls back to folder for unknown names', () => {
    expect(resolveCategorySymbol('coffee')).toEqual({ ios: 'cup.and.saucer.fill', android: 'local_cafe' })
    expect(resolveCategorySymbol('car')).toEqual({ ios: 'car.fill', android: 'directions_car' })
    expect(resolveCategorySymbol('coffee')).not.toEqual(resolveCategorySymbol('car'))
    expect(resolveCategorySymbol('bus')).not.toEqual(resolveCategorySymbol('shield'))
    expect(resolveCategorySymbol('untrusted-symbol')).toEqual({ ios: 'folder.fill', android: 'folder' })
    expect(resolveCategorySymbol(null)).toEqual({ ios: 'folder.fill', android: 'folder' })
  })
})
