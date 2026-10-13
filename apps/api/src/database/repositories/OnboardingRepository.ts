import { Onboarding } from '@entity/Onboarding';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class OnboardingRepository extends ExtendedEntityRepository<Onboarding> {
  public getActive = () => {
    return this.find({ active: true });
  };
  public getBankSyncStep = () => {
    return this.findOneOrFail({ active: true, description: 'Link a bank account' });
  };
  public getCreatePortfolioStep = () => {
    return this.findOneOrFail({ active: true, description: 'Create a portfolio' });
  };
  public getEnable2FAStep = () => {
    return this.findOneOrFail({ active: true, description: 'Enable 2 factor authentication' });
  };
  public getImportPortfolioTransactionsStep = () => {
    return this.findOneOrFail({ active: true, description: 'Import portfolio transactions' });
  };
  public getReviewTransactionStep = () => {
    return this.findOneOrFail({ active: true, description: 'Review a transaction' });
  };
}
