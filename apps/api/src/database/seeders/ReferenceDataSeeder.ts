import type { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

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
 * Run once, on an empty database, by `migrate.ts` (see `seedReferenceDataIfEmpty`). Order
 * matters: later seeders read what earlier ones put in the shared context.
 */
export class ReferenceDataSeeder extends Seeder {
  run(em: EntityManager): Promise<void> {
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
    ]);
  }
}
