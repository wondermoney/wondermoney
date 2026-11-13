import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { cryptoWalletPartTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { CryptoWalletAddress } from './CryptoWalletAddress';
import { ManualAsset } from './ManualAsset';
import { Tenant } from './Tenant';

/**
 * A coin or token one wallet address holds, as the explorer last reported it. The chain's own
 * coin (BTC, ETH) is tracked from the start; a detected ERC-20 token is not until the person ticks
 * it, because wallets fill up with airdropped spam. Only tracked tokens count towards the value.
 */
@Entity()
@Filter({ args: false, cond: cryptoWalletPartTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'crypto_wallet_token_manual_asset_key_idx', properties: ['manualAssetKey'] })
@Unique({ name: 'crypto_wallet_token_address_ref_unique', properties: ['cryptoWalletAddressKey', 'tokenRef'] })
export class CryptoWalletToken extends Base {
  @ManyToOne({ cascade: [], entity: () => CryptoWalletAddress, fieldName: 'crypto_wallet_address_key' })
  cryptoWalletAddressKey!: Rel<CryptoWalletAddress>;

  @PrimaryKey()
  cryptoWalletTokenKey!: number;

  @Property()
  decimals!: number;

  @ManyToOne({ cascade: [], entity: () => ManualAsset, fieldName: 'manual_asset_key' })
  manualAssetKey!: Rel<ManualAsset>;

  @Property({ length: 255, nullable: true })
  name?: null | string;

  /** Tracked, with a balance, and no price at the last sync: today's value was not written. */
  @Property({ default: false })
  priceMissing = false;

  /** The balance in the token's smallest unit (sats, wei): a non-negative integer. */
  @Property({ columnType: 'numeric(78, 0)', type: 'string' })
  rawBalance = '0';

  @Property({ length: 32 })
  symbol!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  /** `native` for the chain's own coin, else the ERC-20 contract address, lower-case. */
  @Property({ length: 64 })
  tokenRef!: string;

  @Property({ default: false })
  tracked = false;
}
