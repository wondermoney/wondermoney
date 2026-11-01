import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';

export class FinancialEmailCandidateRepository {
  constructor(private readonly em: EntityManager = DI.em) {}

  async page(stream: 'budget' | 'monthlyStory' | 'weekly', cursor = 0, limit = 250): Promise<number[]> {
    const columnByStream: Record<'budget' | 'monthlyStory' | 'weekly', string> = {
      budget: 'budget_alerts_enabled',
      monthlyStory: 'monthly_story_enabled',
      weekly: 'weekly_insights_enabled',
    };
    const column = columnByStream[stream];
    // Notifications are opted-in by default: a user with no preference row (or a
    // soft-deleted one) is a candidate unless they explicitly disabled the stream.
    //
    // There is deliberately no language filter. `owner."language" = 'PT'` sat here from the
    // feature's first commit — a PT-only launch that never widened — while the renderer has
    // always supported both: complete EN and PT copy tables, `en-GB` money and date
    // formatting, an `/en/` privacy URL, and `renderLang` falling back to English for
    // anything not PT. `@wondermoney/react-email` carries 36 `en:` keys against 36 `pt:`.
    // In production it was excluding 297 of 310 eligible users from a feature that renders
    // correctly in their language.
    //
    // The `not exists` clause is the important one. Every stream here reports on a tenant's
    // own numbers — "you have spent X against budget Y", "here is your week". A tenant with
    // an account stranded on a legacy requisition (a bank provider that no longer syncs) has a
    // *frozen* ledger: the account still exists and still has a balance, but no transaction
    // arrives any more, so any total computed over it is quietly wrong. Mailing that
    // user a confident figure is worse than mailing them nothing, because it looks correct.
    //
    // The condition is deliberately "the tenant has *any* such account" rather than "all of
    // them": one stranded account is enough to make a household-wide total incomplete.
    //
    // This is written as a raw predicate because the surrounding query already is; it
    // therefore carries its own `deleted_at` / `closed` checks rather than relying on the
    // ORM's filters, which do not apply here.
    const rows = await this.em.getConnection().execute<{ appuserKey: number }[]>(
      `select owner."appuser_key" as "appuserKey"
       from "appuser" owner
       left join "email_notification_preference" preference
         on preference."appuser_key" = owner."appuser_key" and preference."deleted_at" is null
       where owner."appuser_key" > ?
          and owner."record_active" = true and owner."deleted_at" is null
          and position('@' in owner."email_address") > 1
          and coalesce(preference."${column}", true) = true
          and not exists (
            select 1
            from "appuser_tenant" membership
            join "account" stranded on stranded."tenant_key" = membership."tenant_key"
            where membership."appuser_key" = owner."appuser_key"
              and membership."deleted_at" is null
              and stranded."deleted_at" is null and stranded."closed" = false
              and stranded."nordigen_requisition_key" is not null
              and stranded."enable_banking_connection_key" is null
          )
       order by owner."appuser_key" asc limit ?`,
      [cursor, Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((row) => row.appuserKey);
  }
}
