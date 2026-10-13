// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { EntityManager } from '@mikro-orm/core';

import { FinancialAssetSector } from '@entity/FinancialAssetSector';
import { Seeder } from '@mikro-orm/seeder';

const financialAssetSectors = [
  'Industrials',
  'Technology',
  'Consumer Cyclical',
  'Healthcare',
  'Basic Materials',
  'Real Estate',
  'Consumer Defensive',
  'Communication Services',
  'Energy',
  'Utilities',
  'Metals & Mining',
  'Retail',
  'Construction',
  'Media',
  'Textiles, Apparel & Luxury Goods',
  'Hotels, Restaurants & Leisure',
  'Machinery',
  'Food Products',
  'Financial',
  'Chemicals',
  'Semiconductors',
  'Commercial Services & Supplies',
  'Pharmaceuticals',
  'Electrical Equipment',
  'Trading Companies & Distributors',
  'Banking',
  'Biotechnology',
  'Services',
  'Consumer Goods',
  'Industrial Goods',
  'Building',
  'Insurance',
  'Paper & Forest',
  'Auto Components',
  'Telecommunication',
  'Diversified Consumer Services',
  'Logistics & Transportation',
  'Automobiles',
  'Transportation Infrastructure',
  'Airlines',
  'Aerospace & Defense',
  'Beverages',
  'Consumer products',
  'Professional Services',
  'Leisure Products',
  'Road & Rail',
  'Distributors',
  'Packaging',
  'Marine',
  'Conglomerates',
  'Life Sciences Tools & Services',
];

export class FinancialAssetSectorSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    financialAssetSectors.map((sector) =>
      em.create(FinancialAssetSector, {
        name: sector,
      }),
    );
  }
}
