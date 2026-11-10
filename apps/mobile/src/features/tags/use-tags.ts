import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import type { CreateTagOutcome, TagsState } from './tag-picker-sheet'
import {
  createSetTransactionTagsEndpoint,
  createTagEndpoint,
  freezeTagIds,
  sameTagName,
  tagNameSchema,
  tagsEndpoint,
  type TagDto,
} from './tags-contract'

export const tagsKey = (epochId: number) => ['tags', 'read', epochId] as const

/**
 * The household's tags. A server too old to have tags answers 404, which reads
 * as an error here: the screens then hide the tag controls and show no chips.
 */
export function useTags() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTags requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: tagsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(tagsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}

/** How a tag write ended, for the screen's notice. */
export type TagWriteResult = 'success' | 'taken' | 'demo' | 'mfa' | 'network' | 'error'

export function classifyTagWriteFailure(error: unknown): Exclude<TagWriteResult, 'success'> {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'network') return 'network'
  if (error.code === 'http' && error.status === 409) return 'taken'
  return 'error'
}

export function useCreateTag() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateTag requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    mutationFn: async (name: string): Promise<TagDto> => {
      const body = Object.freeze({ name: tagNameSchema.parse(name) })
      const { tag } = await runtime.apiClient.write(createTagEndpoint, {
        body,
        commit: () => { void queryClient.invalidateQueries({ queryKey: tagsKey(runtime.epochId), exact: true }) },
      })
      return tag
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/** The tag list as the picker and filters read it. */
export function toTagsState(query: { data?: { tags: readonly TagDto[] }; isLoading: boolean }): TagsState {
  if (query.data) return { status: 'loaded', tags: query.data.tags }
  return query.isLoading ? { status: 'loading' } : { status: 'error' }
}

/**
 * Create a tag for the picker. A name another member took meanwhile (409)
 * resolves to their tag, so the person still gets the tag they asked for.
 */
export function useCreateTagForPicker() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCreateTagForPicker requires an authenticated runtime')
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useCreateTag()
  return async (name: string): Promise<CreateTagOutcome> => {
    try {
      return { tag: await mutation.mutateAsync(name) }
    } catch (error) {
      const failure = classifyTagWriteFailure(error)
      if (failure === 'taken') {
        try {
          const fresh = await queryClient.fetchQuery({ queryKey: tagsKey(runtime.epochId), queryFn: () => runtime.apiClient.read(tagsEndpoint), staleTime: 0 })
          const existing = fresh.tags.find((tag) => sameTagName(tag.name, name))
          if (existing) return { tag: existing }
        } catch {
          // Fall through to the notice.
        }
      }
      return { error: t(`tags.result.${failure}`) }
    }
  }
}

export function useSetTransactionTags() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useSetTransactionTags requires an authenticated runtime')
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  return useMutation({
    retry: false,
    mutationFn: async ({ transactionId, tagIds }: { transactionId: number; tagIds: readonly number[] }) => {
      if (inFlight.current) throw new Error('A tag change is already pending.')
      const frozen = freezeTagIds(tagIds)
      inFlight.current = true
      try {
        return await runtime.apiClient.write(createSetTransactionTagsEndpoint(transactionId), {
          body: { tagIds: frozen },
          commit: () => {
            // Every list that shows the row's tags, and the ones filtered by them.
            void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'transactions' && query.queryKey[1] === runtime.epochId })
          },
        })
      } finally {
        inFlight.current = false
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
