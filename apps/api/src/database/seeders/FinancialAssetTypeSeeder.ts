// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FINANCIAL_ASSET_TYPE_TO_ASSET_CLASS } from '@app/database/constants/asset-class-rollup';
import { AssetClass } from '@entity/AssetClass';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { Seeder } from '@mikro-orm/seeder';

const FINANCIAL_ASSET_TYPE_NAMES = [
  'Stock',
  'ETF',
  'Mutual Fund',
  'Crypto',
  'Bond',
  'Loan',
  'Derivative',
  'Cash',
  'Savings Certificate',
];

export class FinancialAssetTypeSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const assetClasses = ctx.assetClasses as AssetClass[];
    const assetClassByName = new Map(assetClasses.map((assetClass) => [assetClass.name, assetClass]));

    ctx.financialAssetTypes = FINANCIAL_ASSET_TYPE_NAMES.map((name) =>
      em.create(FinancialAssetType, {
        assetClassKey: assetClassByName.get(FINANCIAL_ASSET_TYPE_TO_ASSET_CLASS[name]),
        name,
      }),
    );
  }
}
