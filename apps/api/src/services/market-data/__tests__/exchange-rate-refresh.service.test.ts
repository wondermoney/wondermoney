import { beforeEach, describe, expect, it, vi } from 'vitest';

const em = vi.hoisted(() => ({ find: vi.fn(), getKysely: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em } }));

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import service from '@service/market-data/exchange-rate-refresh.service';

beforeEach(() => { vi.clearAllMocks(); });

const ecbXml = `<Cube>
  <Cube time='2026-06-04'>
    <Cube currency='USD' rate='1.1640'/>
    <Cube currency='GBP' rate='0.8420'/>
  </Cube>
</Cube>`;

/** The latest stored rate row (`undefined`: none yet), and the keys an insert returns. */
function createDatabase(latestRow: unknown, returningResult: unknown[] = [{ exchange_rate_key: 1 }]) {
  return kyselyDouble((query) => (query.sql.startsWith('insert') ? returningResult : latestRow === undefined ? [] : [latestRow])).db;
}

describe('exchange rate refresh service', () => {
  it('chooses full history when there is no prior data', async () => {
    em.getKysely.mockReturnValue(createDatabase(undefined));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.refreshExchangeRates()).resolves.toMatchObject({ mode: 'full-history' });
    // The URL is what this test is about; request options (abort signal, headers) are
    // transport concerns asserted elsewhere.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
      expect.anything(),
    );
  });

  it('chooses daily when the last update is recent', async () => {
    // Postgres sends a timestamptz as text; MikroORM's pool does not parse it into a Date.
    em.getKysely.mockReturnValue(createDatabase({ date: new Date().toISOString().replace('T', ' ').replace('Z', '+00') }));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.refreshExchangeRates()).resolves.toMatchObject({ mode: 'daily' });
    // The URL is what this test is about; request options (abort signal, headers) are
    // transport concerns asserted elsewhere.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      expect.anything(),
    );
  });

  it('builds direct and cross rates', () => {
    const rows = service.buildRows([{ date: '2026-06-05', rates: { GBP: 0.8, USD: 1.2 } }], new Map([['EUR', 1], ['GBP', 3], ['USD', 2]]));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ from_currency_key: 1, rate: 1.2, to_currency_key: 2 }),
      expect.objectContaining({ from_currency_key: 2, rate: 1 / 1.2, to_currency_key: 1 }),
      expect.objectContaining({ from_currency_key: 3, rate: 1 / 0.8, to_currency_key: 1 }),
      expect.objectContaining({ from_currency_key: 2, rate: 0.8 / 1.2, to_currency_key: 3 }),
    ]));
  });

  it('batches inserts with conflict ignore', async () => {
    const database = kyselyDouble((query) => (query.sql.startsWith('insert') ? [{ exchange_rate_key: 1 }] : []));
    em.getKysely.mockReturnValue(database.db);
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) }));

    await expect(service.refreshExchangeRates()).resolves.toMatchObject({ inserted: 1 });
    const insert = database.queries.find((query) => query.sql.startsWith('insert'));
    expect(insert?.sql).toContain('on conflict ("from_currency_key", "to_currency_key", "date") do nothing');
  });

  it('parses single-quoted ECB xml and inserts rows', async () => {
    em.getKysely.mockReturnValue(createDatabase(undefined, [{ exchange_rate_key: 1 }, { exchange_rate_key: 2 }, { exchange_rate_key: 3 }, { exchange_rate_key: 4 }]));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) }));

    const result = await service.refreshExchangeRates();

    expect(result).toMatchObject({ inserted: 4, totalRows: 6 });
  });

  it('fails when a non-empty ECB response yields no rows', async () => {
    em.getKysely.mockReturnValue(createDatabase(undefined));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<Cube><Cube time="2026-06-04"><Cube currency="USD" rate="1.1640"/></Cube></Cube>') }));

    await expect(service.refreshExchangeRates()).rejects.toThrow('ECB exchange rate response contained no parsable rows');
  });
});
