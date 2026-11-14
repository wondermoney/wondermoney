import { Migration } from '@mikro-orm/migrations';

export class Migration20261112155429 extends Migration {

  override name = 'Migration20261112155429';

  override up(): void | Promise<void> {
    this.addSql(`create table "assistant_proposal" ("assistant_proposal_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "api_token_key" int null, "decided_at" timestamptz null, "expires_at" timestamptz not null, "failure_reason" varchar(64) null, "kind" text not null, "payload" jsonb not null, "source" text not null, "status" text not null default 'pending', "summary" text not null, "tenant_key" int not null);`);
    this.addSql(`create index "assistant_proposal_status_expires_at_idx" on "assistant_proposal" ("status", "expires_at");`);
    this.addSql(`create index "assistant_proposal_owner_status_created_idx" on "assistant_proposal" ("tenant_key", "appuser_key", "status", "created_at");`);

    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_api_token_key_foreign" foreign key ("api_token_key") references "api_token" ("api_token_key") on delete set null;`);
    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_kind_check" check ("kind" in ('categorize_transactions', 'mark_transactions_reviewed', 'update_transaction_note'));`);
    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_source_check" check ("source" in ('assistant', 'mcp'));`);
    this.addSql(`alter table "assistant_proposal" add constraint "assistant_proposal_status_check" check ("status" in ('applied', 'expired', 'failed', 'pending', 'rejected'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "assistant_proposal" cascade;`);
  }

}
