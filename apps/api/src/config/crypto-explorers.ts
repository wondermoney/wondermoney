/**
 * The block explorers crypto wallets read balances from (`services/crypto-wallet/`), one per
 * chain, each an operator's explicit choice:
 *
 * - `CRYPTO_BTC_EXPLORER_URL`: the REST root of a mempool.space / Esplora compatible API
 *   (`https://mempool.example.org/api`; the server asks `<url>/address/<address>`).
 * - `CRYPTO_ETH_EXPLORER_URL`: the root of a Blockscout instance (`https://blockscout.example.org`;
 *   the server asks `<url>/api/v2/addresses/<address>`).
 *
 * No explorer is configured by default, so nothing is ever sent anywhere until an operator sets
 * one: the explorer sees every address it is asked about. A chain without its URL is off, and with
 * neither the feature is. Both are validated at boot (`configuration.ts`): https only, no
 * credentials, query or fragment.
 */
export const CRYPTO_CHAINS = ['bitcoin', 'ethereum'] as const;

export type CryptoChain = (typeof CRYPTO_CHAINS)[number];

export const CRYPTO_EXPLORER_ENV: Readonly<Record<CryptoChain, string>> = {
  bitcoin: 'CRYPTO_BTC_EXPLORER_URL',
  ethereum: 'CRYPTO_ETH_EXPLORER_URL',
};

/** Whether `value` is an explorer base URL this server accepts: https, a host, and nothing secret or ambiguous. */
export function isCryptoExplorerUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname.length > 0 && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && !value.includes('?') && !value.includes('#');
}

/** The configured base URL for a chain, without a trailing slash, or null when the chain is off. */
export function cryptoExplorerUrl(chain: CryptoChain, env: NodeJS.ProcessEnv = process.env): null | string {
  const raw = env[CRYPTO_EXPLORER_ENV[chain]]?.trim();
  if (!raw || !isCryptoExplorerUrl(raw)) return null;
  return raw.replace(/\/+$/u, '');
}

/** The chains whose explorer this server has, in a fixed order. Empty: crypto wallets are off. */
export function enabledCryptoChains(env: NodeJS.ProcessEnv = process.env): CryptoChain[] {
  return CRYPTO_CHAINS.filter((chain) => cryptoExplorerUrl(chain, env) !== null);
}
