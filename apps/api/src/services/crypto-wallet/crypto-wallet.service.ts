import type { EntityManager } from '@mikro-orm/postgresql';

import { enqueueCryptoWalletSyncJob } from '@app/jobs/crypto-wallet-sync.queue';
import { type CryptoChain, cryptoExplorerUrl, enabledCryptoChains } from '@config/crypto-explorers';
import { Appuser } from '@entity/Appuser';
import { CryptoWalletAddress } from '@entity/CryptoWalletAddress';
import { CryptoWalletToken } from '@entity/CryptoWalletToken';
import { Currency } from '@entity/Currency';
import { ManualAsset } from '@entity/ManualAsset';
import { Tenant } from '@entity/Tenant';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { type AssetViewer, getManualAsset, loadVisibleManualAssets, type ManualAssetDto } from '@service/manual-asset/manual-asset.service';
import type { Enqueue } from '@service/queue/enqueue';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, FeatureDisabledError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import { type AddressKind, classifyWalletInput } from './address';
import { type CryptoWalletDto, walletOf } from './wallet-parts';

/**
 * Crypto wallets: manual assets of kind `crypto_wallet` valued from public addresses
 * (`crypto-wallet-sync.service.ts` reads them). This module adds, edits and lists a wallet's
 * addresses and tokens.
 *
 * Tenancy and privacy are the wallet's: every call first loads the asset through
 * `loadVisibleManualAssets` (the household's shared assets and the viewer's own private ones), so
 * another household's or the other member's private wallet is a 404, and its addresses and tokens
 * are only ever looked up under it.
 *
 * Only public addresses are accepted (`address.ts`). A refused input is never stored, logged or
 * sent back: the error says what kind of thing it was, not what it was.
 *
 * A wallet is valued in US dollars, the currency crypto prices are quoted in; a viewer reads it in
 * their own currency at the household's rates, as any manual asset.
 */
export const CRYPTO_WALLET_CURRENCY = 'USD';
/** Addresses on one wallet, at most. */
export const MAX_WALLET_ADDRESSES = 20;

export interface CreateCryptoWalletInput {
  addresses: WalletAddressInput[];
  isPrivate?: boolean;
  name: string;
  notes?: null | string;
}

export interface WalletAddressInput {
  address: string;
  chain: CryptoChain;
  label?: null | string;
}

interface Deps {
  enqueue?: Enqueue;
}

const SECRET_MESSAGE = 'Only public addresses are accepted. That looked like a private key or a recovery phrase, so it was not saved.';

export async function addWalletAddress(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, input: WalletAddressInput, deps: Deps = {}): Promise<CryptoWalletDto> {
  const asset = await loadWalletOrThrow(em, viewer, manualAssetKey);
  const parsed = parseAddressOrThrow(input);
  const addresses = await liveAddresses(em, asset);
  if (addresses.length >= MAX_WALLET_ADDRESSES) throw new BadRequestError(`A wallet holds at most ${MAX_WALLET_ADDRESSES} addresses`);
  if (addresses.some((existing) => existing.chain === parsed.chain && existing.address === parsed.address)) {
    throw new ConflictError('That address is already on the wallet', ERROR_CODE.CRYPTO_WALLET_ADDRESS_EXISTS);
  }
  em.persist(newAddress(asset, parsed));
  await em.flush();
  await queueSync(asset.manualAssetKey, deps);
  return walletOf(em, asset);
}

export async function createCryptoWallet(em: EntityManager, viewer: AssetViewer, input: CreateCryptoWalletInput, deps: Deps = {}, now = new Date()): Promise<{ asset: ManualAssetDto; wallet: CryptoWalletDto }> {
  if (enabledCryptoChains().length === 0) throw new FeatureDisabledError('Crypto wallets');
  const parsed = input.addresses.map((address, index) => parseAddressOrThrow(address, index));
  const seen = new Set<string>();
  for (const [index, address] of parsed.entries()) {
    const key = `${address.chain}:${address.address}`;
    if (seen.has(key)) throw withAddressIndex(new ConflictError('That address is already on the wallet', ERROR_CODE.CRYPTO_WALLET_ADDRESS_EXISTS), index);
    seen.add(key);
  }

  const currency = await em.findOneOrFail(Currency, { code: CRYPTO_WALLET_CURRENCY });
  const owner = await em.findOneOrFail(Appuser, { appuserKey: viewer.appuserKey });
  const asset = new ManualAsset();
  asset.currencyKey = currency;
  asset.isPrivate = input.isPrivate ?? false;
  asset.kind = ManualAssetKind.CRYPTO_WALLET;
  asset.name = input.name;
  asset.notes = input.notes ?? null;
  asset.ownerAppuserKey = owner;
  asset.tenantKey = getRef(em, Tenant, viewer.tenantKey);
  em.persist(asset);
  for (const address of parsed) em.persist(newAddress(asset, address));
  await em.flush();

  await queueSync(asset.manualAssetKey, deps);
  const { asset: dto } = await getManualAsset(em, viewer, asset.manualAssetKey, now);
  return { asset: dto, wallet: await walletOf(em, asset) };
}

