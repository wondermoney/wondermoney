import { Migration } from '@mikro-orm/migrations';

export class Migration20250824141647 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "bonus" drop constraint "bonus_type_key_foreign";`);

    this.addSql(
      `alter table "bonus" add column "destination_type_key" int not null, add column "destination_value" numeric not null;`,
    );
    this.addSql(
      `alter table "bonus" add constraint "bonus_destination_type_key_foreign" foreign key ("destination_type_key") references "bonus_type" ("bonus_type_key");`,
    );
    this.addSql(`alter table "bonus" rename column "type_key" to "origin_type_key";`);
    this.addSql(`alter table "bonus" rename column "value" to "origin_value";`);
    this.addSql(
      `alter table "bonus" add constraint "bonus_origin_type_key_foreign" foreign key ("origin_type_key") references "bonus_type" ("bonus_type_key");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "bonus" drop constraint "bonus_origin_type_key_foreign";`);
    this.addSql(`alter table "bonus" drop constraint "bonus_destination_type_key_foreign";`);

    this.addSql(`alter table "bonus" drop column "destination_type_key", drop column "destination_value";`);

    this.addSql(`alter table "bonus" rename column "origin_type_key" to "type_key";`);
    this.addSql(`alter table "bonus" rename column "origin_value" to "value";`);
    this.addSql(
      `alter table "bonus" add constraint "bonus_type_key_foreign" foreign key ("type_key") references "bonus_type" ("bonus_type_key");`,
    );
  }
}
