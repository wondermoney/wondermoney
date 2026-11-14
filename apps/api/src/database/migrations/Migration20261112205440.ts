import { Migration } from '@mikro-orm/migrations';

/** A PDF statement import's page progress and balance check (`TransactionImportSession.statementExtraction`). */

export class Migration20261112205440 extends Migration {

  override name = 'Migration20261112205440';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" add "statement_extraction" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_session" drop column "statement_extraction";`);
  }

}
