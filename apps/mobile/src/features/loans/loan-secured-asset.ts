import type { ManualAssetDto } from '@/features/manual-assets/manual-assets-contract'

import type { LoanSecuredAssetDto } from './loans-contract'

/** An asset the loan form offers under "Secured against". */
export type SecuredAssetOption = Readonly<{ key: number; name: string }>

/** The picker's "None" choice. Asset keys are positive, so 0 never collides with one. */
export const NO_SECURED_ASSET = 0

/**
 * What "Secured against" offers: the household's assets that still count today, by name, plus
 * the one the loan is linked to now, even when it is archived or the asset list didn't load, so
 * the current choice always has a label.
 */
export function securedAssetOptions(
  assets: readonly Pick<ManualAssetDto, 'manualAssetKey' | 'name' | 'archived'>[] | undefined,
  linked: Pick<LoanSecuredAssetDto, 'key' | 'name'> | null | undefined,
): SecuredAssetOption[] {
  const options: SecuredAssetOption[] = (assets ?? [])
    .filter((asset) => !asset.archived || asset.manualAssetKey === linked?.key)
    .map((asset) => ({ key: asset.manualAssetKey, name: asset.name }))
  if (linked && !options.some((option) => option.key === linked.key)) options.push({ key: linked.key, name: linked.name })
  return options.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
