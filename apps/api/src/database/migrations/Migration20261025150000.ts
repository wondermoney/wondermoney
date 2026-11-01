import { Migration } from '@mikro-orm/migrations';

/**
 * Lets the audit log store every event type the code defines. The check constraint predates
 * `dedup_flagged`, which transaction creation writes when it flags a possible duplicate, so those
 * entries were rejected, and `system_remediation`.
 */
export class Migration20261025150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "transaction_audit_log" drop constraint if exists "transaction_audit_log_event_type_check";`);
    this.addSql(`alter table "transaction_audit_log" add constraint "transaction_audit_log_event_type_check" check ("event_type" in ('created', 'user_edit', 'system_edit', 'categorized', 'pending_promoted', 'pending_expired', 'dedup_skipped', 'dedup_flagged', 'balance_recalc', 'soft_deleted', 'system_remediation')) not valid;`);
    this.addSql(`alter table "transaction_audit_log" validate constraint "transaction_audit_log_event_type_check";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "transaction_audit_log" drop constraint if exists "transaction_audit_log_event_type_check";`);
    this.addSql(`alter table "transaction_audit_log" add constraint "transaction_audit_log_event_type_check" check ("event_type" in ('created', 'user_edit', 'system_edit', 'categorized', 'pending_promoted', 'pending_expired', 'dedup_skipped', 'balance_recalc', 'soft_deleted')) not valid;`);
  }
}
