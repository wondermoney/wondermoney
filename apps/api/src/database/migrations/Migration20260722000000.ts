import { Migration } from '@mikro-orm/migrations';

/**
 * Add `appuser.requires_mfa_reenrollment` (RAD-289): flags users migrated from Supabase who had
 * >=1 verified MFA factor there. Their TOTP secret is not migrated, so better-auth's own
 * `user.twoFactorEnabled` is left false to avoid locking them out; web instead reads this flag
 * (RAD-294) to prompt MFA re-enrollment on first post-migration login.
 */
export class Migration20260722000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "appuser" add column "requires_mfa_reenrollment" boolean not null default false;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "appuser" drop column "requires_mfa_reenrollment";');
  }
}
