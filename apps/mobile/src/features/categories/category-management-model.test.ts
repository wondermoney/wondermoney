import { duplicateWarnings, findVisibleCategory, isVisibleRoot, reconcileCategoryWrite } from './category-management-model'
import type { CategoriesResponse } from './categories-contract'

const system = { categoryKey: 1, name: 'FOOD', textColor: '#111111', bgColor: '#AABBCC', icon: 'cooking-pot', isSystemCategory: true }
const user = { categoryKey: 2, name: 'Lunch', textColor: '#FFFFFF', bgColor: '#123456', icon: 'coffee', isSystemCategory: false }
const categories: CategoriesResponse = { categories: [{ ...system, childCategory: [user] }] }

describe('category management policy', () => {
  it('finds visible categories but exposes only roots for parent selection', () => {
    expect(findVisibleCategory(categories, 2)?.name).toBe('Lunch')
    expect(isVisibleRoot(categories, 1)).toBe(true)
    expect(isVisibleRoot(categories, 2)).toBe(false)
  })

  it('warns nonblockingly about normalized duplicate names and exact safe colors', () => {
    expect(duplicateWarnings(categories, { name: ' lunch ', color: '#AABBCC' })).toEqual({ name: true, color: true })
    expect(duplicateWarnings(categories, { name: 'Lunch', color: '#123456' }, 2)).toEqual({ name: false, color: false })
  })

  it('keeps POST ambiguity neutral and reconciles PATCH only by id and requested values', () => {
    expect(reconcileCategoryWrite(categories, { type: 'create', payload: { name: 'Lunch', color: '#123456', icon: 'coffee' } })).toBe('create-neutral')
    expect(reconcileCategoryWrite(categories, { type: 'edit', categoryId: 2, payload: { name: 'Lunch', color: '#123456', icon: 'coffee' } })).toBe('edit-applied')
    expect(reconcileCategoryWrite(categories, { type: 'edit', categoryId: 2, payload: { name: 'Dinner' } })).toBe('edit-not-applied')
    expect(reconcileCategoryWrite(categories, { type: 'edit', categoryId: 1, payload: { name: 'FOOD' } })).toBe('edit-not-found')
    expect(reconcileCategoryWrite(categories, { type: 'edit', categoryId: 99, payload: { name: 'Gone' } })).toBe('edit-not-found')
  })
})
