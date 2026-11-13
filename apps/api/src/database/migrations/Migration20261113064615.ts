import { Migration } from '@mikro-orm/migrations';

/**
 * Crypto wallets (#77): `crypto_wallet_address` (a wallet's public addresses and each one's last
 * sync) and `crypto_wallet_token` (the coins and tokens an address holds, and whether they count),
 * and `crypto_wallet` as a manual asset kind. Additive: the kind check only widens.
 */

export class Migration20261113064615 extends Migration {

  override name = 'Migration20261113064615';

  override up(): void | Promise<void> {
    this.addSql(`create table "crypto_wallet_address" ("crypto_wallet_address_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "address" varchar(200) not null, "address_kind" text not null, "chain" text not null, "last_attempt_at" timestamptz null, "last_error_code" varchar(40) null, "label" varchar(100) null, "last_synced_at" timestamptz null, "manual_asset_key" int not null, "sync_status" text not null default 'pending', "tenant_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX crypto_wallet_address_asset_chain_address_unique ON crypto_wallet_address (manual_asset_key, chain, address) WHERE deleted_at IS NULL;`);
    this.addSql(`create index "crypto_wallet_address_manual_asset_key_idx" on "crypto_wallet_address" ("manual_asset_key");`);

    this.addSql(`create table "crypto_wallet_token" ("crypto_wallet_token_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "crypto_wallet_address_key" int not null, "decimals" int not null, "manual_asset_key" int not null, "name" varchar(255) null, "price_missing" boolean not null default false, "raw_balance" numeric(78, 0) not null default '0', "symbol" varchar(32) not null, "tenant_key" int not null, "token_ref" varchar(64) not null, "tracked" boolean not null default false);`);
    this.addSql(`create index "crypto_wallet_token_manual_asset_key_idx" on "crypto_wallet_token" ("manual_asset_key");`);
    this.addSql(`alter table "crypto_wallet_token" add constraint "crypto_wallet_token_address_ref_unique" unique ("crypto_wallet_address_key", "token_ref");`);

    this.addSql(`alter table "manual_asset" drop constraint "manual_asset_kind_check";`);
    this.addSql(`alter table "manual_asset" add constraint "manual_asset_kind_check" check ("kind" in ('crypto_wallet', 'other', 'property', 'valuable', 'vehicle'));`);

    this.addSql(`alter table "crypto_wallet_address" add constraint "crypto_wallet_address_manual_asset_key_foreign" foreign key ("manual_asset_key") references "manual_asset" ("manual_asset_key");`);
    this.addSql(`alter table "crypto_wallet_address" add constraint "crypto_wallet_address_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "crypto_wallet_address" add constraint "crypto_wallet_address_address_kind_check" check ("address_kind" in ('address', 'xpub'));`);
    this.addSql(`alter table "crypto_wallet_address" add constraint "crypto_wallet_address_chain_check" check ("chain" in ('bitcoin', 'ethereum'));`);
    this.addSql(`alter table "crypto_wallet_address" add constraint "crypto_wallet_address_sync_status_check" check ("sync_status" in ('failed', 'ok', 'pending'));`);

    this.addSql(`alter table "crypto_wallet_token" add constraint "crypto_wallet_token_crypto_wallet_address_key_foreign" foreign key ("crypto_wallet_address_key") references "crypto_wallet_address" ("crypto_wallet_address_key");`);
    this.addSql(`alter table "crypto_wallet_token" add constraint "crypto_wallet_token_manual_asset_key_foreign" foreign key ("manual_asset_key") references "manual_asset" ("manual_asset_key");`);
    this.addSql(`alter table "crypto_wallet_token" add constraint "crypto_wallet_token_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "crypto_wallet_token" drop constraint "crypto_wallet_token_crypto_wallet_address_key_foreign";`);

    this.addSql(`drop table if exists "crypto_wallet_address" cascade;`);
    this.addSql(`drop table if exists "crypto_wallet_token" cascade;`);

    this.addSql(`alter table "manual_asset" drop constraint "manual_asset_kind_check";`);
    this.addSql(`alter table "manual_asset" add constraint "manual_asset_kind_check" check ("kind" in ('other', 'property', 'valuable', 'vehicle'));`);
  }

}
