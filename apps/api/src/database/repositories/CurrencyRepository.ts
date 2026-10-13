import { Currency } from '@entity/Currency';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class CurrencyRepository extends ExtendedEntityRepository<Currency> {
  public getActive = () => {
    return this.find({ isActive: true });
  };
  public getByCode = (code: Currency['code']) => {
    return this.findOneOrFail({ code, isActive: true });
  };
  public getById = (currencyKey: Currency['currencyKey']) => {
    return this.findOneOrFail({ currencyKey, isActive: true });
  };
}
