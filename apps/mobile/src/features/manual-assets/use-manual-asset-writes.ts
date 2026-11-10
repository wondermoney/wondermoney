import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createManualAssetValuationEndpoint,
  manualAssetCreateEndpoint,
  manualAssetCreateWriteSchema,
  manualAssetValuationWriteSchema,
  type ManualAssetCreateWrite,
  type ManualAssetValuationWrite,
} from './manual-assets-contract'
import { manualAssetKey, manualAssetsKey } from './query-keys'

export type ManualAssetWriteFailure = 'demo' | 'access' | 'mfa' | 'not-found' | 'invalid' | 'invalid-response' | 'network-ambiguous' | 'general'

export function classifyManualAssetWriteFailure(error: unknown): ManualAssetWriteFailure {
  if (!(error instanceof ApiError)) return error instanceof Error && error.name === 'ZodError' ? 'invalid' : 'general'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'auth-session' || (error.code === 'http' && error.status === 403)) return 'access'
  if (error.code === 'network') return 'network-ambiguous'
  if (error.code === 'invalid-response') return 'invalid-response'
  if (error.code === 'http' && error.status === 404) return 'not-found'
  if (error.code === 'http' && error.status === 400) return 'invalid'
  return 'general'
}

/**
 * An asset's value is part of net worth, today and in its history, so a write refreshes the
 * assets and the whole ['net-worth', epoch] family (summary and history) with them.
 */
function refreshAfterWrite(queryClient: QueryClient, epochId: number, assetId?: number) {
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: manualAssetsKey(epochId), exact: true }),
    ...(assetId === undefined ? [] : [queryClient.invalidateQueries({ queryKey: manualAssetKey(epochId, assetId), exact: true })]),
    queryClient.invalidateQueries({ queryKey: ['net-worth', epochId] }),
  ])
}

export function useCreateManualAsset() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreateManualAsset requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (value: ManualAssetCreateWrite) => {
      const body = manualAssetCreateWriteSchema.parse(value)
      return runtime.apiClient.write(manualAssetCreateEndpoint, { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId) })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/** "Update value": records a valuation. It never creates a transaction. */
export function useRecordValuation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useRecordValuation requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, value }: { assetId: number; value: ManualAssetValuationWrite }) => {
      const body = manualAssetValuationWriteSchema.parse(value)
      return runtime.apiClient.write(createManualAssetValuationEndpoint(assetId), { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
