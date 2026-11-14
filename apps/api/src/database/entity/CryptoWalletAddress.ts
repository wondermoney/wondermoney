import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import type { CryptoChain } from '@config/crypto-explorers';
import type { AddressKind } from '@service/crypto-wallet/address';

import { cryptoWalletPartTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { ManualAsset } from './ManualAsset';
import { Tenant } from './Tenant';

export enum CryptoAddressSyncStatus {
  FAILED = 'failed',
  OK = 'ok',
  PENDING = 'pending',
}

/**
 * One public address (or Bitcoin extended public key) of a crypto wallet, a manual asset of kind
 * `crypto_wallet`. Only public values are ever stored: `services/crypto-wallet/address.ts` refuses
 * private keys and recovery phrases before anything reaches this table.
 *
 * The sync (`crypto-wallet-sync.service.ts`) records each address's outcome here, so one failing
 * address shows as failed while the others carry on.
 */
@Entity()
@Filter({ args: false, cond: cryptoWalletPartTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'crypto_wallet_address_manual_asset_key_idx', properties: ['manualAssetKey'] })
@Index({
  expression: 'CREATE UNIQUE INDEX crypto_wallet_address_asset_chain_address_unique ON crypto_wallet_address (manual_asset_key, chain, address) WHERE deleted_at IS NULL',
  name: 'crypto_wallet_address_asset_chain_address_unique',
})
export class CryptoWalletAddress extends Base {
  /** Normalised: bech32 lower-case, Ethereum EIP-55 checksummed, an xpub as given. */
  @Property({ length: 200 })
  address!: string;

  @Enum({ items: ['address', 'xpub'] })
  addressKind!: AddressKind;

  @Enum({ items: ['bitcoin', 'ethereum'] })
  chain!: CryptoChain;

  @PrimaryKey()
  cryptoWalletAddressKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastAttemptAt?: Date | null;

  /** Why the last attempt failed (`ExplorerErrorCode` or `disabled`); null unless `syncStatus` is failed. */
  @Property({ length: 40, nullable: true })
  lastErrorCode?: null | string;

  /** The last successful read: the tokens' balances are as of then. */
  @Property({ length: 100, nullable: true })
  label?: null | string;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastSyncedAt?: Date | null;

  @ManyToOne({ cascade: [], entity: () => ManualAsset, fieldName: 'manual_asset_key' })
  manualAssetKey!: Rel<ManualAsset>;

  @Enum({ default: CryptoAddressSyncStatus.PENDING, items: () => CryptoAddressSyncStatus })
  syncStatus: CryptoAddressSyncStatus = CryptoAddressSyncStatus.PENDING;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
