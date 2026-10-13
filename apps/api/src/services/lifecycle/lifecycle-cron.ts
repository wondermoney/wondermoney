import { DI } from '@app/database/di';
import { DataHealthSteps } from '@service/lifecycle/campaigns/data-health';
import { scheduleLifecycleSteps } from '@service/lifecycle/lifecycle-enrollment';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';
import type { Enqueue } from '@service/queue/enqueue';

/** Bank connection authorizations are enrolled for renewal this many days before they actually expire. */
const CONSENT_EXPIRING_WINDOW_DAYS = 14;

/**
 * Coarse recurring sweeps. Delivery uniqueness is (appuser, campaign, step), so a
 * given base step sends once per user; period-scoped cadence (true monthly, etc.)
 * is a follow-up refinement on the delivery key.
 */
export async function runDataHealthSweep(enqueue: Enqueue, now: Date): Promise<void> {
  const expiresBefore = new Date(now.getTime() + CONSENT_EXPIRING_WINDOW_DAYS * 24 * 3_600_000).toISOString();
  const rows = await DI.em.getConnection().execute<{ appuserKey: number }[]>(
    `select distinct appuser_key as "appuserKey" from nordigen_requisition where status = 'linked' and expires_at is not null and expires_at <= ? and deleted_at is null and appuser_key is not null`,
    [expiresBefore],
  );
  for (const row of rows) await scheduleLifecycleSteps(DI.em, enqueue, LifecycleCampaign.DATA_HEALTH, row.appuserKey, 'data-health.v1', [{ scheduledFor: now, step: DataHealthSteps.CONSENT_EXPIRING }]);
}

/**
 * Runs all recurring lifecycle sweeps (invoked by the daily cron). The bank-consent-expiring
 * notice is a service-continuity signal, exempt from marketing opt-out (see `lifecycle-consent.ts`).
 */
export async function runLifecycleSweeps(enqueue: Enqueue, now: Date): Promise<void> {
  await runDataHealthSweep(enqueue, now);
}
