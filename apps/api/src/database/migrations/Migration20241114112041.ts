import { Migration } from '@mikro-orm/migrations';

export class Migration20241114112041 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "portfolio" alter column "balance" type numeric(18, 2) using ("balance"::numeric(18, 2));',
    );
    this.addSql('alter table "portfolio" alter column "balance" set default 0;');
  }

  async down(): Promise<void> {
    this.addSql('alter table "portfolio" alter column "balance" drop default;');
    this.addSql(
      'alter table "portfolio" alter column "balance" type numeric(18, 2) using ("balance"::numeric(18, 2));',
    );
  }
}
