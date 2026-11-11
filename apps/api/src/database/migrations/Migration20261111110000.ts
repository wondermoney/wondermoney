import { Migration } from '@mikro-orm/migrations';

/**
 * Files kept with a transaction (receipts, invoices, warranties), and the object key of the
 * receipt copy the OCR flow already stores, so the created transaction can link it.
 */
export class Migration20261111110000 extends Migration {

  override name = 'Migration20261111110000';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaction_attachment" ("transaction_attachment_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "storage_key" varchar(512) not null, "file_name" varchar(255) not null, "content_type" varchar(100) not null, "size_bytes" int not null, "transaction_key" int not null, "tenant_key" int not null, "uploaded_by_appuser_key" int not null);`);
    this.addSql(`create index "transaction_attachment_transaction_key_index" on "transaction_attachment" ("transaction_key");`);

    this.addSql(`alter table "transaction_attachment" add constraint "transaction_attachment_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
    this.addSql(`alter table "transaction_attachment" add constraint "transaction_attachment_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_attachment" add constraint "transaction_attachment_uploaded_by_appuser_key_foreign" foreign key ("uploaded_by_appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "transaction_ocr_import" add "file_key" varchar(512) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_ocr_import" drop column "file_key";`);
    this.addSql(`drop table if exists "transaction_attachment" cascade;`);
  }

}
