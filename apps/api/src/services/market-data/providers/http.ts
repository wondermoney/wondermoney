import type { MarketDataProviderId } from '@config/market-data-providers';

import { MarketDataProviderError } from '../errors';

/** A stalled socket must not hold a price-refresh slot forever. */
const FETCH_TIMEOUT_MS = 15_000;

/** GET a provider URL and parse its JSON body; see `getText`. */
export async function getJson(provider: MarketDataProviderId, url: string): Promise<unknown> {
  const body = await getText(provider, url, 'application/json');
  try {
    return JSON.parse(body);
  } catch {
    throw new MarketDataProviderError(provider, 'parse_error', 'Response is not JSON');
  }
}

/**
 * GET a provider URL and return the body, or throw a `MarketDataProviderError` that says how it
 * failed. The request carries nothing about the person asking: only the symbol in the URL.
 */
export async function getText(provider: MarketDataProviderId, url: string, accept: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: accept, 'User-Agent': 'WonderMoney (self-hosted personal finance)' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new MarketDataProviderError(provider, 'timeout', 'Request timed out');
    throw new MarketDataProviderError(provider, 'network_error', error instanceof Error ? error.message : 'Network error');
  }
  if (!response.ok) throw statusError(provider, response);
  try {
    return await response.text();
  } catch (error) {
    throw new MarketDataProviderError(provider, 'network_error', error instanceof Error ? error.message : 'Could not read the response');
  }
}

function retryAfterSeconds(header: null | string): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function statusError(provider: MarketDataProviderId, response: Response): MarketDataProviderError {
  const { status } = response;
  const message = `HTTP ${status}`;
  if (status === 404) return new MarketDataProviderError(provider, 'not_found', message, status);
  if (status === 429) return new MarketDataProviderError(provider, 'rate_limit', message, status, retryAfterSeconds(response.headers.get('retry-after')));
  if (status === 401 || status === 403) return new MarketDataProviderError(provider, 'auth_error', message, status);
  if (status >= 500) return new MarketDataProviderError(provider, 'server_error', message, status);
  return new MarketDataProviderError(provider, 'client_error', message, status);
}

/** `YYYY-MM-DD` of a Unix-millisecond instant, in UTC. */
export const utcDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

/** Unix seconds at 00:00 UTC of a `YYYY-MM-DD` day. */
export const dayStartSeconds = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
