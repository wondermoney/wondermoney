import { Migration } from '@mikro-orm/migrations';

export class Migration20261113173339 extends Migration {

  override name = 'Migration20261113173339';

  override up(): void | Promise<void> {
    this.addSql(`alter table "account" add "is_joint" boolean not null default false;`);

    this.addSql(`alter table "transaction" add "attributed_appuser_key" int null, add "attributed_to_shared" boolean not null default false;`);
    this.addSql(`alter table "transaction" add constraint "transaction_attributed_appuser_key_foreign" foreign key ("attributed_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_attribution_single_check" check (not ("attributed_to_shared" and "attributed_appuser_key" is not null));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction" drop constraint "transaction_attributed_appuser_key_foreign";`);

    this.addSql(`alter table "account" drop column "is_joint";`);

    this.addSql(`alter table "transaction" drop constraint "transaction_attribution_single_check";`);
    this.addSql(`alter table "transaction" drop column "attributed_appuser_key", drop column "attributed_to_shared";`);
  }

}