export async function removeWalletAddress(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, addressKey: number, deps: Deps = {}): Promise<CryptoWalletDto> {
  const asset = await loadWalletOrThrow(em, viewer, manualAssetKey);
  const address = await findAddressOrThrow(em, asset, addressKey);
  const deletedAt = new Date();
  address.deletedAt = deletedAt;
  for (const token of await em.find(CryptoWalletToken, { cryptoWalletAddressKey: address, deletedAt: undefined, tenantKey: asset.tenantKey })) token.deletedAt = deletedAt;
  await em.flush();
  // Today's value still counts the removed address until the sync values the wallet again.
  await queueSync(asset.manualAssetKey, deps);
  return walletOf(em, asset);
}

export async function requestWalletSync(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, deps: Deps = {}): Promise<void> {
  const asset = await loadWalletOrThrow(em, viewer, manualAssetKey);
  if (enabledCryptoChains().length === 0) throw new FeatureDisabledError('Crypto wallets');
  await queueSync(asset.manualAssetKey, deps);
}

export async function setWalletTokenTracked(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, tokenKey: number, tracked: boolean, deps: Deps = {}): Promise<CryptoWalletDto> {
  const asset = await loadWalletOrThrow(em, viewer, manualAssetKey);
  // Looked up under the wallet, so a token of another wallet or household is not found.
  const token = await em.findOne(CryptoWalletToken, { cryptoWalletTokenKey: tokenKey, deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey });
  if (!token) throw new NotFoundError('Token not found');
  if (token.tracked !== tracked) {
    token.tracked = tracked;
    if (!tracked) token.priceMissing = false;
    await em.flush();
    await queueSync(asset.manualAssetKey, deps);
  }
  return walletOf(em, asset);
}

export async function updateWalletAddress(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, addressKey: number, input: { label: null | string }): Promise<CryptoWalletDto> {
  const asset = await loadWalletOrThrow(em, viewer, manualAssetKey);
  const address = await findAddressOrThrow(em, asset, addressKey);
  address.label = input.label;
  await em.flush();
  return walletOf(em, asset);
}

/** A visible manual asset that is a crypto wallet, or the error saying why not. */
export async function loadWalletOrThrow(em: EntityManager, viewer: Pick<AssetViewer, 'appuserKey' | 'tenantKey'>, manualAssetKey: number): Promise<ManualAsset> {
  const [loaded] = await loadVisibleManualAssets(em, viewer, { manualAssetKey });
  if (!loaded) throw new NotFoundError('Asset not found');
  if (loaded.asset.kind !== ManualAssetKind.CRYPTO_WALLET) throw new BadRequestError('This asset is not a crypto wallet', ERROR_CODE.CRYPTO_WALLET_REQUIRED);
  return loaded.asset;
}

function findAddressOrThrow(em: EntityManager, asset: ManualAsset, addressKey: number): Promise<CryptoWalletAddress> {
  return em.findOne(CryptoWalletAddress, { cryptoWalletAddressKey: addressKey, deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey }).then((address) => {
    if (!address) throw new NotFoundError('Address not found');
    return address;
  });
}

function liveAddresses(em: EntityManager, asset: ManualAsset): Promise<CryptoWalletAddress[]> {
  return em.find(CryptoWalletAddress, { deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey }, { orderBy: { cryptoWalletAddressKey: 'ASC' } });
}

function newAddress(asset: ManualAsset, parsed: { address: string; chain: CryptoChain; kind: AddressKind; label: null | string }): CryptoWalletAddress {
  const address = new CryptoWalletAddress();
  address.address = parsed.address;
  address.addressKind = parsed.kind;
  address.chain = parsed.chain;
  address.label = parsed.label;
  address.manualAssetKey = asset;
  address.tenantKey = asset.tenantKey;
  return address;
}

/**
 * A public address for an enabled chain, normalised. A secret or an invalid address is refused
 * with a fixed message: the input itself is never in the error, the log or the response.
 */
function parseAddressOrThrow(input: WalletAddressInput, index?: number): { address: string; chain: CryptoChain; kind: AddressKind; label: null | string } {
  const classified = classifyWalletInput(input.chain, input.address);
  if (!classified.ok) {
    const error = classified.reason === 'secret'
      ? new BadRequestError(SECRET_MESSAGE, ERROR_CODE.CRYPTO_WALLET_SECRET_REJECTED)
      : new BadRequestError(input.chain === 'bitcoin' ? 'Not a valid Bitcoin address or extended public key (xpub, ypub, zpub)' : 'Not a valid Ethereum address', ERROR_CODE.CRYPTO_WALLET_ADDRESS_INVALID);
    throw withAddressIndex(error, index);
  }
  if (cryptoExplorerUrl(input.chain) === null) throw new FeatureDisabledError(input.chain === 'bitcoin' ? 'Bitcoin wallets' : 'Ethereum wallets');
  return { address: classified.address, chain: input.chain, kind: classified.kind, label: input.label?.trim() || null };
}

async function queueSync(manualAssetKey: number, deps: Deps): Promise<void> {
  if (!deps.enqueue) {
    logger.error({ manualAssetKey }, 'No queue to sync a crypto wallet; it syncs on the next daily run');
    return;
  }
  try {
    await enqueueCryptoWalletSyncJob({ manualAssetKey }, { enqueue: deps.enqueue });
  } catch (error) {
    // The change is saved; the daily run picks the wallet up.
    logger.error({ error, manualAssetKey }, 'Could not queue a crypto wallet sync');
  }
}

function withAddressIndex<T extends BadRequestError | ConflictError>(error: T, index: number | undefined): T {
  if (index !== undefined) error.details = { addressIndex: String(index) };
  return error;
}
