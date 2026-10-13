import { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { AssetClassSeeder } from './AssetClassSeeder';
import { AccountFinancialInstitutionSeeder } from './AccountFinancialInstitutionSeeder';
import { AccountSeeder } from './AccountSeeder';
import { AccountTypeSeeder } from './AccountTypeSeeder';
import { AppuserMerchantCategorySeeder } from './AppuserMerchantCategorySeeder';
import { AppuserSeeder } from './AppuserSeeder';
import { AppuserTenantSeeder } from './AppuserTenantSeeder';
import { AppuserTransactionCategorySeeder } from './AppuserTransactionCategorySeeder';
import { BudgetSeeder } from './BudgetSeeder';
import { BudgetTemplateCategorySeeder } from './BudgetTemplateCategorySeeder';
import { BudgetTemplateIncomeSeeder } from './BudgetTemplateIncomeSeeder';
import { CategorySeeder } from './CategorySeeder';
import { CertificadoAforroReferenceSeeder } from './CertificadoAforroReferenceSeeder';
import { LoanSeeder } from './LoanSeeder';
import { CurrencySeeder } from './CurrencySeeder';
import { ExchangeRateSeeder } from './ExchangeRateSeeder';
import { FinancialAssetCompanySeeder } from './FinancialAssetCompanySeeder';
import { FinancialAssetExchangeAliasSeeder } from './FinancialAssetExchangeAliasSeeder';
import { FinancialAssetExchangeSeeder } from './FinancialAssetExchangeSeeder';
import { FinancialAssetIndustrySeeder } from './FinancialAssetIndustrySeeder';
import { FinancialAssetPriceSeeder } from './FinancialAssetPriceSeeder';
import { FinancialAssetSectorSeeder } from './FinancialAssetSectorSeeder';
import { FinancialAssetSeeder } from './FinancialAssetSeeder';
import { FinancialAssetTypeSeeder } from './FinancialAssetTypeSeeder';
import { FinancialBrokerSeeder } from './FinancialBrokerSeeder';
import { FinancialTransactionSeeder } from './FinancialTransactionSeeder';
import { FinancialTransactionTypeSeeder } from './FinancialTransactionTypeSeeder';
import { OnboardingSeeder } from './OnboardingSeeder';
import { PortfolioSeeder } from './PortfolioSeeder';
import { PortfolioSnapshotSeeder } from './PortfolioSnapshotSeeder';
import { SubCategorySeeder } from './SubcategorySeeder';
import { TenantSeeder } from './TenantSeeder';
import { TenantStatusSeeder } from './TenantStatusSeeder';
import { TransactionCategoryStatsSeeder } from './TransactionCategoryStats';
import { TransactionMerchantSeeder } from './TransactionMerchantSeeder';
import { TransactionSeeder } from './TransactionSeeder';
import { TransactionStatusSeeder } from './TransactionStatusSeeder';
import { TransactionTypeSeeder } from './TransactionTypeSeeder';

export class DatabaseSeeder extends Seeder {
  run(em: EntityManager): Promise<void> {
    return this.call(em, [
      CurrencySeeder,
      ExchangeRateSeeder,
      OnboardingSeeder,
      AppuserSeeder,
      TenantStatusSeeder,
      TenantSeeder,
      AppuserTenantSeeder,
      AccountFinancialInstitutionSeeder,
      AccountTypeSeeder,
      FinancialAssetCompanySeeder,
      FinancialAssetExchangeAliasSeeder,
      FinancialAssetExchangeSeeder,
      FinancialAssetIndustrySeeder,
      FinancialAssetSectorSeeder,
      AccountSeeder,
      FinancialBrokerSeeder,
      AssetClassSeeder,
      FinancialAssetTypeSeeder,
      FinancialAssetSeeder,
      // Must follow FinancialAssetSeeder: it joins to the CA-SERIE-* FinancialAsset rows.
      CertificadoAforroReferenceSeeder,
      FinancialAssetPriceSeeder,
      FinancialTransactionTypeSeeder,
      PortfolioSeeder,
      FinancialTransactionSeeder,
      PortfolioSnapshotSeeder,
      CategorySeeder,
      SubCategorySeeder,
      TransactionTypeSeeder,
      TransactionStatusSeeder,
      TransactionMerchantSeeder,
      TransactionSeeder,
      LoanSeeder,
      AppuserTransactionCategorySeeder,
      AppuserMerchantCategorySeeder,
      TransactionCategoryStatsSeeder,
      BudgetSeeder,
      BudgetTemplateIncomeSeeder,
      BudgetTemplateCategorySeeder,
    ]);
  }
}
