import { Migration } from '@mikro-orm/migrations';

export class Migration20241124132914 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "category" alter column "default_household_amount" type numeric(18, 2) using ("default_household_amount"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_household_multiplier" type numeric(18, 2) using ("default_household_multiplier"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_amount" type numeric(18, 2) using ("default_individual_amount"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_multiplier" type numeric(18, 2) using ("default_individual_multiplier"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_adult_amount" type numeric(18, 2) using ("default_individual_adult_amount"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_adult_multiplier" type numeric(18, 2) using ("default_individual_adult_multiplier"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_dependent_amount" type numeric(18, 2) using ("default_individual_dependent_amount"::numeric(18, 2));',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_dependent_multiplier" type numeric(18, 2) using ("default_individual_dependent_multiplier"::numeric(18, 2));',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "category" alter column "default_household_amount" type int using ("default_household_amount"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_household_multiplier" type int using ("default_household_multiplier"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_amount" type int using ("default_individual_amount"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_multiplier" type int using ("default_individual_multiplier"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_adult_amount" type int using ("default_individual_adult_amount"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_adult_multiplier" type int using ("default_individual_adult_multiplier"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_dependent_amount" type int using ("default_individual_dependent_amount"::int);',
    );
    this.addSql(
      'alter table "category" alter column "default_individual_dependent_multiplier" type int using ("default_individual_dependent_multiplier"::int);',
    );
  }
}
