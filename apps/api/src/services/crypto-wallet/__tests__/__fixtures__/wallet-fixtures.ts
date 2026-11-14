import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

import { base58check } from '../../address';

/**
 * Synthetic wallet values for tests. The addresses and extended keys are published test vectors
 * (BIP-13, BIP-49, BIP-84, BIP-86, EIP-55 and the BIP-39 "abandon … about" phrase). None of them
 * holds coins, and no test sends them anywhere: every explorer answer below is recorded by hand
 * and served from a stubbed `fetch`.
 */
export const BTC = {
  legacy: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  p2sh: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  segwit: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  taproot: 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
  // m/44'/0'/0', m/49'/0'/0' and m/84'/0'/0' of the BIP-39 test phrase, and the first receive
  // (0/0) and change (1/0) address of each.
  xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
  xpubChange0: '1J3J6EvPrv8q6AC3VCjWV45Uf3nssNMRtH',
  xpubReceive0: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
  ypub: 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP',
  ypubReceive0: '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
  zpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
  zpubChange0: 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el',
  zpubReceive0: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
} as const;

export const ETH = {
  airdrop: '0x00000000000000000000000000000000000a1d20',
  checksummed: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  other: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const;

export const BIP39_TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/*
 * Secrets in the shapes wallets export, derived here from fixed synthetic inputs rather than
 * written out: a raw key, its WIF forms, and the extended private key of the test phrase.
 */
const KEY = sha256(new TextEncoder().encode('wondermoney synthetic test key'));
const XPRV = HDKey.fromMasterSeed(mnemonicToSeedSync(BIP39_TEST_PHRASE)).privateExtendedKey;

export const SECRETS: Readonly<Record<string, string>> = {
  'a 0x hex private key': `0x${bytesToHex(KEY)}`,
  'a compressed WIF private key': base58check.encode(Uint8Array.from([0x80, ...KEY, 0x01])),
  'an extended private key': XPRV,
  'a raw hex private key': bytesToHex(KEY),
  'a recovery phrase': BIP39_TEST_PHRASE,
  'a recovery phrase on several lines': `\n${BIP39_TEST_PHRASE.split(' ').join('\n')}\n`,
  'a WIF private key': base58check.encode(Uint8Array.from([0x80, ...KEY])),
  'a zprv': `z${XPRV.slice(1)}`,
};

/** An Esplora `/address/:address` answer: `funded - spent` confirmed sats, and how many transactions touched it. */
export function esploraAddress(address: string, stats: { funded?: number; spent?: number; txs?: number } = {}) {
  const txs = stats.txs ?? (stats.funded ? 1 : 0);
  return {
    address,
    chain_stats: { funded_txo_count: txs, funded_txo_sum: stats.funded ?? 0, spent_txo_count: 0, spent_txo_sum: stats.spent ?? 0, tx_count: txs },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
  };
}

/** A Blockscout `/api/v2/addresses/:address` answer: the native balance in wei. */
export function blockscoutAddress(address: string, wei: string) {
  return { coin_balance: wei, hash: address, is_contract: false };
}

/** A Blockscout `/api/v2/addresses/:address/token-balances` entry. */
export interface FakeRoute {
  /** Answered in order; the last one repeats. */
  responses: (Error | { body?: unknown; headers?: Record<string, string>; status?: number })[];
}

export function blockscoutToken(contract: string, token: { decimals: string; name: string; symbol: string; type?: string; value: string }) {
  return {
    token: { address_hash: contract, decimals: token.decimals, name: token.name, symbol: token.symbol, type: token.type ?? 'ERC-20' },
    token_id: null,
    value: token.value,
  };
}

/**
 * A `fetch` stand-in serving recorded answers by exact URL. Any other URL is a 404, as an
 * explorer answers for nothing it knows. `calls` lists every URL asked, in order.
 */
export function fakeExplorerFetch(routes: Record<string, FakeRoute['responses'] | FakeRoute['responses'][number]>) {
  const calls: string[] = [];
  const served = new Map<string, number>();
  const fetch = (input: Request | string | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const route = routes[url];
    const list = route === undefined ? [{ status: 404 }] : Array.isArray(route) ? route : [route];
    const index = Math.min(served.get(url) ?? 0, list.length - 1);
    served.set(url, index + 1);
    const answer = list[index] ?? { status: 404 };
    if (answer instanceof Error) return Promise.reject(answer);
    const status = answer.status ?? 200;
    return Promise.resolve(new Response(status === 200 ? JSON.stringify(answer.body ?? null) : 'error', { headers: { 'content-type': 'application/json', ...answer.headers }, status }));
  };
  return { calls, fetch };
}
