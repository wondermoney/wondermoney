import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { latestImportBrokers } from '../portfolio-brokers';

const session = (portfolioKey: number, broker: null | { displayName: string; financialBrokerKey: number; name: string; }) => ({ financialBrokerKey: broker ?? undefined, portfolioKey: { portfolioKey } });
const degiro = { displayName: 'Degiro', financialBrokerKey: 1, name: 'degiro' };
const trading212 = { displayName: 'Trading212', financialBrokerKey: 3, name: 'trading212' };

describe('latestImportBrokers', () => {
  it('gives each portfolio the broker of its newest landed import', async () => {
    // Newest first, as the query orders them.
    const find = vi.fn().mockResolvedValue([session(1, trading212), session(1, degiro), session(2, degiro)]);
    const brokers = await latestImportBrokers({ find } as unknown as EntityManager, [1, 2, 3]);

    expect(Object.fromEntries(brokers)).toEqual({
      1: { displayName: 'Trading212', id: 3, name: 'trading212' },
      2: { displayName: 'Degiro', id: 1, name: 'degiro' },
    });
  });

  it('skips the query when there are no portfolios', async () => {
    const find = vi.fn();
    expect((await latestImportBrokers({ find } as unknown as EntityManager, [])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
