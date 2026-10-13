import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BadRequestError, NotFoundError } from '@utils/errors';

const eodhdMocks = vi.hoisted(() => ({
  getDividends: vi.fn(),
  getEndOfDayPrices: vi.fn(),
  getQuote: vi.fn(),
  getSplits: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@service/market-data/eodhd.service', () => ({
  default: {
    getDividends: eodhdMocks.getDividends,
    getEndOfDayPrices: eodhdMocks.getEndOfDayPrices,
    getQuote: eodhdMocks.getQuote,
    getSplits: eodhdMocks.getSplits,
    search: eodhdMocks.search,
  },
  handleEodhdError: (error: unknown) => {
    throw error
  },
}));

function fakeRes() {
  const json = vi.fn();
  return { json, res: { json } as unknown as Response };
}

describe('financial-markets controller (RAD-228 stable DTOs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCompanyInformation', () => {
    // This endpoint migrated its data-fetch logic to EODHD search (RAD-449);
    // the Fundamentals-tier fields (beta, ceo, description, etc.) are not
    // available from search results and are always null — a deliberate
    // degradation, not a bug. price/changePercentage come from a separate
    // real-time quote call (RAD-649, see the dedicated tests below) — here
    // getQuote is unmocked, so that call throws and both fields fall back to
    // null, same as their eventual "quote unavailable" behavior in prod.
    it('returns a reduced company-information DTO sourced from an exact EODHD symbol match', async () => {
      const { getCompanyInformation } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        {
          Code: 'AAPL',
          Country: 'USA',
          Currency: 'USD',
          Exchange: 'US',
          ISIN: 'US0378331005',
          Name: 'Apple Inc',
          previousClose: 185.64,
          previousCloseDate: '2026-01-02',
          Type: 'Common Stock',
        },
      ]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await getCompanyInformation(req, res);

      expect(eodhdMocks.search).toHaveBeenCalledWith('AAPL');
      expect(json).toHaveBeenCalledWith({
        companyInformation: {
          beta: null,
          ceo: null,
          changePercentage: null,
          country: 'USA',
          currency: 'USD',
          description: null,
          employees: null,
          exchange: 'US',
          image: null,
          industry: null,
          name: 'Apple Inc',
          price: null,
          sector: null,
          symbol: 'AAPL',
          website: null,
        },
      });
    });

    it('falls back to the first result when no exact symbol match exists', async () => {
      const { getCompanyInformation } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        { Code: 'AAP', Country: 'USA', Currency: 'USD', Exchange: 'US', Name: 'Advance Auto Parts', Type: 'Common Stock' },
      ]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await getCompanyInformation(req, res);

      const payload = json.mock.calls[0]?.[0] as { companyInformation: Record<string, unknown> };
      expect(payload.companyInformation['symbol']).toBe('AAP');
      expect(payload.companyInformation['name']).toBe('Advance Auto Parts');
    });

    it('returns {companyInformation: null} when EODHD search finds nothing', async () => {
      const { getCompanyInformation } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'ZZZZZ' } } as unknown as Request;

      await getCompanyInformation(req, res);

      expect(json).toHaveBeenCalledWith({ companyInformation: null });
    });

    // RAD-649 — Explorer (this endpoint) and Watchlist (getQuote below) used
    // to derive "current price" from two different EODHD calls: this
    // endpoint hardcoded price/changePercentage to null (wrongly assuming
    // they were Fundamentals-gated like beta/ceo/description), so the
    // frontend fell back to a last-close figure from historical EOD data
    // while the watchlist showed a genuine real-time quote. This endpoint
    // must now source price/changePercentage from the same real-time quote
    // call getQuote uses, so both surfaces agree.
    it('populates price and changePercentage from the same real-time quote getQuote uses', async () => {
      const { getCompanyInformation } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        { Code: 'TSLA', Country: 'USA', Currency: 'USD', Exchange: 'US', Name: 'Tesla Inc', Type: 'Common Stock' },
      ]);
      eodhdMocks.getQuote.mockResolvedValue({
        change: -6.18,
        change_p: -1.7623,
        close: 344.07,
        code: 'TSLA',
        timestamp: 1767340800,
        volume: 90_000_000,
      });
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'TSLA' } } as unknown as Request;

      await getCompanyInformation(req, res);

      expect(eodhdMocks.getQuote).toHaveBeenCalledWith('TSLA');
      const payload = json.mock.calls[0]?.[0] as { companyInformation: Record<string, unknown> };
      expect(payload.companyInformation['price']).toBe(344.07);
      expect(payload.companyInformation['changePercentage']).toBe(-1.7623);
    });

    it('degrades to a null price/changePercentage (not a thrown error) when the real-time quote call fails', async () => {
      const { getCompanyInformation } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        { Code: 'TSLA', Country: 'USA', Currency: 'USD', Exchange: 'US', Name: 'Tesla Inc', Type: 'Common Stock' },
      ]);
      eodhdMocks.getQuote.mockRejectedValue(new Error('provider timeout'));
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'TSLA' } } as unknown as Request;

      await getCompanyInformation(req, res);

      const payload = json.mock.calls[0]?.[0] as { companyInformation: Record<string, unknown> };
      expect(payload.companyInformation['name']).toBe('Tesla Inc');
      expect(payload.companyInformation['price']).toBeNull();
      expect(payload.companyInformation['changePercentage']).toBeNull();
    });

    // The actual RAD-649 regression: given the identical underlying EODHD
    // real-time quote payload, the price-fetch path behind Explorer
    // (getCompanyInformation) and the one behind Watchlist (getQuote) must
    // agree on price and changePercentage. This asserts consistency between
    // the two functions directly, rather than only asserting each in
    // isolation against a hand-picked expected value.
    it('agrees with getQuote on price and changePercentage for the same underlying quote (Explorer vs Watchlist consistency)', async () => {
      const { getCompanyInformation, getQuote } = await import('../financial-markets');
      const rawQuote = {
        change: 1.3,
        change_p: 0.3714,
        close: 350.25,
        code: 'TSLA',
        timestamp: 1767340800,
        volume: 80_000_000,
      };
      eodhdMocks.search.mockResolvedValue([
        { Code: 'TSLA', Country: 'USA', Currency: 'USD', Exchange: 'US', Name: 'Tesla Inc', Type: 'Common Stock' },
      ]);
      eodhdMocks.getQuote.mockResolvedValue(rawQuote);

      const explorerRes = fakeRes();
      await getCompanyInformation({ params: { ticker: 'TSLA' } } as unknown as Request, explorerRes.res);
      const explorerPayload = explorerRes.json.mock.calls[0]?.[0] as { companyInformation: Record<string, unknown> };

      const watchlistRes = fakeRes();
      await getQuote({ params: { ticker: 'TSLA' } } as unknown as Request, watchlistRes.res);
      const watchlistPayload = watchlistRes.json.mock.calls[0]?.[0] as Record<string, unknown>;

      expect(explorerPayload.companyInformation['price']).toBe(watchlistPayload['price']);
      expect(explorerPayload.companyInformation['changePercentage']).toBe(watchlistPayload['changePercent']);
    });
  });

  describe('getFinancials (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError without calling any provider', async () => {
      const { getFinancials } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await expect(getFinancials(req, res)).rejects.toBeInstanceOf(NotFoundError);
      expect(eodhdMocks.search).not.toHaveBeenCalled();
      expect(eodhdMocks.getQuote).not.toHaveBeenCalled();
      expect(eodhdMocks.getEndOfDayPrices).not.toHaveBeenCalled();
      expect(eodhdMocks.getDividends).not.toHaveBeenCalled();
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed ticker)', async () => {
      const { getFinancials } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: '' } } as unknown as Request;

      await expect(getFinancials(req, res)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('getQuote', () => {
    // This endpoint migrated its data-fetch logic to EODHD (RAD-449).
    const EODHD_SOURCE = { asOf: null, provider: 'eodhd' } as const;

    it('returns a quote DTO from EODHD realTime data', async () => {
      eodhdMocks.getQuote.mockResolvedValue({
        change: 2.24,
        change_p: 1.2213,
        close: 185.64,
        code: 'AAPL',
        gmtoffset: 0,
        high: 186.0,
        low: 183.5,
        open: 184.0,
        previousClose: 183.4,
        timestamp: 1767340800,
        volume: 50_000_000,
      });
      const { getQuote } = await import('../financial-markets');
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await getQuote(req, res);

      expect(json).toHaveBeenCalledWith({
        change: 2.24,
        changePercent: 1.2213,
        currency: null,
        marketState: null,
        name: null,
        price: 185.64,
        source: EODHD_SOURCE,
        symbol: 'AAPL',
        timestamp: new Date(1767340800 * 1000).toISOString(),
        volume: 50_000_000,
      });
    });

    it('propagates a provider error through handleEodhdError when EODHD rejects', async () => {
      eodhdMocks.getQuote.mockRejectedValue(new Error('not found'));
      const { getQuote } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: 'ZZZINVALID' } } as unknown as Request;

      await expect(getQuote(req, res)).rejects.toThrow('not found');
    });
  });

  describe('getFundamentals (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError without calling any provider', async () => {
      const { getFundamentals } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await expect(getFundamentals(req, res)).rejects.toBeInstanceOf(NotFoundError);
      expect(eodhdMocks.search).not.toHaveBeenCalled();
      expect(eodhdMocks.getQuote).not.toHaveBeenCalled();
      expect(eodhdMocks.getEndOfDayPrices).not.toHaveBeenCalled();
      expect(eodhdMocks.getDividends).not.toHaveBeenCalled();
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed ticker)', async () => {
      const { getFundamentals } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: '' } } as unknown as Request;

      await expect(getFundamentals(req, res)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('getHistoricalPrice', () => {
    // This endpoint migrated its data-fetch logic to EODHD (RAD-449).
    const EODHD_SOURCE = { asOf: null, provider: 'eodhd' } as const;

    it('merges dividends into price history by date and projects to the stable DTO', async () => {
      const { getHistoricalPrice } = await import('../financial-markets');
      eodhdMocks.getEndOfDayPrices.mockResolvedValue([
        { close: 100, date: '2026-01-01' },
        { close: 110, date: '2026-01-02' },
      ]);
      // EODHD's getDividends returns the per-share dividend cash amount in
      // `value` (not an adjusted-close price like FMP's getDividendAdjusted
      // was). The controller merges that value in by date.
      eodhdMocks.getDividends.mockResolvedValue([{ date: '2026-01-02', value: 0.5 }]);
      const { json, res } = fakeRes();
      const req = {
        params: { ticker: 'AAPL' },
        query: { includeDividends: 'true' },
      } as unknown as Request;

      await getHistoricalPrice(req, res);

      expect(json).toHaveBeenCalledWith({
        prices: [
          { adjClose: null, close: 100, date: '2026-01-01', high: null, low: null, open: null, volume: null },
          { adjClose: 0.5, close: 110, date: '2026-01-02', high: null, low: null, open: null, volume: null },
        ],
        source: EODHD_SOURCE,
        symbol: 'AAPL',
      });
    });

    it('returns historical prices with dividend amounts merged in when includeDividends is true', async () => {
      const { getHistoricalPrice } = await import('../financial-markets');
      eodhdMocks.getEndOfDayPrices.mockResolvedValue([
        { adjusted_close: 185.64, close: 185.64, date: '2026-01-02', high: 186.0, low: 183.5, open: 184.0, volume: 50_000_000 },
      ]);
      eodhdMocks.getDividends.mockResolvedValue([{ date: '2026-01-02', value: 0.24 }]);
      const { json, res } = fakeRes();
      const req = {
        params: { ticker: 'AAPL' },
        query: { from: '2026-01-01', includeDividends: 'true', to: '2026-01-31' },
      } as unknown as Request;

      await getHistoricalPrice(req, res);

      expect(eodhdMocks.getEndOfDayPrices).toHaveBeenCalledWith('AAPL', { from: '2026-01-01', to: '2026-01-31' });
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          prices: [expect.objectContaining({ adjClose: 0.24, close: 185.64, date: '2026-01-02' })],
        }),
      );
    });

    it('does not fetch dividends and returns null adjClose when includeDividends is false', async () => {
      const { getHistoricalPrice } = await import('../financial-markets');
      eodhdMocks.getEndOfDayPrices.mockResolvedValue([{ close: 100, date: '2026-01-01' }]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' }, query: {} } as unknown as Request;

      await getHistoricalPrice(req, res);

      expect(eodhdMocks.getDividends).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        prices: [{ adjClose: null, close: 100, date: '2026-01-01', high: null, low: null, open: null, volume: null }],
        source: EODHD_SOURCE,
        symbol: 'AAPL',
      });
    });

    it('drops price rows whose date is unparseable', async () => {
      const { getHistoricalPrice } = await import('../financial-markets');
      eodhdMocks.getEndOfDayPrices.mockResolvedValue([
        { close: 100, date: '2026-01-01' },
        { close: 101, date: 'bad-date' },
      ]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' }, query: {} } as unknown as Request;

      await getHistoricalPrice(req, res);

      expect(json).toHaveBeenCalledWith({
        prices: [{ adjClose: null, close: 100, date: '2026-01-01', high: null, low: null, open: null, volume: null }],
        source: EODHD_SOURCE,
        symbol: 'AAPL',
      });
    });
  });

  describe('searchTicker', () => {
    // This endpoint migrated its data-fetch logic to EODHD (RAD-449).
    const EODHD_SOURCE = { asOf: null, provider: 'eodhd' } as const;

    it('returns an empty list with the source metadata for a blank search term', async () => {
      const { searchTicker } = await import('../financial-markets');
      const { json, res } = fakeRes();
      const req = { query: { searchTerm: '  ' } } as unknown as Request;

      await searchTicker(req, res);

      expect(json).toHaveBeenCalledWith({ results: [], source: EODHD_SOURCE });
      expect(eodhdMocks.search).not.toHaveBeenCalled();
    });

    it('returns an empty list when the search term is absent', async () => {
      const { searchTicker } = await import('../financial-markets');
      const { json, res } = fakeRes();
      const req = { query: {} } as unknown as Request;

      await searchTicker(req, res);

      expect(json).toHaveBeenCalledWith({ results: [], source: EODHD_SOURCE });
      expect(eodhdMocks.search).not.toHaveBeenCalled();
    });

    it('returns mapped results from a single EODHD search call', async () => {
      const { searchTicker } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        {
          Code: 'AAPL',
          Country: 'USA',
          Currency: 'USD',
          Exchange: 'US',
          ISIN: 'US0378331005',
          Name: 'Apple Inc',
          previousClose: 185.64,
          previousCloseDate: '2026-01-02',
          Type: 'Common Stock',
        },
      ]);
      const { json, res } = fakeRes();
      const req = { query: { searchTerm: 'Apple' } } as unknown as Request;

      await searchTicker(req, res);

      expect(eodhdMocks.search).toHaveBeenCalledWith('Apple');
      expect(json).toHaveBeenCalledWith({
        results: [{ currency: 'USD', exchange: 'US', name: 'Apple Inc', symbol: 'AAPL', type: 'Common Stock' }],
        source: EODHD_SOURCE,
      });
    });

    it('accepts an ISIN as the query string in the same single call (no fallback chain)', async () => {
      const { searchTicker } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([
        {
          Code: 'AAPL',
          Country: 'USA',
          Currency: 'USD',
          Exchange: 'US',
          ISIN: 'US0378331005',
          Name: 'Apple Inc',
          previousClose: 185.64,
          previousCloseDate: '2026-01-02',
          Type: 'Common Stock',
        },
      ]);
      const { json, res } = fakeRes();
      const req = { query: { searchTerm: 'US0378331005' } } as unknown as Request;

      await searchTicker(req, res);

      expect(eodhdMocks.search).toHaveBeenCalledWith('US0378331005');
      expect(eodhdMocks.search).toHaveBeenCalledTimes(1);
      expect(json).toHaveBeenCalledWith({
        results: [{ currency: 'USD', exchange: 'US', name: 'Apple Inc', symbol: 'AAPL', type: 'Common Stock' }],
        source: EODHD_SOURCE,
      });
    });

    it('returns an empty list when EODHD finds no matches', async () => {
      const { searchTicker } = await import('../financial-markets');
      eodhdMocks.search.mockResolvedValue([]);
      const { json, res } = fakeRes();
      const req = { query: { searchTerm: 'ZZZNONE' } } as unknown as Request;

      await searchTicker(req, res);

      expect(json).toHaveBeenCalledWith({ results: [], source: EODHD_SOURCE });
    });
  });

  describe('getEarnings (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError without calling any provider', async () => {
      const { getEarnings } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await expect(getEarnings(req, res)).rejects.toBeInstanceOf(NotFoundError);
      expect(eodhdMocks.search).not.toHaveBeenCalled();
      expect(eodhdMocks.getQuote).not.toHaveBeenCalled();
      expect(eodhdMocks.getEndOfDayPrices).not.toHaveBeenCalled();
      expect(eodhdMocks.getDividends).not.toHaveBeenCalled();
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed ticker)', async () => {
      const { getEarnings } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: '' } } as unknown as Request;

      await expect(getEarnings(req, res)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('getNews (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError without calling any provider', async () => {
      const { getNews } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: 'AAPL' }, query: {} } as unknown as Request;

      await expect(getNews(req, res)).rejects.toBeInstanceOf(NotFoundError);
      expect(eodhdMocks.search).not.toHaveBeenCalled();
      expect(eodhdMocks.getQuote).not.toHaveBeenCalled();
      expect(eodhdMocks.getEndOfDayPrices).not.toHaveBeenCalled();
      expect(eodhdMocks.getDividends).not.toHaveBeenCalled();
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed ticker)', async () => {
      const { getNews } = await import('../financial-markets');
      const { res } = fakeRes();
      const req = { params: { ticker: '' }, query: {} } as unknown as Request;

      await expect(getNews(req, res)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('getHistoricalDividend', () => {
    // This endpoint migrated its data-fetch logic to EODHD (RAD-449).
    const EODHD_SOURCE = { asOf: null, provider: 'eodhd' } as const;

    it('projects dividend rows and drops entries whose date is unparseable', async () => {
      const { getHistoricalDividend } = await import('../financial-markets');
      // EODHD's dividend value is already the per-share cash amount; both DTO
      // fields (adjAmount/amount) carry that same value — not a fallback.
      eodhdMocks.getDividends.mockResolvedValue([
        { date: '2026-02-10', value: 0.24 },
        { date: 'bad-date', value: 0.22 },
      ]);
      const { json, res } = fakeRes();
      const req = { params: { ticker: 'AAPL' } } as unknown as Request;

      await getHistoricalDividend(req, res);

      expect(eodhdMocks.getDividends).toHaveBeenCalledWith('AAPL');
      expect(json).toHaveBeenCalledWith({
        dividends: [{ adjAmount: 0.24, amount: 0.24, date: '2026-02-10' }],
        source: EODHD_SOURCE,
        symbol: 'AAPL',
      });
    });
  });
});
