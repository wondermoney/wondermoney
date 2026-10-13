import { Migration } from '@mikro-orm/migrations';

export class Migration20241114112213 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "portfolio" alter column "appuser_currency_balance" type numeric(18, 2) using ("appuser_currency_balance"::numeric(18, 2));',
    );
    this.addSql('alter table "portfolio" alter column "appuser_currency_balance" set default 0;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "portfolio" alter column "appuser_currency_balance" drop default;');
    this.addSql(
      'alter table "portfolio" alter column "appuser_currency_balance" type numeric(18, 2) using ("appuser_currency_balance"::numeric(18, 2));',
    );
  }
}
