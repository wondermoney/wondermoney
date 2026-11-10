import { Migration } from '@mikro-orm/migrations';

/**
 * One-time secrets for background operations (`OperationSecret`): the password of a
 * password-protected data export, encrypted, held only until the export reads it. A new, empty
 * table.
 */
export class Migration20261109104646 extends Migration {

  override name = 'Migration20261109104646';

  override up(): void | Promise<void> {
    this.addSql(`create table "operation_secret" ("operation_secret_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "auth_tag" text not null, "ciphertext" text not null, "correlation_id" varchar(255) not null, "expires_at" timestamptz not null, "iv" text not null, "key_version" int not null);`);
    this.addSql(`create index "operation_secret_expires_at_idx" on "operation_secret" ("expires_at");`);
    this.addSql(`alter table "operation_secret" add constraint "operation_secret_correlation_id_unique" unique ("correlation_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "operation_secret" cascade;`);
  }

}
