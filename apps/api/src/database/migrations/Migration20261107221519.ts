import { Migration } from '@mikro-orm/migrations';

/**
 * Household rules (`rule`), with positions unique per household among live rows; per-field
 * markers for a description or merchant a person set by hand, which rules never change; and
 * `rule` as a source of a transaction's category.
 */
export class Migration20261107221519 extends Migration {

  override name = 'Migration20261107221519';

  override up(): void | Promise<void> {
    this.addSql(`create table "rule" ("rule_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "active" boolean not null default true, "actions" jsonb not null, "conditions" jsonb not null, "match" text not null default 'all', "name" varchar(100) not null, "owner_appuser_key" int null, "position" int not null, "stop_processing" boolean not null default false, "tenant_key" int not null, "version" smallint not null default 1);`);
    this.addSql(`CREATE UNIQUE INDEX rule_tenant_key_position_unique ON rule (tenant_key, position) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table "transaction" add "description_edited_by_user" boolean not null default false, add "merchant_edited_by_user" boolean not null default false;`);

    this.addSql(`alter table "appuser_transaction_category" drop constraint "appuser_transaction_category_source_check";`);
    this.addSql(`alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check ("source" in ('deterministic', 'manual', 'openai', 'rule', 'user'));`);

    this.addSql(`alter table "rule" add constraint "rule_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "rule" add constraint "rule_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "rule" add constraint "rule_match_check" check ("match" in ('all', 'any'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "rule" cascade;`);

    this.addSql(`alter table "appuser_transaction_category" drop constraint "appuser_transaction_category_source_check";`);
    this.addSql(`alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check ("source" in ('deterministic', 'manual', 'openai', 'user'));`);

    this.addSql(`alter table "transaction" drop column "description_edited_by_user", drop column "merchant_edited_by_user";`);
  }

}
