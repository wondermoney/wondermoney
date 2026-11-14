import type { EntityManager } from '@mikro-orm/postgresql';

import type { Loan } from '@entity/Loan';
import type { ManualAsset } from '@entity/ManualAsset';
import { valueOn } from '@service/manual-asset/manual-asset-valuation';
import { currentValueDate, loadVisibleManualAssets, toValuedAsset } from '@service/manual-asset/manual-asset.service';
import { NotFoundError } from '@utils/errors';

/**
 * The asset a loan is secured against (`Loan.securedAssetKey`), seen from the loan.
 *
 * A loan may name only an asset its owner can see: one of their household's shared assets or
 * their own private one. Anything else, another household's asset included, is not found (404),
 * so a key from outside the household reveals nothing. An asset that stops being visible to the
 * loan's owner later (the other member made it private) is left out of the loan, never shown.
 */

export interface LoanViewer {
  appuserKey: number;
  tenantKey: number;
}

export interface SecuredAssetDto {
  /** The asset's currency. */
  currency: string;
  /** The asset's `manualAssetKey`. */
  key: number;
  name: string;
  /** Today's value in `currency`; null when the asset has none (archived). */
  value: null | number;
}

/** The asset a loan may be secured against, or a 404 when the viewer cannot see it. */
export async function findSecurableAsset(em: EntityManager, viewer: LoanViewer, manualAssetKey: number): Promise<ManualAsset> {
  const [loaded] = await loadVisibleManualAssets(em, viewer, { manualAssetKey });
  if (!loaded) throw new NotFoundError('Asset not found');
  return loaded.asset;
}

/** The visible assets these loans are secured against, keyed by asset key, each with today's value. */
export async function securedAssetsOf(em: EntityManager, viewer: LoanViewer, loans: readonly Loan[], now: Date): Promise<Map<number, SecuredAssetDto>> {
  const keys = [...new Set(loans.flatMap((loan) => (loan.securedAssetKey ? [loan.securedAssetKey.manualAssetKey] : [])))];
  const result = new Map<number, SecuredAssetDto>();
  if (keys.length === 0) return result;
  for (const loaded of await loadVisibleManualAssets(em, viewer, { manualAssetKey: { $in: keys } })) {
    const { asset } = loaded;
    result.set(asset.manualAssetKey, {
      currency: asset.currencyKey.code,
      key: asset.manualAssetKey,
      name: asset.name,
      value: valueOn(toValuedAsset(loaded), currentValueDate(loaded, now)),
    });
  }
  return result;
}
