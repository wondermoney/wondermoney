import { describe, expect, it } from 'vitest';

import {
  buildPortfolioImportAssetIdentityHash,
  extractPortfolioImportAssetIdentity,
  scorePortfolioImportAssetCandidate,
} from '../portfolio-import-asset-resolution.utils';

describe('portfolio import asset resolution utils', () => {
  it('extracts identity from the normalizedJson shape', () => {
    expect(
      extractPortfolioImportAssetIdentity({
        assetName: '  iShares   Core MSCI   World UCITS ETF  ',
        assetSymbol: ' vwce ',
        brokerExchange: ' xetra ',
        currency: ' eur ',
        isin: ' ie00b4l5y983 ',
        ticker: ' vwce ',
      }),
    ).toEqual({
      brokerAssetName: 'iShares Core MSCI World UCITS ETF',
      brokerExchange: 'XETRA',
      brokerTicker: 'VWCE',
      currency: 'EUR',
      isin: 'IE00B4L5Y983',
    });
  });

  it('returns undefined when there is no asset identity', () => {
    expect(
      extractPortfolioImportAssetIdentity({
        currency: 'EUR',
      }),
    ).toBeUndefined();
  });

  it('builds the same hash for the same identity regardless of case and spacing', () => {
    const hashA = buildPortfolioImportAssetIdentityHash({
      brokerAssetName: ' iShares   Core MSCI World UCITS ETF ',
      brokerExchange: 'xetra',
      brokerTicker: 'vwce',
      currency: 'eur',
      isin: 'ie00b4l5y983',
    });

    const hashB = buildPortfolioImportAssetIdentityHash({
      brokerAssetName: 'iShares Core MSCI World UCITS ETF',
      brokerExchange: 'XETRA',
      brokerTicker: 'VWCE',
      currency: 'EUR',
      isin: 'IE00B4L5Y983',
    });

    expect(hashA).toHaveLength(64);
    expect(hashA).toBe(hashB);
  });

  it('normalizes asset name case for hashing', () => {
    const hashA = buildPortfolioImportAssetIdentityHash({ brokerAssetName: 'Apple Inc' });
    const hashB = buildPortfolioImportAssetIdentityHash({ brokerAssetName: 'apple   inc' });

    expect(hashA).toBe(hashB);
  });

  it('avoids delimiter collision when hashing structured identity components', () => {
    const hashA = buildPortfolioImportAssetIdentityHash({
      brokerAssetName: 'bar',
      brokerExchange: 'x',
      brokerTicker: 'a|b',
      currency: 'c',
      isin: 'd',
    });

    const hashB = buildPortfolioImportAssetIdentityHash({
      brokerAssetName: 'bar',
      brokerExchange: 'a',
      brokerTicker: 'b',
      currency: 'c',
      isin: 'd|x',
    });

    expect(hashA).not.toBe(hashB);
  });

  it('produces different hashes for different identity components', () => {
    const base = {
      brokerAssetName: 'iShares Core MSCI World UCITS ETF',
      brokerExchange: 'XETRA',
      brokerTicker: 'VWCE',
      currency: 'EUR',
      isin: 'IE00B4L5Y983',
    };

    expect(buildPortfolioImportAssetIdentityHash(base)).not.toBe(
      buildPortfolioImportAssetIdentityHash({ ...base, currency: 'USD' }),
    );
    expect(buildPortfolioImportAssetIdentityHash(base)).not.toBe(
      buildPortfolioImportAssetIdentityHash({ ...base, brokerExchange: 'AEB' }),
    );
    expect(buildPortfolioImportAssetIdentityHash(base)).not.toBe(
      buildPortfolioImportAssetIdentityHash({ ...base, brokerTicker: 'SPY' }),
    );
  });

  it('scores candidates by identity strength', () => {
    expect(
      scorePortfolioImportAssetCandidate(
        { isin: 'IE00B4L5Y983' },
        { currency: 'USD', isin: 'IE00B4L5Y983', name: 'whatever' },
      ),
    ).toEqual({ confidence: 1 });

    expect(
      scorePortfolioImportAssetCandidate(
        { currency: 'EUR', isin: 'IE00B4L5Y983' },
        { currency: 'EUR', isin: 'US0378331005' },
      ),
    ).toEqual({ confidence: 0.1, rejectedReason: 'isin_mismatch' });

    expect(
      scorePortfolioImportAssetCandidate(
        { brokerExchange: 'XETRA', brokerTicker: 'VWCE', currency: 'EUR' },
        { currency: 'eur', exchange: 'xetra', symbol: 'vwce' },
      ),
    ).toEqual({ confidence: 0.95 });

    expect(
      scorePortfolioImportAssetCandidate(
        { brokerExchange: 'XETRA', brokerTicker: 'VWCE' },
        { exchange: 'XETRA', symbol: 'VWCE' },
      ),
    ).toEqual({ confidence: 0.85 });

    expect(
      scorePortfolioImportAssetCandidate(
        { brokerTicker: 'VWCE' },
        { symbol: 'VWCE' },
      ),
    ).toEqual({ confidence: 0.7 });

    expect(
      scorePortfolioImportAssetCandidate(
        { brokerAssetName: 'iShares Core MSCI World UCITS ETF' },
        { name: 'iShares Core MSCI World UCITS ETF' },
      ),
    ).toEqual({ confidence: 0.5 });
  });

  it('flags currency mismatches', () => {
    expect(
      scorePortfolioImportAssetCandidate(
        { brokerExchange: 'XETRA', brokerTicker: 'VWCE', currency: 'EUR' },
        { currency: 'USD', exchange: 'XETRA', symbol: 'VWCE' },
      ),
    ).toEqual({ confidence: 0.1, rejectedReason: 'currency_mismatch' });
  });

  it('flags exchange mismatches when ticker matches', () => {
    expect(
      scorePortfolioImportAssetCandidate(
        { brokerExchange: 'XETRA', brokerTicker: 'VWCE' },
        { exchange: 'AEB', symbol: 'VWCE' },
      ),
    ).toEqual({ confidence: 0.25, rejectedReason: 'exchange_mismatch' });
  });

  it('does not throw on null or unknown field values and ignores currency-only rows', () => {
    expect(
      extractPortfolioImportAssetIdentity({
        assetName: null,
        assetSymbol: undefined,
        brokerAssetName: 123,
        brokerExchange: null,
        currency: 'eur',
        isin: false,
        ticker: null,
      }),
    ).toBeUndefined();
  });
});
