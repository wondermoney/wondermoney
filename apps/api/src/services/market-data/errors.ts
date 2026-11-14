import type { MarketDataProviderId } from '@config/market-data-providers';
import { BadGatewayError, BadRequestError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError } from '@utils/errors';
import logger from '@utils/logger';

import { handleEodhdError } from './eodhd.service';

/** The ways a call to a free provider fails; EODHD's client reports the same codes. */
export type MarketDataErrorCode = 'auth_error' | 'client_error' | 'network_error' | 'not_found' | 'parse_error' | 'rate_limit' | 'server_error' | 'timeout';

/** A failed call to a provider other than EODHD (whose client throws `EodhdError`). */
export class MarketDataProviderError extends Error {
  constructor(
    readonly provider: MarketDataProviderId,
    readonly code: MarketDataErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'MarketDataProviderError';
  }
}

const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

/**
 * Turn a failed market-data call into the API error the client gets, as `handleEodhdError` does
 * for EODHD (which it still handles, unchanged). The provider's own message is logged, never sent.
 */
export function handleMarketDataError(error: unknown): never {
  if (!(error instanceof MarketDataProviderError)) return handleEodhdError(error);
  logger.error({ code: error.code, message: error.message, provider: error.provider, status: error.status }, 'Market-data provider request failed');
  switch (error.code) {
    case 'auth_error':
      // The free providers take no credentials of ours: a refusal is theirs, not a bad key.
      throw new BadGatewayError('Market data provider refused the request');
    case 'client_error':
      throw new BadRequestError('Market data request was rejected by the data provider');
    case 'network_error':
    case 'parse_error':
    case 'server_error':
      throw new BadGatewayError('Market data provider is temporarily unavailable');
    case 'not_found':
      throw new NotFoundError('Market data not found for this request');
    case 'rate_limit':
      throw new TooManyRequestsError('Market data provider rate limit reached', error.retryAfter ?? RATE_LIMIT_RETRY_AFTER_SECONDS);
    case 'timeout':
      throw new GatewayTimeoutError('Market data provider timed out');
    default:
      throw new InternalServerError('Unexpected error fetching market data');
  }
}
