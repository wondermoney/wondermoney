import { type CryptoChain, cryptoExplorerUrl } from '@config/crypto-explorers';

import { type AddressKind, classifyWalletInput } from './address';
import { type XpubChain, xpubDeriver } from './xpub';

/**
 * Reading balances from the operator's block explorers: a mempool.space / Esplora compatible API
 * for Bitcoin and a Blockscout instance for Ethereum (`config/crypto-explorers.ts`).
 *
 * Every request carries one public address and nothing else about the household. Requests to
 * one explorer go one at a time, at least `minIntervalMs` apart, each with a timeout. A timeout,
 * a network failure, a 5xx or a 429 is retried up to `maxAttempts` in all, waiting `backoffMs`
 * doubling, or what a 429's `Retry-After` asks when that is at most `maxRetryAfterSeconds` (a
 * longer wait gives up as `rate_limited`, for the next run). Errors carry a code, never the URL:
 * the URL holds the address.
 */
export type ExplorerErrorCode = 'invalid_response' | 'rate_limited' | 'rejected' | 'timeout' | 'unavailable';

export interface ExplorerHttpOptions {
  backoffMs?: number;
  fetch?: typeof fetch;
  maxAttempts?: number;
  maxRetryAfterSeconds?: number;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class ExplorerError extends Error {
  constructor(readonly code: ExplorerErrorCode, message: string) {
    super(message);
    this.name = 'ExplorerError';
  }
}

/** One coin or token an address holds, in its smallest unit. */
export interface ChainReader {
  read(entry: { address: string; kind: AddressKind }): Promise<ReadBalance[]>;
}

export type ChainReaders = Partial<Record<CryptoChain, ChainReader>>;

export interface ReadBalance {
  /** The ERC-20 contract, lower-case; null for the chain's own coin. */
  contractAddress: null | string;
  decimals: number;
  name: null | string;
  /** A non-negative integer in the token's smallest unit (sats, wei), as a string. */
  rawBalance: string;
  symbol: string;
}

/** BIP-44's gap limit: an account's addresses end after 20 unused ones in a row. */
export const XPUB_GAP_LIMIT = 20;
/** A bound on one xpub's scan per chain, so a malformed answer cannot loop forever. */
const XPUB_MAX_ADDRESSES = 1000;

const DEFAULTS = { backoffMs: 1000, maxAttempts: 3, maxRetryAfterSeconds: 30, minIntervalMs: 250, timeoutMs: 15_000 };

interface ExplorerHttp {
  /** GET a JSON body; null for a 404, which an explorer answers for an address it never saw. */
  getJson(url: string): Promise<unknown>;
}

export function createExplorerHttp(options: ExplorerHttpOptions = {}): ExplorerHttp {
  const settings = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  const throttle = async () => {
    const wait = lastRequestAt + settings.minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  };

  const once = async (url: string): Promise<{ body?: unknown; error?: ExplorerError; retryable: boolean; retryAfterSeconds?: number; }> => {
    await throttle();
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'WonderMoney (self-hosted personal finance)' }, signal: AbortSignal.timeout(settings.timeoutMs) });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      return { error: new ExplorerError(timedOut ? 'timeout' : 'unavailable', timedOut ? 'Explorer request timed out' : 'Explorer could not be reached'), retryable: true };
    }
    if (response.status === 404) return { body: null, retryable: false };
    if (response.status === 429) {
      return { error: new ExplorerError('rate_limited', 'Explorer rate limit reached'), retryable: true, retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after'), now()) };
    }
    if (response.status >= 500) return { error: new ExplorerError('unavailable', `Explorer answered HTTP ${response.status}`), retryable: true };
    if (!response.ok) return { error: new ExplorerError('rejected', `Explorer answered HTTP ${response.status}`), retryable: false };
    try {
      return { body: JSON.parse(await response.text()), retryable: false };
    } catch {
      return { error: new ExplorerError('invalid_response', 'Explorer answer is not JSON'), retryable: false };
    }
  };

  return {
    async getJson(url) {
      for (let attempt = 1; ; attempt += 1) {
        const result = await once(url);
        if (!result.error) return result.body;
        if (!result.retryable || attempt >= settings.maxAttempts) throw result.error;
        const asked = result.retryAfterSeconds;
        if (asked !== undefined && asked > settings.maxRetryAfterSeconds) throw result.error;
        await sleep(asked === undefined ? settings.backoffMs * 2 ** (attempt - 1) : asked * 1000);
      }
    },
  };
}

/** Readers for the chains this server has an explorer for (all of them share `options`, each its own throttle). */
export function chainReadersFromEnv(options: ExplorerHttpOptions = {}, env: NodeJS.ProcessEnv = process.env): ChainReaders {
  const readers: ChainReaders = {};
  const bitcoin = cryptoExplorerUrl('bitcoin', env);
  const ethereum = cryptoExplorerUrl('ethereum', env);
  if (bitcoin) readers.bitcoin = createBitcoinReader(bitcoin, createExplorerHttp(options));
  if (ethereum) readers.ethereum = createEthereumReader(ethereum, createExplorerHttp(options));
  return readers;
}

