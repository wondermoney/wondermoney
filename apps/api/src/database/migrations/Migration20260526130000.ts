import { Migration } from '@mikro-orm/migrations';

export class Migration20260526130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('create table "recurring_series" ("recurring_series_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "tenant_key" int not null, "appuser_key" int null, "account_key" int null, "category_key" int null, "currency_key" int null, "type" text not null default \'subscription\', "status" text not null default \'candidate\', "source" text not null default \'detected\', "cadence" text not null default \'monthly\', "amount_type" text not null default \'fixed\', "confidence_score" numeric(18, 4) not null default 0, "cadence_confidence" numeric(18, 4) not null default 0, "display_name" varchar(255) not null, "normalized_merchant_key" varchar(255) not null, "merchant_display_name" varchar(255) null, "expected_amount" numeric(18, 4) null, "expected_amount_min" numeric(18, 4) null, "expected_amount_max" numeric(18, 4) null, "average_amount" numeric(18, 4) null, "last_amount" numeric(18, 4) null, "first_seen_at" timestamptz null, "last_seen_at" timestamptz null, "next_expected_at" timestamptz null, "occurrence_count" int not null default 0, "detection_version" int not null default 1);');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete set null;');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on delete set null;');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null;');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_type_check" check ("type" in (\'bill\', \'subscription\'));');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_status_check" check ("status" in (\'candidate\', \'confirmed\', \'dismissed\', \'ended\', \'paused\'));');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_source_check" check ("source" in (\'detected\', \'user_created\'));');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_cadence_check" check ("cadence" in (\'biweekly\', \'monthly\', \'quarterly\', \'weekly\', \'yearly\'));');
    this.addSql('alter table "recurring_series" add constraint "recurring_series_amount_type_check" check ("amount_type" in (\'fixed\', \'variable\'));');
    this.addSql('create index "recurring_series_tenant_status_next_expected_at_index" on "recurring_series" ("tenant_key", "status", "next_expected_at");');
    this.addSql('create index "recurring_series_tenant_normalized_merchant_key_index" on "recurring_series" ("tenant_key", "normalized_merchant_key");');
    this.addSql('create index "recurring_series_tenant_key_index" on "recurring_series" ("tenant_key");');
    this.addSql('create index "recurring_series_appuser_key_index" on "recurring_series" ("appuser_key");');

    this.addSql('create table "recurring_occurrence" ("recurring_occurrence_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "recurring_series_key" int not null, "transaction_key" int null, "currency_key" int null, "occurrence_date" timestamptz not null, "amount" numeric(18, 4) null, "match_status" text not null default \'matched\');');
    this.addSql('alter table "recurring_occurrence" add constraint "recurring_occurrence_recurring_series_key_foreign" foreign key ("recurring_series_key") references "recurring_series" ("recurring_series_key");');
    this.addSql('alter table "recurring_occurrence" add constraint "recurring_occurrence_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete set null;');
    this.addSql('alter table "recurring_occurrence" add constraint "recurring_occurrence_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null;');
    this.addSql('alter table "recurring_occurrence" add constraint "recurring_occurrence_match_status_check" check ("match_status" in (\'manual_added\', \'manual_removed\', \'matched\', \'missed\', \'predicted\'));');
    this.addSql('create index "recurring_occurrence_transaction_key_index" on "recurring_occurrence" ("transaction_key") where "transaction_key" is not null;');
    this.addSql('create unique index "recurring_occurrence_series_transaction_unique" on "recurring_occurrence" ("recurring_series_key", "transaction_key") where "transaction_key" is not null;');
    this.addSql('create index "recurring_occurrence_series_occurrence_date_index" on "recurring_occurrence" ("recurring_series_key", "occurrence_date");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "recurring_occurrence" cascade;');
    this.addSql('drop table if exists "recurring_series" cascade;');
  }
}
