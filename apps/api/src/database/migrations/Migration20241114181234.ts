import { Migration } from '@mikro-orm/migrations';

export class Migration20241114181234 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "financial_asset_company" alter column "description" type text using ("description"::text);',
    );

    this.addSql('alter table "financial_asset" drop constraint "financial_asset_isin_unique";');
    this.addSql('alter table "financial_asset" drop constraint "financial_asset_fmt_symbol_unique";');

    this.addSql(
      'alter table "financial_asset" add column "cik" varchar(255) null, add column "cusip" varchar(255) null, add column "environment_score" numeric null, add column "social_score" numeric null, add column "governance_score" numeric null, add column "is_actively_trading" boolean not null default true;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX fmt_symbol_unique_not_null ON financial_asset (fmt_symbol) WHERE fmt_symbol IS NOT NULL;',
    );
    this.addSql('CREATE UNIQUE INDEX isin_unique_not_null ON financial_asset (isin) WHERE isin IS NOT NULL;');
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "financial_asset_company" alter column "description" type varchar(255) using ("description"::varchar(255));',
    );

    this.addSql('drop index "fmt_symbol_unique_not_null";');
    this.addSql('drop index "isin_unique_not_null";');
    this.addSql(
      'alter table "financial_asset" drop column "cik", drop column "cusip", drop column "environment_score", drop column "social_score", drop column "governance_score", drop column "is_actively_trading";',
    );

    this.addSql('alter table "financial_asset" add constraint "financial_asset_isin_unique" unique ("isin");');
    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_fmt_symbol_unique" unique ("fmt_symbol");',
    );
  }
}
