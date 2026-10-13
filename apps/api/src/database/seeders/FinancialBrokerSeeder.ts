// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialBroker } from '@entity/FinancialBroker';
import { Seeder } from '@mikro-orm/seeder';

export class FinancialBrokerSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const financialBrokerEntities: FinancialBroker[] = [];
    financialBrokerEntities.push(em.create(FinancialBroker, { displayName: 'Degiro', name: 'degiro' }));
    financialBrokerEntities.push(em.create(FinancialBroker, { displayName: 'Interactive Broker', name: 'ikbr' }));
    financialBrokerEntities.push(em.create(FinancialBroker, { displayName: 'Trading212', name: 'trading212' }));
    financialBrokerEntities.push(em.create(FinancialBroker, { displayName: 'Coinbase', name: 'coinbase' }));
    ctx.financialBrokers = financialBrokerEntities;
  }
}