/** Bitcoin through an Esplora API: confirmed balance of an address, or of every used address of an xpub. */
export function createBitcoinReader(baseUrl: string, http: ExplorerHttp): ChainReader {
  const stats = async (address: string) => parseEsploraAddress(await http.getJson(`${baseUrl}/address/${encodeURIComponent(address)}`));

  const xpubBalance = async (xpub: string): Promise<bigint> => {
    const classified = classifyWalletInput('bitcoin', xpub);
    if (!classified.ok || classified.kind !== 'xpub') throw new ExplorerError('invalid_response', 'Not an extended public key');
    const deriver = xpubDeriver(xpub, classified.script);
    let total = 0n;
    for (const chain of [0, 1] as XpubChain[]) {
      let unused = 0;
      for (let index = 0; unused < XPUB_GAP_LIMIT && index < XPUB_MAX_ADDRESSES; index += 1) {
        const { balance, txCount } = await stats(deriver.address(chain, index));
        if (txCount === 0) unused += 1;
        else {
          unused = 0;
          total += balance;
        }
      }
    }
    return total;
  };

  return {
    async read({ address, kind }) {
      const balance = kind === 'xpub' ? await xpubBalance(address) : (await stats(address)).balance;
      return [{ contractAddress: null, decimals: 8, name: 'Bitcoin', rawBalance: balance.toString(), symbol: 'BTC' }];
    },
  };
}

/** Ethereum through Blockscout's v2 API: the ETH balance and every ERC-20 balance the explorer lists. */
export function createEthereumReader(baseUrl: string, http: ExplorerHttp): ChainReader {
  return {
    async read({ address }) {
      const path = `${baseUrl}/api/v2/addresses/${encodeURIComponent(address)}`;
      const native = parseBlockscoutCoinBalance(await http.getJson(path));
      const tokens = parseBlockscoutTokens(await http.getJson(`${path}/token-balances`));
      return [{ contractAddress: null, decimals: 18, name: 'Ether', rawBalance: native, symbol: 'ETH' }, ...tokens];
    },
  };
}

/** Confirmed sats (`funded - spent`) and how many transactions, confirmed or not, touched the address. */
export function parseBlockscoutCoinBalance(body: unknown): string {
  if (body === null) return '0';
  if (!isRecord(body)) throw new ExplorerError('invalid_response', 'Address answer is not an object');
  const balance = body['coin_balance'];
  if (balance === null || balance === undefined) return '0';
  if (typeof balance !== 'string' || !/^\d+$/u.test(balance)) throw new ExplorerError('invalid_response', 'Address answer has an unreadable balance');
  return normaliseInteger(balance);
}

export function parseEsploraAddress(body: unknown): { balance: bigint; txCount: number } {
  // An explorer that never saw the address answers 404: nothing there yet.
  if (body === null) return { balance: 0n, txCount: 0 };
  const chain = isRecord(body) ? body['chain_stats'] : undefined;
  const mempool = isRecord(body) ? body['mempool_stats'] : undefined;
  const whole = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
  if (!isRecord(chain)) throw new ExplorerError('invalid_response', 'Address answer has no chain stats');
  const funded = whole(chain['funded_txo_sum']);
  const spent = whole(chain['spent_txo_sum']);
  const txs = whole(chain['tx_count']);
  if (funded === null || spent === null || txs === null || spent > funded) throw new ExplorerError('invalid_response', 'Address answer has unreadable chain stats');
  const pending = isRecord(mempool) ? (whole(mempool['tx_count']) ?? 0) : 0;
  return { balance: BigInt(funded) - BigInt(spent), txCount: txs + pending };
}

/**
 * The ERC-20 balances of a token-balances answer. NFTs (ERC-721/1155) are not money and are
 * left out, as are entries the explorer could not describe (no contract, no decimals).
 */
export function parseBlockscoutTokens(body: unknown): ReadBalance[] {
  if (body === null) return [];
  if (!Array.isArray(body)) throw new ExplorerError('invalid_response', 'Token answer is not a list');
  return body.flatMap((entry): ReadBalance[] => {
    if (!isRecord(entry) || !isRecord(entry['token'])) return [];
    const token = entry['token'];
    if (token['type'] !== 'ERC-20' || (entry['token_id'] !== null && entry['token_id'] !== undefined)) return [];
    const contract = token['address_hash'] ?? token['address'];
    const decimals = Number(token['decimals']);
    const value = entry['value'];
    if (typeof contract !== 'string' || !/^0x[0-9a-fA-F]{40}$/u.test(contract)) return [];
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return [];
    if (typeof value !== 'string' || !/^\d+$/u.test(value)) return [];
    return [{
      contractAddress: contract.toLowerCase(),
      decimals,
      name: typeof token['name'] === 'string' ? cleanText(token['name'], 255) || null : null,
      rawBalance: normaliseInteger(value),
      symbol: (typeof token['symbol'] === 'string' ? cleanText(token['symbol'], 32) : '') || '?',
    }];
  });
}

function cleanText(value: string, max: number): string {
  // Token names are chosen by whoever deployed the contract: keep them printable and short.
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseInteger(value: string): string {
  return BigInt(value).toString();
}

function retryAfterSeconds(header: null | string, nowMs: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - nowMs) / 1000));
}
