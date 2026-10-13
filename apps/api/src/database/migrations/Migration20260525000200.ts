import { Migration } from '@mikro-orm/migrations';

export class Migration20260525000200 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "transaction_enrichment" (
      "transaction_enrichment_key" serial primary key,
      "transaction_key" int not null,
      "tenant_key" int null,
      "status" text not null default 'pending',
      "idempotency_key" varchar(255) not null,
      "prompt_version" varchar(255) not null,
      "model_version" varchar(255) not null,
      "eligibility_reason" varchar(1024) null,
      "merchant_suggestion" varchar(255) null,
      "category_suggestion_key" int null,
      "confidence" numeric(6,5) null,
      "reason_code" varchar(255) null,
      "input_hash" varchar(64) not null,
      "prompt_tokens" int not null default 0,
      "completion_tokens" int not null default 0,
      "total_tokens" int not null default 0,
      "estimated_cost_usd" numeric(18,8) null,
      "attempt_count" int not null default 0,
      "last_attempt_at" timestamptz null,
      "completed_at" timestamptz null,
      "error_code" varchar(255) null,
      "dlq_reason" varchar(1024) null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "transaction_enrichment_status_check" check ("status" in ('pending', 'shadow', 'completed', 'failed', 'dlq', 'skipped')),
      constraint "transaction_enrichment_confidence_check" check ("confidence" is null or ("confidence" >= 0 and "confidence" <= 1)),
      constraint "transaction_enrichment_prompt_tokens_check" check ("prompt_tokens" >= 0),
      constraint "transaction_enrichment_completion_tokens_check" check ("completion_tokens" >= 0),
      constraint "transaction_enrichment_total_tokens_check" check ("total_tokens" >= 0),
      constraint "transaction_enrichment_attempt_count_check" check ("attempt_count" >= 0),
      constraint "transaction_enrichment_estimated_cost_usd_check" check ("estimated_cost_usd" is null or "estimated_cost_usd" >= 0)
    );`);

    this.addSql(`alter table "transaction_enrichment" add constraint "transaction_enrichment_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on update cascade on delete cascade;`);
    this.addSql(`alter table "transaction_enrichment" add constraint "transaction_enrichment_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade on delete set null;`);
    this.addSql(`alter table "transaction_enrichment" add constraint "transaction_enrichment_category_suggestion_key_foreign" foreign key ("category_suggestion_key") references "category" ("category_key") on update cascade on delete set null;`);
    this.addSql(`create unique index if not exists "transaction_enrichment_idempotency_active_unique" on "transaction_enrichment" ("idempotency_key") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "transaction_enrichment_transaction_status_index" on "transaction_enrichment" ("transaction_key", "status") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "transaction_enrichment_tenant_status_index" on "transaction_enrichment" ("tenant_key", "status") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "transaction_enrichment" cascade;`);
  }
}
