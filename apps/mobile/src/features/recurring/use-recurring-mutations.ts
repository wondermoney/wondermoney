import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  createConfirmRecurringEndpoint,
  createDismissRecurringEndpoint,
  createUpdateRecurringEndpoint,
  recurringDetectionEndpoint,
  recurringMetadataSchema,
  recurringRestoreSchema,
  type RecurringItemDto,
  type RecurringMetadataInput,
} from './recurring-contract'
import { recurringItemsKey, recurringSummaryKey } from './query-keys'

export type RecurringMutation =
  | { kind: 'detect' }
  | { kind: 'confirm'; id: number }
  | { kind: 'dismiss'; id: number }
  | { kind: 'restore'; id: number }
  | { kind: 'update'; id: number; metadata: RecurringMetadataInput }

export function useRecurringMutations() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useRecurringMutations requires an authenticated runtime')
  const queryClient = useQueryClient()
  const writePending = useRef(false)
  const refreshCommittedRecurring = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: recurringItemsKey(runtime.epochId) }),
      queryClient.invalidateQueries({ queryKey: recurringSummaryKey(runtime.epochId) }),
    ])
  }

  return useMutation({
    retry: false,
    mutationFn: async (mutation: RecurringMutation) => {
      if (writePending.current) throw new Error('A recurring change is already pending.')
      writePending.current = true
      try {
        if (mutation.kind === 'detect') {
          let refresh: Promise<unknown> | undefined
          const response = await runtime.apiClient.write(recurringDetectionEndpoint, {
            commit: () => { refresh = Promise.all([
              queryClient.invalidateQueries({ queryKey: recurringItemsKey(runtime.epochId) }),
              queryClient.invalidateQueries({ queryKey: recurringSummaryKey(runtime.epochId) }),
            ]) },
          })
          await refresh
          return response
        }
        if (mutation.kind === 'confirm') {
          return await runtime.apiClient.write(createConfirmRecurringEndpoint(mutation.id), { commit: refreshCommittedRecurring })
        }
        if (mutation.kind === 'dismiss') {
          return await runtime.apiClient.write(createDismissRecurringEndpoint(mutation.id), { commit: refreshCommittedRecurring })
        }
        const applyReturnedSeries = (id: number, response: { recurringSeries: RecurringItemDto }) => {
          queryClient.setQueryData<{ items: RecurringItemDto[] }>(recurringItemsKey(runtime.epochId), (current) => current
            ? { items: current.items.map((item) => item.recurringSeriesKey === id ? response.recurringSeries : item) }
            : current)
          refreshCommittedRecurring()
        }
        if (mutation.kind === 'restore') {
          const body = recurringRestoreSchema.parse({ status: 'candidate' })
          return await runtime.apiClient.write(createUpdateRecurringEndpoint(mutation.id), {
            body,
            commit: (response) => applyReturnedSeries(mutation.id, response),
          })
        }
        const update = mutation
        const body = recurringMetadataSchema.parse(update.metadata)
        return await runtime.apiClient.write(createUpdateRecurringEndpoint(mutation.id), {
          body,
          commit: (response) => applyReturnedSeries(update.id, response),
        })
      } finally {
        writePending.current = false
      }
    },
  })
}
