import type { EntityManager } from '@mikro-orm/core';

import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

export interface PortfolioBroker { displayName: string; id: number; name: string }

/** Imports that wrote transactions: an abandoned or failed upload says nothing about where the portfolio lives. */
const LANDED_IMPORTS = [PortfolioImportSessionStatus.SUCCEEDED, PortfolioImportSessionStatus.PARTIAL];

/**
 * The broker each portfolio was last imported from. A portfolio has no broker of its own, so its
 * latest landed import that named one stands in. Portfolios kept by hand have none and are absent.
 */
export async function latestImportBrokers(em: EntityManager, portfolioKeys: readonly number[]): Promise<Map<number, PortfolioBroker>> {
  const brokers = new Map<number, PortfolioBroker>();
  if (portfolioKeys.length === 0) return brokers;
  const sessions = await em.find(
    PortfolioImportSession,
    {
      deletedAt: undefined,
      financialBrokerKey: { $ne: null },
      portfolioKey: { portfolioKey: { $in: [...portfolioKeys] } },
      status: { $in: LANDED_IMPORTS },
    },
    { orderBy: { createdAt: 'desc' }, populate: ['financialBrokerKey'] },
  );
  for (const session of sessions) {
    const portfolioKey = session.portfolioKey.portfolioKey;
    const broker = session.financialBrokerKey;
    if (!broker || brokers.has(portfolioKey)) continue;
    brokers.set(portfolioKey, { displayName: broker.displayName, id: broker.financialBrokerKey, name: broker.name });
  }
  return brokers;
}
