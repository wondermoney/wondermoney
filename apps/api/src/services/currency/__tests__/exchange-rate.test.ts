import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { FxStatus } from '@entity/Transaction';

import { convertWithStatus, loadRateTable, resolveExchangeRate } from '../exchange-rate';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/*
 * One resolver picks every conversion rate. It answers with a stored rate or with nothing, never
 * with an implied 1 for two different currencies.
 */
describe('resolving an exchange rate', () => {
  const db = useTestDatabase();

  async function eurUsd(rates: [string, number][]) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = await currencyFor(em, 'EUR');
    const usd = await currencyFor(em, 'USD');
    const jpy = await currencyFor(em, 'JPY');
    for (const [date, rate] of rates) em.create(ExchangeRate, { date: day(date), fromCurrency: usd, rate, toCurrency: eur }, { partial: true });
    await em.flush();
    return { em, eur, jpy, scope: { tenantKey: household.tenant.tenantKey }, usd };
  }

  it('takes the latest rate on or before the date', async () => {
    const { em, eur, scope, usd } = await eurUsd([['2026-03-02', 0.91], ['2026-03-05', 0.92], ['2026-03-09', 0.95]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-06'), scope)).toEqual({ rate: 0.92, rateDate: day('2026-03-05'), source: 'ecb', status: FxStatus.EXACT });
  });

  it('marks a rate older than the staleness window provisional', async () => {
    const { em, eur, scope, usd } = await eurUsd([['2026-03-02', 0.91]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-20'), scope)).toMatchObject({ rate: 0.91, status: FxStatus.PROVISIONAL });
    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-20'), { ...scope, staleAfterDays: 30 })).toMatchObject({ status: FxStatus.EXACT });
  });

  it('finds nothing when no rate is stored on or before the date', async () => {
    const { em, eur, jpy, scope, usd } = await eurUsd([['2026-03-09', 0.95]]);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-01'), scope)).toBeNull();
    expect(await resolveExchangeRate(em, jpy, eur, day('2026-03-10'), scope)).toBeNull();
  });

  it('needs no rate within one currency', async () => {
    const { em, eur, scope } = await eurUsd([]);

    expect(await resolveExchangeRate(em, eur, eur, day('2026-03-01'), scope)).toMatchObject({ rate: 1, source: 'same-currency', status: FxStatus.EXACT });
  });

  it('stores no converted amount when no rate exists, rather than the foreign amount', async () => {
    const { em, eur, jpy, scope, usd } = await eurUsd([['2026-03-05', 0.92]]);

    expect(await convertWithStatus(em, 10_000, jpy, eur, day('2026-03-06'), scope)).toEqual({ amount: null, fxStatus: FxStatus.MISSING, rate: null });
    expect(await convertWithStatus(em, 19.99, usd, eur, day('2026-03-06'), scope)).toEqual({ amount: 18.3908, fxStatus: FxStatus.EXACT, rate: 0.92 });
    expect(await convertWithStatus(em, 5, eur, eur, day('2026-03-06'), scope)).toEqual({ amount: 5, fxStatus: FxStatus.EXACT, rate: null });
  });
});

/*
 * A household can set its own rate for a pair and day. The household's overrides and the feed's
 * rates form one timeline: the latest rate on or before the date wins, and on the override's own
 * day the override wins. Another household never sees it.
 */
describe('a household override', () => {
  const db = useTestDatabase();

  interface World {
    em: EntityManager;
    eur: Currency;
    home: Household;
    neighbour: Household;
    usd: Currency;
    xof: Currency;
  }

  async function world(): Promise<World> {
    const em = db.em();
    const home = await seedHousehold(em);
    const neighbour = await seedHousehold(em);
    return { em, eur: await currencyFor(em, 'EUR'), home, neighbour, usd: await currencyFor(em, 'USD'), xof: await currencyFor(em, 'XOF') };
  }

  async function feedRate(em: EntityManager, from: Currency, to: Currency, date: string, rate: number) {
    em.create(ExchangeRate, { date: day(date), fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function override(em: EntityManager, household: Household, from: Currency, to: Currency, date: string, rate: number, deleted = false) {
    em.create(ExchangeRateOverride, { date: day(date), deletedAt: deleted ? new Date() : undefined, fromCurrency: from, rate, tenantKey: household.tenant, toCurrency: to }, { partial: true });
    await em.flush();
  }

  const scopeOf = (household: Household) => ({ tenantKey: household.tenant.tenantKey });

  it('converts a pair the feed does not cover', async () => {
    const { em, eur, home, xof } = await world();
    await override(em, home, xof, eur, '2026-03-02', 0.00152);

    expect(await resolveExchangeRate(em, xof, eur, day('2026-03-04'), scopeOf(home))).toEqual({ rate: 0.00152, rateDate: day('2026-03-02'), source: 'override', status: FxStatus.EXACT });
    expect(await convertWithStatus(em, 10_000, xof, eur, day('2026-03-04'), scopeOf(home))).toEqual({ amount: 15.2, fxStatus: FxStatus.EXACT, rate: 0.00152 });
  });

  it('wins over the feed rate on its own day', async () => {
    const { em, eur, home, usd } = await world();
    await feedRate(em, usd, eur, '2026-03-02', 0.91);
    await override(em, home, usd, eur, '2026-03-02', 0.95);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-02'), scopeOf(home))).toMatchObject({ rate: 0.95, source: 'override' });
  });

  it('gives way to a feed rate published after its day', async () => {
    const { em, eur, home, usd } = await world();
    await override(em, home, usd, eur, '2026-03-02', 0.95);
    await feedRate(em, usd, eur, '2026-03-03', 0.91);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-02'), scopeOf(home))).toMatchObject({ rate: 0.95, source: 'override' });
    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-05'), scopeOf(home))).toMatchObject({ rate: 0.91, source: 'ecb' });
  });

  it('carries forward until a later rate, and turns provisional once it is old', async () => {
    const { em, eur, home, xof } = await world();
    await override(em, home, xof, eur, '2026-03-02', 0.00152);

    expect(await resolveExchangeRate(em, xof, eur, day('2026-03-30'), scopeOf(home))).toMatchObject({ rate: 0.00152, source: 'override', status: FxStatus.PROVISIONAL });
    expect(await resolveExchangeRate(em, xof, eur, day('2026-03-01'), scopeOf(home))).toBeNull();
  });

  it('converts only the direction it was set for', async () => {
    const { em, eur, home, xof } = await world();
    await override(em, home, xof, eur, '2026-03-02', 0.00152);

    expect(await resolveExchangeRate(em, eur, xof, day('2026-03-04'), scopeOf(home))).toBeNull();
  });

  it('is never used for another household, even with no tenant filter in force', async () => {
    const { em, eur, home, neighbour, usd, xof } = await world();
    await feedRate(em, usd, eur, '2026-03-02', 0.91);
    await override(em, home, usd, eur, '2026-03-02', 0.95);
    await override(em, home, xof, eur, '2026-03-02', 0.00152);

    // `db.em()` carries no tenant context, as in a worker: only the explicit scope keeps them apart.
    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-02'), scopeOf(neighbour))).toMatchObject({ rate: 0.91, source: 'ecb' });
    expect(await resolveExchangeRate(em, xof, eur, day('2026-03-02'), scopeOf(neighbour))).toBeNull();
  });

  it('stops counting once deleted, falling back to the feed or to nothing', async () => {
    const { em, eur, home, usd, xof } = await world();
    await feedRate(em, usd, eur, '2026-03-02', 0.91);
    await override(em, home, usd, eur, '2026-03-02', 0.95, true);
    await override(em, home, xof, eur, '2026-03-02', 0.00152, true);

    expect(await resolveExchangeRate(em, usd, eur, day('2026-03-02'), scopeOf(home))).toMatchObject({ rate: 0.91, source: 'ecb' });
    expect(await convertWithStatus(em, 100, xof, eur, day('2026-03-02'), scopeOf(home))).toEqual({ amount: null, fxStatus: FxStatus.MISSING, rate: null });
  });

  describe('in a preloaded rate table', () => {
    it('answers as the resolver does', async () => {
      const { em, eur, home, usd, xof } = await world();
      await feedRate(em, usd, eur, '2026-02-27', 0.9);
      await feedRate(em, usd, eur, '2026-03-02', 0.91);
      await override(em, home, usd, eur, '2026-03-02', 0.95);
      await feedRate(em, usd, eur, '2026-03-03', 0.92);
      await override(em, home, xof, eur, '2026-02-01', 0.00152);

      const table = await loadRateTable(em, [{ from: 'USD', to: 'EUR' }, { from: 'XOF', to: 'EUR' }], { from: day('2026-03-01'), to: day('2026-03-31') }, scopeOf(home));

      expect(table.rateOn('USD', 'EUR', day('2026-03-01'))).toBe(0.9);
      expect(table.rateOn('USD', 'EUR', day('2026-03-02'))).toBe(0.95);
      expect(table.rateOn('USD', 'EUR', day('2026-03-04'))).toBe(0.92);
      expect(table.resolve('XOF', 'EUR', day('2026-03-02'))).toEqual({ rate: 0.00152, rateDate: day('2026-02-01'), source: 'override', status: FxStatus.PROVISIONAL });
      for (const date of ['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-20']) {
        expect(table.resolve('USD', 'EUR', day(date))).toEqual(await resolveExchangeRate(em, usd, eur, day(date), scopeOf(home)));
      }
    });

    it('holds only its own household overrides', async () => {
      const { em, eur, home, neighbour, usd, xof } = await world();
      await feedRate(em, usd, eur, '2026-03-02', 0.91);
      await override(em, home, usd, eur, '2026-03-02', 0.95);
      await override(em, home, xof, eur, '2026-03-02', 0.00152);

      const table = await loadRateTable(em, [{ from: 'USD', to: 'EUR' }, { from: 'XOF', to: 'EUR' }], { from: day('2026-03-01'), to: day('2026-03-31') }, scopeOf(neighbour));

      expect(table.rateOn('USD', 'EUR', day('2026-03-02'))).toBe(0.91);
      expect(table.rateOn('XOF', 'EUR', day('2026-03-02'))).toBeNull();
    });
  });
});
