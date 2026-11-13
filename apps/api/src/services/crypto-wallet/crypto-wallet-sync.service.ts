import type { EntityManager } from '@mikro-orm/postgresql';
import { Big } from 'big.js';

import { CryptoAddressSyncStatus, CryptoWalletAddress } from '@entity/CryptoWalletAddress';
import { CryptoWalletToken } from '@entity/CryptoWalletToken';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import logger from '@utils/logger';

import { type ChainReaders, ExplorerError } from './explorers';
import type { TokenPrices } from './token-prices';
import { NATIVE_TOKEN_REF, tokenQuantity } from './wallet-parts';

/**
 * The crypto wallet sync: read every address's balances from its chain's explorer, then value
 * the wallet for the day.
 *
 * - Addresses are read one at a time, and each one's outcome is saved before the next: a failing
 *   address is marked `failed` with a reason and keeps its last balances; the others carry on.
 *   A chain whose explorer is no longer configured fails its addresses as `disabled`.
 * - A coin or token seen for the first time is recorded: the chain's own coin tracked, an ERC-20
 *   token untracked until the person ticks it. A token the explorer stops listing has a zero
 *   balance, and keeps its tick.
 * - The value is the sum, over tracked tokens with a balance, of quantity times the registry's
 *   USD price, rounded to the valuation's 4 decimals, stored as the day's `ManualAssetValuation`
 *   (one a day; a later sync the same day corrects it). The wallet is in USD, the currency the
 *   prices are in; a viewer reads it in their own currency at the household's rates.
 * - A tracked token with a balance and no price is flagged `priceMissing`, and the day's value is
 *   not written: a value silently missing a holding would understate the wallet. The last value
 *   stands until the token is priced or unticked. Nor is a value written before any address has
 *   been read at least once.
 *
 * This runs in the worker, outside any request, so the tenant filter is not armed: every query
 * names the wallet's own tenant.
 */
export interface WalletSyncDeps {
  now?: () => Date;
  prices: TokenPrices;
  readers: ChainReaders;
}

export interface WalletSyncResult {
  addresses: { failed: number; synced: number };
  /** The day's value in the wallet's currency, or null when none was written. */
  unpricedSymbols: string[];
  value: null | number;
}

const VALUE_SCALE = 4;

/** Sync one wallet. Null when the asset is not a live, unarchived crypto wallet. */
export async function syncCryptoWallet(em: EntityManager, manualAssetKey: number, deps: WalletSyncDeps): Promise<null | WalletSyncResult> {
  const now = deps.now?.() ?? new Date();
  const asset = await em.findOne(ManualAsset, { deletedAt: undefined, kind: ManualAssetKind.CRYPTO_WALLET, manualAssetKey }, { populate: ['currencyKey'] });
  if (!asset || asset.archivedAt) return null;
  const scope = { deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey };
  const addresses = await em.find(CryptoWalletAddress, scope, { orderBy: { cryptoWalletAddressKey: 'ASC' } });
  const tokens = await em.find(CryptoWalletToken, scope);

  const counts = { failed: 0, synced: 0 };
  for (const address of addresses) {
    const ok = await syncAddress(em, asset, address, tokens, deps.readers, now);
    counts[ok ? 'synced' : 'failed'] += 1;
  }

  const valued = await valueWallet(asset, addresses, tokens, deps.prices);
  if (valued.value !== null) upsertValuation(em, asset, await em.find(ManualAssetValuation, scope), valued.value, now);
  await em.flush();
  return { addresses: counts, ...valued };
}

/** The daily run: every live wallet on the server, each in its own unit of work so one cannot spoil another. */
export async function syncAllCryptoWallets(em: EntityManager, deps: WalletSyncDeps): Promise<{ failedAddresses: number; failedWallets: number; wallets: number }> {
  const wallets = await em.find(ManualAsset, { archivedAt: null, deletedAt: undefined, kind: ManualAssetKind.CRYPTO_WALLET }, { fields: ['manualAssetKey'], orderBy: { manualAssetKey: 'ASC' } });
  const summary = { failedAddresses: 0, failedWallets: 0, wallets: 0 };
  for (const { manualAssetKey } of wallets) {
    try {
      const result = await syncCryptoWallet(em.fork(), manualAssetKey, deps);
      if (!result) continue;
      summary.wallets += 1;
      summary.failedAddresses += result.addresses.failed;
    } catch (error) {
      summary.failedWallets += 1;
      logger.error({ error, manualAssetKey }, 'Crypto wallet sync failed');
    }
  }
  return summary;
}

