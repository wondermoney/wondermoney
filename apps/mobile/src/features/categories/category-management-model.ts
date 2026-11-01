import type { CategoriesResponse, CategoryCreateWrite, CategoryDto, CategoryEditWrite } from './categories-contract'

export type VisibleCategory = Readonly<CategoryDto & { root: boolean }>

function flattenCategories(response: CategoriesResponse): VisibleCategory[] {
  return response.categories.flatMap((root) => [
    { ...root, root: true },
    ...root.childCategory.map((child) => ({ ...child, root: false })),
  ])
}

export function findVisibleCategory(response: CategoriesResponse, categoryId: number): VisibleCategory | null {
  return flattenCategories(response).find(({ categoryKey }) => categoryKey === categoryId) ?? null
}

export function isVisibleRoot(response: CategoriesResponse, categoryId: number): boolean {
  return response.categories.some(({ categoryKey }) => categoryKey === categoryId)
}

export function duplicateWarnings(
  response: CategoriesResponse,
  value: Pick<CategoryCreateWrite, 'name' | 'color'>,
  excludeId?: number,
): Readonly<{ name: boolean; color: boolean }> {
  const candidates = flattenCategories(response).filter(({ categoryKey }) => categoryKey !== excludeId)
  const normalizedName = value.name.trim().toLocaleLowerCase()
  return {
    name: candidates.some((category) => category.name.trim().toLocaleLowerCase() === normalizedName),
    color: candidates.some((category) => category.bgColor.toUpperCase() === value.color),
  }
}

export type CategoryReconciliation = 'create-neutral' | 'edit-applied' | 'edit-not-applied' | 'edit-not-found'

export function reconcileCategoryWrite(
  response: CategoriesResponse,
  gate: Readonly<{ type: 'create'; payload: CategoryCreateWrite } | { type: 'edit'; categoryId: number; payload: CategoryEditWrite }>,
): CategoryReconciliation {
  // Names and colors are not unique, so a matching POST result cannot prove that the request committed.
  if (gate.type === 'create') return 'create-neutral'
  const current = findVisibleCategory(response, gate.categoryId)
  if (!current || current.isSystemCategory) return 'edit-not-found'
  const matches = (gate.payload.name === undefined || current.name === gate.payload.name)
    && (gate.payload.color === undefined || current.bgColor.toUpperCase() === gate.payload.color)
    && (gate.payload.icon === undefined || current.icon === gate.payload.icon)
  return matches ? 'edit-applied' : 'edit-not-applied'
}
