import type { EntityManager } from '@mikro-orm/postgresql';
import { Big } from 'big.js';

import type { CryptoChain } from '@config/crypto-explorers';
import { CryptoAddressSyncStatus, CryptoWalletAddress } from '@entity/CryptoWalletAddress';
import { CryptoWalletToken } from '@entity/CryptoWalletToken';
import type { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';

import type { AddressKind } from './address';

/**
 * A crypto wallet's addresses and tokens as the clients see them, and what deleting the wallet
 * does to them. Kept apart from `crypto-wallet.service.ts` so the manual-asset service can use it
 * without the two importing each other. Callers pass an asset already scoped to the viewer.
 */
export const NATIVE_TOKEN_REF = 'native';

export interface CryptoWalletAddressDto {
  address: string;
  chain: CryptoChain;
  cryptoWalletAddressKey: number;
  errorCode: null | string;
  kind: AddressKind;
  label: null | string;
  lastAttemptAt: null | string;
  lastSyncedAt: null | string;
  status: CryptoAddressSyncStatus;
  tokens: CryptoWalletTokenDto[];
}

export interface CryptoWalletDto {
  addresses: CryptoWalletAddressDto[];
  lastSyncedAt: null | string;
  /** Ticked tokens with a balance and no price at the last sync: today's value was not updated. */
  unpricedSymbols: string[];
}

export interface CryptoWalletTokenDto {
  contractAddress: null | string;
  cryptoWalletTokenKey: number;
  name: null | string;
  native: boolean;
  priceMissing: boolean;
  /** Exact, as a decimal string. */
  quantity: string;
  symbol: string;
  tracked: boolean;
}

/** The wallet of an asset the caller has already scoped to the viewer. */
export async function walletOf(em: EntityManager, asset: ManualAsset): Promise<CryptoWalletDto> {
  const addresses = await em.find(CryptoWalletAddress, { deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey }, { orderBy: { cryptoWalletAddressKey: 'ASC' } });
  const tokens = addresses.length === 0 ? [] : await em.find(CryptoWalletToken, { cryptoWalletAddressKey: { $in: addresses }, deletedAt: undefined, tenantKey: asset.tenantKey });
  const byAddress = new Map<number, CryptoWalletToken[]>();
  for (const token of tokens) {
    const key = token.cryptoWalletAddressKey.cryptoWalletAddressKey;
    byAddress.set(key, [...(byAddress.get(key) ?? []), token]);
  }
  const synced = addresses.flatMap((address) => (address.lastSyncedAt ? [new Date(address.lastSyncedAt).getTime()] : []));
  return {
    addresses: addresses.map((address) => toAddressDto(address, byAddress.get(address.cryptoWalletAddressKey) ?? [])),
    lastSyncedAt: synced.length === 0 ? null : new Date(Math.max(...synced)).toISOString(),
    unpricedSymbols: [...new Set(tokens.filter((token) => token.priceMissing).map((token) => token.symbol))].sort(),
  };
}

/** Soft-deletes a wallet's addresses and tokens with the wallet. */
export async function markWalletPartsDeleted(em: EntityManager, asset: ManualAsset, deletedAt: Date): Promise<void> {
  if (asset.kind !== ManualAssetKind.CRYPTO_WALLET) return;
  const where = { deletedAt: undefined, manualAssetKey: asset, tenantKey: asset.tenantKey };
  for (const address of await em.find(CryptoWalletAddress, where)) address.deletedAt = deletedAt;
  for (const token of await em.find(CryptoWalletToken, where)) token.deletedAt = deletedAt;
}

/** `rawBalance` in whole units, exact, without trailing zeros. */
export function tokenQuantity(rawBalance: string, decimals: number): string {
  return new Big(rawBalance).div(new Big(10).pow(decimals)).toFixed();
}

function toAddressDto(address: CryptoWalletAddress, tokens: CryptoWalletToken[]): CryptoWalletAddressDto {
  const iso = (value?: Date | null) => (value ? new Date(value).toISOString() : null);
  return {
    address: address.address,
    chain: address.chain,
    cryptoWalletAddressKey: address.cryptoWalletAddressKey,
    errorCode: address.syncStatus === CryptoAddressSyncStatus.FAILED ? (address.lastErrorCode ?? 'unavailable') : null,
    kind: address.addressKind,
    label: address.label ?? null,
    lastAttemptAt: iso(address.lastAttemptAt),
    lastSyncedAt: iso(address.lastSyncedAt),
    status: address.syncStatus,
    tokens: tokens
      .map((token) => ({
        contractAddress: token.tokenRef === NATIVE_TOKEN_REF ? null : token.tokenRef,
        cryptoWalletTokenKey: token.cryptoWalletTokenKey,
        name: token.name ?? null,
        native: token.tokenRef === NATIVE_TOKEN_REF,
        priceMissing: token.priceMissing,
        quantity: tokenQuantity(token.rawBalance, token.decimals),
        symbol: token.symbol,
        tracked: token.tracked,
      }))
      .sort((a, b) => Number(b.native) - Number(a.native) || a.symbol.localeCompare(b.symbol) || a.cryptoWalletTokenKey - b.cryptoWalletTokenKey),
  };
}
