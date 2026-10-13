import { beforeEach, describe, expect, it, vi } from 'vitest';

const em = vi.hoisted(() => ({ find: vi.fn(), getKnex: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em } }));

import service from '@service/market-data/exchange-rate-refresh.service';

beforeEach(() => { vi.clearAllMocks(); });

const ecbXml = `<Cube>
  <Cube time='2026-06-04'>
    <Cube currency='USD' rate='1.1640'/>
    <Cube currency='GBP' rate='0.8420'/>
  </Cube>
</Cube>`;

function createKnexMock(firstResult: unknown, returningResult: unknown = [{ exchange_rate_key: 1 }]) {
  const returning = vi.fn().mockResolvedValue(returningResult);
  const insertFn = vi.fn().mockReturnValue({ onConflict: vi.fn().mockReturnValue({ ignore: vi.fn().mockReturnValue({ returning }) }) });
  const knex = Object.assign(vi.fn(() => ({ insert: insertFn })), {
    select: vi.fn(() => ({ from: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ first: vi.fn().mockResolvedValue(firstResult) })) })) })) })),
  });
  return knex;
}

describe('exchange rate refresh service', () => {
  it('chooses full history when there is no prior data', async () => {
    em.getKnex.mockReturnValue(createKnexMock(undefined));
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
    em.getKnex.mockReturnValue(createKnexMock({ date: new Date() }));
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
    em.getKnex.mockReturnValue(createKnexMock(undefined));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) }));

    await expect(service.refreshExchangeRates()).resolves.toMatchObject({ inserted: 1 });
  });

  it('parses single-quoted ECB xml and inserts rows', async () => {
    em.getKnex.mockReturnValue(createKnexMock(undefined, [{ exchange_rate_key: 1 }, { exchange_rate_key: 2 }, { exchange_rate_key: 3 }, { exchange_rate_key: 4 }]));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }, { code: 'USD', currencyKey: 2 }, { code: 'GBP', currencyKey: 3 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(ecbXml) }));

    const result = await service.refreshExchangeRates();

    expect(result).toMatchObject({ inserted: 4, totalRows: 6 });
  });

  it('fails when a non-empty ECB response yields no rows', async () => {
    em.getKnex.mockReturnValue(createKnexMock(undefined));
    em.find.mockResolvedValue([{ code: 'EUR', currencyKey: 1 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<Cube><Cube time="2026-06-04"><Cube currency="USD" rate="1.1640"/></Cube></Cube>') }));

    await expect(service.refreshExchangeRates()).rejects.toThrow('ECB exchange rate response contained no parsable rows');
  });
});
