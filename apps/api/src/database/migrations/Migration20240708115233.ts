import { Migration } from '@mikro-orm/migrations';

export class Migration20240708115233 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table "transaction_ocr_import" ("transaction_ocrimport_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "account_key" int null, "tenant_key" int null, "appuser_key" int null, "file_url" varchar(255) not null, "status" text check ("status" in (\'Started\', \'Success\', \'Failed\')) not null default \'Started\', "llm_response" varchar(255) null, "tokens_spent" int not null, "transaction_key" int null);',
    );
    this.addSql(
      'alter table "transaction_ocr_import" add constraint "transaction_ocr_import_transaction_ocrimport_key_unique" unique ("transaction_ocrimport_key");',
    );

    this.addSql(
      'alter table "transaction_ocr_import" add constraint "transaction_ocr_import_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction_ocr_import" add constraint "transaction_ocr_import_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction_ocr_import" add constraint "transaction_ocr_import_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction_ocr_import" add constraint "transaction_ocr_import_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete set null;',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "transaction_ocr_import" cascade;');
  }
}
