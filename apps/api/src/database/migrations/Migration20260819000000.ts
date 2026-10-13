import { Migration } from '@mikro-orm/migrations';

export class Migration20260819000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "campaign_claim" ("campaign_claim_key" serial primary key, "campaign_id" varchar(80) not null, "subscription_key" int null, "appuser_key" int not null, "tenant_key" int not null, "token_hash" varchar(128) not null, "expires_at" timestamptz not null, "status" varchar(32) not null default 'claimed', "stripe_applied_at" timestamptz null, "stripe_idempotency_key" varchar(255) null, "email_sent_at" timestamptz null, "email_provider_message_id" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`);
    this.addSql('alter table "campaign_claim" add constraint "campaign_claim_subscription_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key") on delete cascade;');
    this.addSql('alter table "campaign_claim" add constraint "campaign_claim_appuser_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;');
    this.addSql('alter table "campaign_claim" add constraint "campaign_claim_tenant_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete cascade;');
    this.addSql('create unique index "campaign_claim_campaign_appuser_unique" on "campaign_claim" ("campaign_id", "appuser_key");');
    this.addSql('create unique index "campaign_claim_campaign_subscription_unique" on "campaign_claim" ("campaign_id", "subscription_key") where "subscription_key" is not null;');
    this.addSql('create unique index "campaign_claim_token_hash_unique" on "campaign_claim" ("token_hash");');
    this.addSql('create index "campaign_claim_status_expires_idx" on "campaign_claim" ("status", "expires_at");');
  }
  override async down(): Promise<void> { this.addSql('drop table "campaign_claim";'); }
}
