import { Migration } from '@mikro-orm/migrations';

export class Migration20261111120429 extends Migration {

  override name = 'Migration20261111120429';

  override up(): void | Promise<void> {
    this.addSql(`alter table "assistant_audit_log" add "api_token_key" int null, add "source" text not null default 'assistant';`);
    this.addSql(`alter table "assistant_audit_log" add constraint "assistant_audit_log_api_token_key_foreign" foreign key ("api_token_key") references "api_token" ("api_token_key") on delete set null;`);
    this.addSql(`create index "assistant_audit_log_source_appuser_key_created_at_index" on "assistant_audit_log" ("source", "appuser_key", "created_at");`);
    this.addSql(`alter table "assistant_audit_log" add constraint "assistant_audit_log_source_check" check ("source" in ('assistant', 'mcp'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "assistant_audit_log" drop constraint "assistant_audit_log_api_token_key_foreign";`);

    this.addSql(`drop index "assistant_audit_log_source_appuser_key_created_at_index";`);
    this.addSql(`alter table "assistant_audit_log" drop constraint "assistant_audit_log_source_check";`);
    this.addSql(`alter table "assistant_audit_log" drop column "api_token_key", drop column "source";`);
  }

}