function markFailed(address: CryptoWalletAddress, code: string): void {
  address.syncStatus = CryptoAddressSyncStatus.FAILED;
  address.lastErrorCode = code;
}

async function syncAddress(em: EntityManager, asset: ManualAsset, address: CryptoWalletAddress, tokens: CryptoWalletToken[], readers: ChainReaders, now: Date): Promise<boolean> {
  address.lastAttemptAt = now;
  const reader = readers[address.chain];
  if (!reader) {
    markFailed(address, 'disabled');
    await em.flush();
    return false;
  }
  try {
    const balances = await reader.read({ address: address.address, kind: address.addressKind });
    const mine = tokens.filter((token) => token.cryptoWalletAddressKey.cryptoWalletAddressKey === address.cryptoWalletAddressKey);
    const seen = new Set<string>();
    for (const balance of balances) {
      const tokenRef = balance.contractAddress ?? NATIVE_TOKEN_REF;
      if (seen.has(tokenRef)) continue;
      seen.add(tokenRef);
      let token = mine.find((existing) => existing.tokenRef === tokenRef);
      if (!token) {
        token = new CryptoWalletToken();
        token.cryptoWalletAddressKey = address;
        token.manualAssetKey = asset;
        token.tenantKey = asset.tenantKey;
        token.tokenRef = tokenRef;
        // The chain's own coin counts from the start; a detected token waits for a tick.
        token.tracked = tokenRef === NATIVE_TOKEN_REF;
        em.persist(token);
        tokens.push(token);
      }
      token.decimals = balance.decimals;
      token.name = balance.name;
      token.rawBalance = balance.rawBalance;
      token.symbol = balance.symbol;
    }
    for (const token of mine) if (!seen.has(token.tokenRef)) token.rawBalance = '0';
    address.syncStatus = CryptoAddressSyncStatus.OK;
    address.lastErrorCode = null;
    address.lastSyncedAt = now;
    await em.flush();
    return true;
  } catch (error) {
    const code = error instanceof ExplorerError ? error.code : 'unavailable';
    // The address is public but still the household's: the log names it by key only.
    logger.warn({ chain: address.chain, code, cryptoWalletAddressKey: address.cryptoWalletAddressKey, manualAssetKey: asset.manualAssetKey }, 'Crypto wallet address could not be read');
    markFailed(address, code);
    await em.flush();
    return false;
  }
}

function upsertValuation(em: EntityManager, asset: ManualAsset, valuations: ManualAssetValuation[], value: number, now: Date): void {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = valuations.find((valuation) => new Date(valuation.valuationDate).toISOString().slice(0, 10) === day.toISOString().slice(0, 10));
  if (today) {
    today.value = value;
    return;
  }
  const valuation = new ManualAssetValuation();
  valuation.manualAssetKey = asset;
  valuation.note = null;
  valuation.tenantKey = asset.tenantKey;
  valuation.valuationDate = day;
  valuation.value = value;
  em.persist(valuation);
}

async function valueWallet(asset: ManualAsset, addresses: CryptoWalletAddress[], tokens: CryptoWalletToken[], prices: TokenPrices): Promise<Omit<WalletSyncResult, 'addresses'>> {
  const live = new Set(addresses.map((address) => address.cryptoWalletAddressKey));
  const counted = tokens.filter((token) => live.has(token.cryptoWalletAddressKey.cryptoWalletAddressKey) && token.tracked && new Big(token.rawBalance).gt(0));
  for (const token of tokens) if (!counted.includes(token)) token.priceMissing = false;

  let total = new Big(0);
  const unpriced = new Set<string>();
  for (const token of counted) {
    const price = await prices.usd(token.symbol);
    token.priceMissing = price === null;
    if (price === null) unpriced.add(token.symbol);
    else total = total.plus(new Big(tokenQuantity(token.rawBalance, token.decimals)).times(price));
  }
  const unpricedSymbols = [...unpriced].sort();
  const everRead = addresses.some((address) => address.lastSyncedAt);
  if (!everRead || unpricedSymbols.length > 0) return { unpricedSymbols, value: null };
  if (asset.currencyKey.code !== 'USD') {
    // Wallets are created in USD; anything else would need a conversion the sync does not make.
    logger.error({ currency: asset.currencyKey.code, manualAssetKey: asset.manualAssetKey }, 'Crypto wallet is not in USD; not valued');
    return { unpricedSymbols, value: null };
  }
  return { unpricedSymbols, value: Number(total.round(VALUE_SCALE).toFixed(VALUE_SCALE)) };
}
