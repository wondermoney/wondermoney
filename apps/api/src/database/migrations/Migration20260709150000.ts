import { Migration } from '@mikro-orm/migrations';

export class Migration20260709150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "payment_invoice_error" alter column "error" type text;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "payment_invoice_error" alter column "error" type varchar(255);');
  }
}
