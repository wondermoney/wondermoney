import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';

import { AccountFinancialInstitutionSeeder } from './AccountFinancialInstitutionSeeder';
import { AccountTypeSeeder } from './AccountTypeSeeder';
import { AssetClassSeeder } from './AssetClassSeeder';
import { CategorySeeder } from './CategorySeeder';
import { CertificadoAforroReferenceSeeder } from './CertificadoAforroReferenceSeeder';
import { CurrencySeeder } from './CurrencySeeder';
import { ExchangeRateSeeder } from './ExchangeRateSeeder';
import { FinancialAssetCompanySeeder } from './FinancialAssetCompanySeeder';
import { FinancialAssetExchangeAliasSeeder } from './FinancialAssetExchangeAliasSeeder';
import { FinancialAssetExchangeSeeder } from './FinancialAssetExchangeSeeder';
import { FinancialAssetIndustrySeeder } from './FinancialAssetIndustrySeeder';
import { FinancialAssetSectorSeeder } from './FinancialAssetSectorSeeder';
import { FinancialAssetSeeder } from './FinancialAssetSeeder';
import { FinancialAssetTypeSeeder } from './FinancialAssetTypeSeeder';
import { FinancialBrokerSeeder } from './FinancialBrokerSeeder';
import { FinancialTransactionTypeSeeder } from './FinancialTransactionTypeSeeder';
import { OnboardingSeeder } from './OnboardingSeeder';
import { SubCategorySeeder } from './SubcategorySeeder';
import { TenantStatusSeeder } from './TenantStatusSeeder';
import { TransactionStatusSeeder } from './TransactionStatusSeeder';
import { TransactionTypeSeeder } from './TransactionTypeSeeder';

/**
 * The lookup data every instance needs and no user owns: currencies and historical rates,
 * account and transaction types, system categories, the asset catalog and exchanges, and the
 * Certificados de Aforro tables. No users, accounts or demo data (that is `DatabaseSeeder`).
 *
 * Run once, on an empty database: by `migrate.ts` (see `shouldSeedReferenceData`), or by
 * `DatabaseSeeder` when `migrate.ts` was told to skip it. Order matters: later seeders read what
 * earlier ones put in the shared context, which is passed through so a caller sees it too.
 */
export class ReferenceDataSeeder extends Seeder {
  run(em: EntityManager, ctx: Dictionary = {}): Promise<void> {
    return this.call(em, [
      CurrencySeeder,
      ExchangeRateSeeder,
      OnboardingSeeder,
      TenantStatusSeeder,
      AccountFinancialInstitutionSeeder,
      AccountTypeSeeder,
      FinancialAssetCompanySeeder,
      FinancialAssetExchangeAliasSeeder,
      FinancialAssetExchangeSeeder,
      FinancialAssetIndustrySeeder,
      FinancialAssetSectorSeeder,
      FinancialBrokerSeeder,
      AssetClassSeeder,
      FinancialAssetTypeSeeder,
      FinancialAssetSeeder,
      // Must follow FinancialAssetSeeder: it joins to the CA-SERIE-* FinancialAsset rows.
      CertificadoAforroReferenceSeeder,
      FinancialTransactionTypeSeeder,
      CategorySeeder,
      SubCategorySeeder,
      TransactionTypeSeeder,
      TransactionStatusSeeder,
    ], ctx);
  }
}

/** Whether the reference data is already loaded. Currencies are the first thing it inserts. */
export async function hasReferenceData(em: EntityManager): Promise<boolean> {
  const [row] = await em.getConnection().execute<{ present: boolean }[]>('select exists(select 1 from currency) as present');
  return row?.present ?? true;
}

/**
 * Puts the reference data already in the database into the seeder context, under the keys
 * `ReferenceDataSeeder` would have set, for the demo seeders that read it. Only the keys a seeder
 * outside `ReferenceDataSeeder` reads are loaded.
 */
export async function loadReferenceDataContext(em: EntityManager, ctx: Dictionary): Promise<void> {
  const [currencies, accountFinancialInstitutions, financialAssets, financialBrokers, financialTransactionTypes, subCategories, transactionStatuses, transactionTypes] = await Promise.all([
    em.find(Currency, {}),
    em.find(AccountFinancialInstitution, { deletedAt: null }),
    em.find(FinancialAsset, {}),
    em.find(FinancialBroker, {}),
    em.find(FinancialTransactionType, {}),
    em.find(Category, { appuserKey: null, isSystemCategory: true, parentCategory: { $ne: null } }, { orderBy: { categoryKey: 'ASC' } }),
    em.find(TransactionStatus, {}),
    em.find(TransactionType, {}),
  ]);
  Object.assign(ctx, { accountFinancialInstitutions, currencies, financialAssets, financialBrokers, financialTransactionTypes, subCategories, transactionStatuses, transactionTypes });
}
