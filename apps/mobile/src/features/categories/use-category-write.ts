import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError, isPostDispatchCancellation } from '@/lib/api/errors'

import {
  categoryCreateWriteSchema,
  categoryEditWriteSchema,
  createCategoryEditEndpoint,
  createCategoryEndpoint,
  type CategoriesResponse,
  type CategoryCreateWrite,
  type CategoryEditWrite,
} from './categories-contract'
import { findVisibleCategory, isVisibleRoot } from './category-management-model'
import { categoriesKey } from './use-categories'

export type CategoryWriteInput =
  | Readonly<{ type: 'create'; payload: CategoryCreateWrite }>
  | Readonly<{ type: 'edit'; categoryId: number; payload: CategoryEditWrite }>
export type CategoryWriteGate = Readonly<CategoryWriteInput>
export type CategoryWriteFailure = 'validation' | 'demo' | 'access' | 'mfa' | 'not-found' | 'request' | 'cancelled' | 'unknown' | 'general'

export const categoryWriteUnknownKey = (epochId: number) => ['category-write-unknown', epochId] as const
export const categoryWriteDemoKey = (epochId: number) => ['category-write-demo-locked', epochId] as const

export class CategoryWriteBlockedError extends Error {
  constructor(message = 'Category writes are blocked after an unknown outcome for this session.') {
    super(message)
    this.name = 'CategoryWriteBlockedError'
  }
}

export function classifyCategoryWriteFailure(error: unknown): CategoryWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'validation' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && (error.status === 401 || error.status === 403))) return 'access'
  if (isPostDispatchCancellation(error)) return 'unknown'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network' || error.code === 'invalid-response' || (error.code === 'http' && (error.status ?? 0) >= 500)) return 'unknown'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500) return 'request'
  return 'general'
}

export function useCategoryWriteGate(): CategoryWriteGate | null {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCategoryWriteGate requires an authenticated runtime')
  const queryClient = useQueryClient()
  useEffect(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === 'category-write-unknown' && query.queryKey[1] !== runtime.epochId })
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === 'category-write-demo-locked' && query.queryKey[1] !== runtime.epochId })
  }, [queryClient, runtime.epochId])
  const query = useQuery<CategoryWriteGate | null>({ queryKey: categoryWriteUnknownKey(runtime.epochId), queryFn: () => Promise.resolve(null), enabled: false, gcTime: Infinity })
  return query.data ?? null
}

export function useCategoryWriteDemoLocked(): boolean {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCategoryWriteDemoLocked requires an authenticated runtime')
  const query = useQuery<boolean>({ queryKey: categoryWriteDemoKey(runtime.epochId), queryFn: () => Promise.resolve(false), enabled: false, gcTime: Infinity })
  return query.data === true
}

export function useCategoryWrite() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCategoryWrite requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const unknownGate = useCategoryWriteGate()
  const demoLocked = useCategoryWriteDemoLocked()
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: CategoryWriteInput) => {
      if (inFlight.current) throw new CategoryWriteBlockedError('A category write is already pending.')
      if (queryClient.getQueryData(categoryWriteUnknownKey(runtime.epochId))) throw new CategoryWriteBlockedError()
      if (queryClient.getQueryData(categoryWriteDemoKey(runtime.epochId))) throw new CategoryWriteBlockedError('Category writes are unavailable for this demo session.')
      const categories = queryClient.getQueryData<CategoriesResponse>(categoriesKey(runtime.epochId))
      if (!categories) throw new CategoryWriteBlockedError('Authoritative categories are required before writing.')
      const parsed = input.type === 'create'
        ? Object.freeze(categoryCreateWriteSchema.parse(input.payload))
        : Object.freeze(categoryEditWriteSchema.parse(input.payload))
      if (input.type === 'create' && parsed && 'parentCategoryKey' in parsed && parsed.parentCategoryKey !== undefined && !isVisibleRoot(categories, Number(parsed.parentCategoryKey))) {
        throw new CategoryWriteBlockedError('The selected parent is no longer a visible root category.')
      }
      if (input.type === 'edit') {
        const current = findVisibleCategory(categories, input.categoryId)
        if (!current || current.isSystemCategory) throw new CategoryWriteBlockedError('Only visible user categories can be edited.')
      }
      const frozen = Object.freeze(input.type === 'create'
        ? { type: 'create' as const, payload: parsed as CategoryCreateWrite }
        : { type: 'edit' as const, categoryId: input.categoryId, payload: parsed as CategoryEditWrite })
      inFlight.current = true
      try {
        try {
          return await runtime.apiClient.write(
            frozen.type === 'create' ? createCategoryEndpoint : createCategoryEditEndpoint(frozen.categoryId),
            { body: frozen.payload, commit: () => { void queryClient.invalidateQueries({ queryKey: categoriesKey(runtime.epochId), exact: true }) } },
          )
        } catch (error) {
          const failure = classifyCategoryWriteFailure(error)
          if (failure === 'unknown') queryClient.setQueryData(categoryWriteUnknownKey(runtime.epochId), frozen)
          if (failure === 'demo') queryClient.setQueryData(categoryWriteDemoKey(runtime.epochId), true)
          throw error
        }
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
  return { ...mutation, unknownGate, demoLocked }
}
