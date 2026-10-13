import type { TFunction } from 'i18next'

import type { CategoriesResponse, CategoryDto } from './categories-contract'

export type CategoryViewModel = Readonly<{
  id: number
  name: string
  system: boolean
  color: string | null
  glyph: string
  icon?: string | null
  children: readonly CategoryViewModel[]
}>

const SAFE_HEX = /^#[0-9a-fA-F]{6}$/
export const parseSafeCategoryColor = (value: string | null): string | null => value && SAFE_HEX.test(value) ? value.toUpperCase() : null

const glyphs: Readonly<Record<string, string>> = {
  house: '⌂', home: '⌂', banknote: '$', zap: 'ϟ', 'cooking-pot': '◇', navigation: '➤',
  'tree-palm': '♧', users: '◎', 'heart-pulse': '+', shield: '◇', 'shield-question': '?', question: '?',
  car: '◇', bus: '◇', fuel: '◇', coffee: '◇', folder: '□', briefcase: '□', building: '□',
  'credit-card': '▭', plane: '△', gift: '◇', music: '♪', wrench: '◇', water: '◇',
}

export const resolveCategoryGlyph = (icon: string | null | undefined): string => {
  if (!icon) return '□'
  const normalized = icon.trim().replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return glyphs[normalized] ?? '□'
}

const systemKey = (name: string) => name.trim().toLowerCase().replace(/[_\s&]+/g, '-').replace(/[^a-z0-9-]/g, '')
export const displayCategoryName = (category: Pick<CategoryDto, 'name' | 'isSystemCategory'>, t: TFunction): string => {
  if (!category.isSystemCategory) return category.name
  const key = systemKey(category.name)
  return t(`categories.system.${key}`, { defaultValue: category.name })
}

const stableSort = (items: readonly CategoryViewModel[], locale: string) => {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return [...items].sort((a, b) => Number(b.system) - Number(a.system) || collator.compare(a.name, b.name) || a.id - b.id)
}

export const mapCategories = (response: CategoriesResponse, t: TFunction, locale: string): CategoryViewModel[] => {
  const map = (category: CategoryDto & { childCategory?: readonly CategoryDto[] }): CategoryViewModel => ({
    id: category.categoryKey,
    name: displayCategoryName(category, t),
    system: category.isSystemCategory,
    color: parseSafeCategoryColor(category.bgColor),
    glyph: resolveCategoryGlyph(category.icon),
    icon: category.icon ?? null,
    children: stableSort((category.childCategory ?? []).map((child) => map(child)), locale),
  })
  return stableSort(response.categories.map(map), locale)
}
