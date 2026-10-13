import { Migration } from '@mikro-orm/migrations';

export class Migration20260719090100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "stripe_event_fact" add column "provider_object_id" varchar(255) null, add column "payment_reference" varchar(255) null, add column "dispute_status" varchar(255) null;`);
    this.addSql(`create index "stripe_event_fact_provider_object_id_idx" on "stripe_event_fact" ("provider_object_id");`);
    this.addSql(`create index "stripe_event_fact_payment_reference_event_type_idx" on "stripe_event_fact" ("payment_reference", "event_type");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "stripe_event_fact_payment_reference_event_type_idx";`);
    this.addSql(`drop index "stripe_event_fact_provider_object_id_idx";`);
    this.addSql(`alter table "stripe_event_fact" drop column "provider_object_id", drop column "payment_reference", drop column "dispute_status";`);
  }
}
