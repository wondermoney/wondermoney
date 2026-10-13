import { Migration } from '@mikro-orm/migrations';

export class Migration20241123181732 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_budget_template_fae23_foreign";',
    );

    this.addSql('alter table "budget_template_category" drop constraint "budget_template_category_pkey";');

    this.addSql(
      'alter table "budget_template_category" alter column "budget_template_category_key" type int using ("budget_template_category_key"::int);',
    );
    this.addSql('create sequence if not exists "budget_template_category_budget_template_category_key_seq";');
    this.addSql(
      'select setval(\'budget_template_category_budget_template_category_key_seq\', (select max("budget_template_category_key") from "budget_template_category"));',
    );
    this.addSql(
      'alter table "budget_template_category" alter column "budget_template_category_key" set default nextval(\'budget_template_category_budget_template_category_key_seq\');',
    );
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_budget_key_category_key_y_828a3_unique" unique ("budget_key", "category_key", "year", "month");',
    );
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_pkey" primary key ("budget_template_category_key");',
    );

    this.addSql(
      'alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_pkey";',
    );
    this.addSql(
      'alter table "budget_template_category_accounts" drop column "budget_template_category_budget_key", drop column "budget_template_category_category_key";',
    );

    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_budget_template_a7290_foreign" foreign key ("budget_template_category_budget_template_category_key") references "budget_template_category" ("budget_template_category_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_pkey" primary key ("budget_template_category_budget_template_category_key", "account_account_key");',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_budget_template_a7290_foreign";',
    );

    this.addSql(
      'alter table "budget_template_category" drop constraint "budget_template_category_budget_key_category_key_y_828a3_unique";',
    );
    this.addSql('alter table "budget_template_category" drop constraint "budget_template_category_pkey";');

    this.addSql(
      'alter table "budget_template_category" alter column "budget_template_category_key" type int using ("budget_template_category_key"::int);',
    );
    this.addSql('alter table "budget_template_category" alter column "budget_template_category_key" drop default;');
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_pkey" primary key ("budget_template_category_key", "budget_key", "category_key");',
    );

    this.addSql(
      'alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_pkey";',
    );

    this.addSql(
      'alter table "budget_template_category_accounts" add column "budget_template_category_budget_key" int not null, add column "budget_template_category_category_key" int not null;',
    );
    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_budget_template_fae23_foreign" foreign key ("budget_template_category_budget_template_category_key", "budget_template_category_budget_key", "budget_template_category_category_key") references "budget_template_category" ("budget_template_category_key", "budget_key", "category_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_pkey" primary key ("budget_template_category_budget_template_category_key", "budget_template_category_budget_key", "budget_template_category_category_key", "account_account_key");',
    );
  }
}
