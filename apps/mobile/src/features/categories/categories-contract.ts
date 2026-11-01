import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

const id = z.number().int().positive().safe()
const nonBlankString = z.string().refine((value) => value.trim().length > 0)
const category = z.object({
  categoryKey: id,
  name: nonBlankString,
  textColor: z.string(),
  bgColor: z.string(),
  icon: z.string().nullable().optional(),
  isSystemCategory: z.boolean(),
})

export const categoriesResponseSchema = z.object({
  categories: z.array(category.extend({ childCategory: z.array(category) })),
})

export type CategoryDto = z.infer<typeof category>
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>

export const CATEGORY_ICONS = [
  'house', 'home', 'banknote', 'zap', 'cooking-pot', 'navigation', 'tree-palm',
  'users', 'heart-pulse', 'shield', 'shield-question', 'question', 'car', 'bus',
  'fuel', 'coffee', 'folder', 'briefcase', 'building', 'credit-card', 'plane',
  'gift', 'music', 'wrench', 'water',
] as const

export const categoryIconSchema = z.enum(CATEGORY_ICONS)
const categoryColorSchema = z.string().regex(/^#[0-9A-F]{6}$/)
const categoryNameSchema = z.string().trim().min(1).max(255)
const categoryParentKeySchema = z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)))

export const categoryCreateWriteSchema = z.object({
  name: categoryNameSchema,
  color: categoryColorSchema,
  icon: categoryIconSchema,
  parentCategoryKey: categoryParentKeySchema.optional(),
}).strict()

export const categoryEditWriteSchema = z.object({
  name: categoryNameSchema.optional(),
  color: categoryColorSchema.optional(),
  icon: categoryIconSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one changed field is required.')

export type CategoryCreateWrite = z.infer<typeof categoryCreateWriteSchema>
export type CategoryEditWrite = z.infer<typeof categoryEditWriteSchema>

const categoryWriteResponseSchema = z.object({
  category: z.object({
    categoryKey: id,
    name: nonBlankString,
    // An icon this build can't draw reads as null; the form keeps showing the icon the user picked.
    icon: tolerantEnum(CATEGORY_ICONS, null).nullable(),
    bgColor: categoryColorSchema,
  }),
})

export const createCategoryEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/category',
  schema: categoryWriteResponseSchema,
  successStatuses: [201],
})

export const createCategoryEditEndpoint = (categoryId: number) => {
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('A positive safe category id is required.')
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/category/${categoryId}`,
    schema: categoryWriteResponseSchema,
    successStatuses: [200],
  })
}

export function parseCategoryId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export const categoriesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/category',
  schema: categoriesResponseSchema,
})
