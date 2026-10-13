import type { CategoryViewModel } from '@/features/categories/categories-view-model'

import { availableLeafCategories } from './budget-category-options'

const item = (id: number, name: string, children: CategoryViewModel[] = []): CategoryViewModel => ({ id, name, children, system: true, color: null, glyph: '□' })

describe('available budget category options', () => {
  it('offers only leaves and excludes categories represented in the current month', () => {
    const result = availableLeafCategories([item(1, 'Home', [item(2, 'Rent'), item(3, 'Power')]), item(4, 'Other')], new Set([2]))
    expect(result).toEqual([{ id: 3, name: 'Power' }, { id: 4, name: 'Other' }])
    expect(result).not.toContainEqual(expect.objectContaining({ id: 1 }))
  })
})
