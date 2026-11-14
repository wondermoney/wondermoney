import { Migration } from '@mikro-orm/migrations';

export class Migration20261110224231 extends Migration {

  override name = 'Migration20261110224231';

  override up(): void | Promise<void> {
    this.addSql(`alter table "loan" add "amortization_method" text not null default 'FRENCH', add "first_payment_date" date null;`);
    this.addSql(`alter table "loan" add constraint "loan_amortization_method_check" check ("amortization_method" in ('CONSTANT_PRINCIPAL', 'FRENCH'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "loan" drop constraint "loan_amortization_method_check";`);
    this.addSql(`alter table "loan" drop column "amortization_method", drop column "first_payment_date";`);
  }

}
