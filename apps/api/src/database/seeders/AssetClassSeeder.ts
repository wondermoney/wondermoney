// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { ASSET_CLASSES } from '@app/database/constants/asset-class-rollup';
import { AssetClass } from '@entity/AssetClass';
import { Seeder } from '@mikro-orm/seeder';

export class AssetClassSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    ctx.assetClasses = ASSET_CLASSES.map((assetClass) => em.create(AssetClass, assetClass));
  }
}
