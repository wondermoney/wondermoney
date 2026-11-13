import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createManualAssetDeleteEndpoint,
  createManualAssetUpdateEndpoint,
  createManualAssetValuationEndpoint,
  manualAssetCreateEndpoint,
  manualAssetCreateWriteSchema,
  manualAssetUpdateWriteSchema,
  manualAssetValuationWriteSchema,
  type ManualAssetCreateWrite,
  type ManualAssetUpdateWrite,
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
export function refreshAfterWrite(queryClient: QueryClient, epochId: number, assetId?: number) {
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

/**
 * Every loan query (list, overview, details) of one epoch. A loan shows the asset it is secured
 * against, by name and value, so renaming, archiving or deleting the asset changes the loans too;
 * a delete also clears their link to it.
 */
export const isLoanQueryOfEpoch = (epochId: number) => (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'loans' && query.queryKey[2] === epochId

/**
 * Edit asset, and Archive or Bring back (`{ archived }`). The asset, the list, net worth and the
 * loans secured against it refresh once the write commits.
 */
export function useUpdateManualAsset() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useUpdateManualAsset requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, value }: { assetId: number; value: ManualAssetUpdateWrite }) => {
      const body = manualAssetUpdateWriteSchema.parse(value)
      return runtime.apiClient.write(createManualAssetUpdateEndpoint(assetId), {
        body,
        commit: () => {
          refreshAfterWrite(queryClient, runtime.epochId, assetId)
          void queryClient.invalidateQueries({ predicate: isLoanQueryOfEpoch(runtime.epochId) })
        },
      })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}

/**
 * Delete asset: it goes with its valuations, and any loan secured against it loses the link (the
 * loan itself stays). The list, net worth and the loans refresh; the asset's own page is not
 * refetched, since it would only answer 404 now (as for a wallet, and on the web).
 */
export function useDeleteManualAsset() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteManualAsset requires an authenticated runtime')
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId }: { assetId: number }) => runtime.apiClient.write(createManualAssetDeleteEndpoint(assetId), {
      commit: () => {
        refreshAfterWrite(queryClient, runtime.epochId)
        void queryClient.invalidateQueries({ predicate: isLoanQueryOfEpoch(runtime.epochId) })
      },
    }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
