export const manualAssetsKey = (epochId: number) => ['manual-assets', 'list', epochId] as const
export const manualAssetKey = (epochId: number, assetId: number) => ['manual-assets', 'detail', epochId, assetId] as const
