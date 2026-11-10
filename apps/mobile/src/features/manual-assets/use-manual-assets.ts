import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useGuardedQuery } from '@/lib/api/use-guarded-query'

import { createManualAssetEndpoint, isValidManualAssetId, manualAssetsEndpoint } from './manual-assets-contract'
import { manualAssetKey, manualAssetsKey } from './query-keys'

export function useManualAssets() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useManualAssets requires an authenticated runtime')
  return useGuardedQuery(useQuery({
    queryKey: manualAssetsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(manualAssetsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  }))
}

export function useManualAsset(assetId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useManualAsset requires an authenticated runtime')
  const valid = assetId !== null && isValidManualAssetId(assetId)
  return { ...useGuardedQuery(useQuery({
    queryKey: manualAssetKey(runtime.epochId, assetId ?? 0),
    queryFn: () => runtime.apiClient.read(createManualAssetEndpoint(assetId!)),
    enabled: valid,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })), isInvalidId: !valid }
}
