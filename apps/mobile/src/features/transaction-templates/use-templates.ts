import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import {
  createTransactionTemplateEndpoint,
  deleteTransactionTemplateEndpoint,
  freezeTemplateInput,
  transactionTemplatesEndpoint,
  type TransactionTemplateDto,
  type TransactionTemplateInput,
  updateTransactionTemplateEndpoint,
} from './templates-contract'

export const transactionTemplatesKey = (epochId: number) => ['transaction-templates', epochId] as const

/** The member's own templates. A server too old to have them answers 404 and the chips stay hidden. */
export function useTransactionTemplates() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionTemplates requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: transactionTemplatesKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(transactionTemplatesEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}

function useInvalidateTemplates() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useInvalidateTemplates requires an authenticated runtime')
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: transactionTemplatesKey(runtime.epochId), exact: true })
}

export function useCreateTransactionTemplate() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateTransactionTemplate requires an authenticated runtime')
  const invalidate = useInvalidateTemplates()
  return useMutation({
    retry: false,
    mutationFn: async (input: TransactionTemplateInput): Promise<TransactionTemplateDto> => {
      const { template } = await runtime.apiClient.write(createTransactionTemplateEndpoint, {
        body: freezeTemplateInput(input),
        commit: () => { void invalidate() },
      })
      return template
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

export function useUpdateTransactionTemplate() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useUpdateTransactionTemplate requires an authenticated runtime')
  const invalidate = useInvalidateTemplates()
  return useMutation({
    retry: false,
    mutationFn: async ({ transactionTemplateId, input }: { transactionTemplateId: number; input: TransactionTemplateInput }): Promise<TransactionTemplateDto> => {
      const { template } = await runtime.apiClient.write(updateTransactionTemplateEndpoint(transactionTemplateId), {
        body: freezeTemplateInput(input),
        commit: () => { void invalidate() },
      })
      return template
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

export function useDeleteTransactionTemplate() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteTransactionTemplate requires an authenticated runtime')
  const invalidate = useInvalidateTemplates()
  return useMutation({
    retry: false,
    mutationFn: (transactionTemplateId: number) => runtime.apiClient.write(deleteTransactionTemplateEndpoint(transactionTemplateId), {
      commit: () => { void invalidate() },
    }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
