import { Migration } from '@mikro-orm/migrations';

/**
 * Daily per-household counters for the AI allowances (`AI_DAILY_LIMIT_<FEATURE>`), one row per
 * household, feature and UTC day. See `services/ai/ai-allowance.service.ts`.
 */
export class Migration20261103201410 extends Migration {

  override name = 'Migration20261103201410';

  override up(): void | Promise<void> {
    this.addSql(`create table "ai_usage_allowance" ("ai_usage_allowance_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "day" date not null, "feature" varchar(32) not null, "tenant_key" int not null, "used_count" int not null default 0);`);
    this.addSql(`alter table "ai_usage_allowance" add constraint "ai_usage_allowance_tenant_key_feature_day_unique" unique ("tenant_key", "feature", "day");`);

    this.addSql(`alter table "ai_usage_allowance" add constraint "ai_usage_allowance_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ai_usage_allowance" cascade;`);
  }

}
