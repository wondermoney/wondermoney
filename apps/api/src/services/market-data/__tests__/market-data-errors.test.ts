import { EodhdError } from '@wondermoney/shared';
import { describe, expect, it } from 'vitest';

import { handleMarketDataError, type MarketDataErrorCode, MarketDataProviderError } from '../errors';

function caught(input: unknown): { name: string; retryAfter?: number; status?: number } {
  try {
    handleMarketDataError(input);
  } catch (error) {
    return error as { name: string; retryAfter?: number; status?: number };
  }
}

describe('handleMarketDataError', () => {
  it.each<[MarketDataErrorCode, number]>([
    ['not_found', 404],
    ['rate_limit', 429],
    ['auth_error', 502],
    ['timeout', 504],
    ['network_error', 502],
    ['server_error', 502],
    ['parse_error', 502],
    ['client_error', 400],
  ])('answers a free provider\'s %s with HTTP %i', (code, status) => {
    expect(caught(new MarketDataProviderError('stooq', code, 'upstream detail')).status).toBe(status);
  });

  it('carries the provider\'s retry hint, or a minute without one', () => {
    expect(caught(new MarketDataProviderError('coingecko', 'rate_limit', 'HTTP 429', 429, 30)).retryAfter).toBe(30);
    expect(caught(new MarketDataProviderError('coingecko', 'rate_limit', 'HTTP 429', 429)).retryAfter).toBe(60);
  });

  it('maps an EODHD failure exactly as before', () => {
    expect(caught(new EodhdError('bad token', 'auth_error', 401)).status).toBe(500);
    expect(caught(new EodhdError('plan', 'auth_error', 403)).status).toBe(502);
  });
});
