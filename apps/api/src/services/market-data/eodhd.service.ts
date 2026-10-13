import { Eodhd, EodhdError } from '@wondermoney/shared';

import { BadGatewayError, BadRequestError, FeatureDisabledError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError } from '@utils/errors';
import logger from '@utils/logger';

let eodhdClient: Eodhd | undefined;

/**
 * Market data (ticker search, quotes, prices, splits) needs an EODHD key. Without one the
 * Financial Markets module and live portfolio pricing are off: requests get `feature_disabled`,
 * and the scheduled price jobs skip.
 */
export function isMarketDataEnabled(): boolean {
  return Boolean(process.env['EODHD_API_KEY']?.trim());
}

function getEodhdClient(): Eodhd {
  if (eodhdClient) return eodhdClient;
  const apiKey = process.env['EODHD_API_KEY']?.trim();
  if (!apiKey) {
    throw new FeatureDisabledError('Market data');
  }
  eodhdClient = new Eodhd({ apiKey });
  return eodhdClient;
}

const EODHD_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export function handleEodhdError(error: unknown): never {
  if (error instanceof EodhdError) {
    logger.error({ eodhdCode: error.code, eodhdStatus: error.status, message: error.message }, 'EODHD API request failed');

    if (error.status === 404) {
      throw new NotFoundError('Market data not found for this request');
    }
    if (error.code === 'rate_limit') {
      throw new TooManyRequestsError('Market data provider rate limit reached', error.retryAfter ?? EODHD_RATE_LIMIT_RETRY_AFTER_SECONDS);
    }
    if (error.code === 'auth_error') {
      if (error.status === 403) {
        throw new BadGatewayError('Market data provider does not serve this request on the current plan');
      }
      throw new InternalServerError('Market data provider credentials are invalid');
    }
    if (error.code === 'timeout') {
      throw new GatewayTimeoutError('Market data provider timed out');
    }
    if (error.code === 'network_error' || error.code === 'server_error' || error.code === 'parse_error') {
      throw new BadGatewayError('Market data provider is temporarily unavailable');
    }
    if (error.code === 'client_error') {
      throw new BadRequestError('Market data request was rejected by the data provider');
    }
    throw new InternalServerError('Unexpected error fetching market data');
  }
  if (error instanceof Error) throw error;
  throw new InternalServerError('Unexpected error fetching market data');
}

const eodhd = new Proxy({} as Eodhd, {
  get(_target, prop, receiver) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- ProxyHandler.get returns `any`; the real type is Eodhd's own.
    return Reflect.get(getEodhdClient(), prop, receiver);
  },
});

export default eodhd;
