import type { CategoryViewModel } from '@/features/categories/categories-view-model'

export const availableLeafCategories = (
  tree: readonly CategoryViewModel[],
  represented: ReadonlySet<number>,
): { id: number; name: string }[] => tree
  .flatMap((parent) => parent.children.length === 0
    ? [parent]
    : parent.children.filter((child) => child.children.length === 0))
  .filter((category) => !represented.has(category.id))
  .map(({ id, name }) => ({ id, name }))
