// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Portfolio } from '@entity/Portfolio';
import { Seeder } from '@mikro-orm/seeder';

import { demoPortfolios, demoPortfolioHoldings } from './demo/demo-portfolio';

export class PortfolioSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxPortfolioEntities = [];
    const portfolioByName = new Map<string, Portfolio>();
    // DEMO
    for (const portfolioTemplate of demoPortfolios) {
      const demoPortfolio = em.create(Portfolio, {
        currencyKey: ctx.currencies.find((c) => c.code === portfolioTemplate.currency)?.currencyKey,
        description: portfolioTemplate.description,
        name: portfolioTemplate.name,
        portfolioOwnerAppuserKey: ctx._DEMO_appuser,
        tenantKey: ctx._DEMO_tenant,
      });
      ctxPortfolioEntities.push(demoPortfolio);
      portfolioByName.set(demoPortfolio.name, demoPortfolio);
    }
    // ADMIN
    ctxPortfolioEntities.push(
      em.create(Portfolio, {
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        description: 'Long-term tech investments from 2022',
        name: 'Tech Stocks batch1 2022',
        portfolioOwnerAppuserKey: ctx._ADMIN_appuser,
        tenantKey: ctx._ADMIN_tenant,
      }),
    );
    ctxPortfolioEntities.push(
      em.create(Portfolio, {
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        name: 'ESG test 5x 2022',
        portfolioOwnerAppuserKey: ctx._ADMIN_appuser,
        tenantKey: ctx._ADMIN_tenant,
      }),
    );
    ctxPortfolioEntities.push(
      em.create(Portfolio, {
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        name: 'Only US Stocks',
        portfolioOwnerAppuserKey: ctx._ADMIN_appuser,
        tenantKey: ctx._ADMIN_tenant,
      }),
    );
    ctx.portfolios = ctxPortfolioEntities;
    ctx.demoPortfolioHoldings = demoPortfolioHoldings.map((holding) => ({
      ...holding,
      portfolioKey: portfolioByName.get(holding.portfolioName),
    }));
  }
}
