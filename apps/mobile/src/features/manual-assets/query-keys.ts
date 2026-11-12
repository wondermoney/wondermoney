export const manualAssetsKey = (epochId: number) => ['manual-assets', 'list', epochId] as const
export const manualAssetKey = (epochId: number, assetId: number) => ['manual-assets', 'detail', epochId, assetId] as const

/**
 * Every manual-asset query (list and details) of one epoch, for `invalidateQueries({ predicate })`.
 * A loan write uses it: an asset's linked debt and equity follow the loans secured against it.
 */
export const isManualAssetQueryOfEpoch = (epochId: number) => (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'manual-assets' && query.queryKey[2] === epochId
