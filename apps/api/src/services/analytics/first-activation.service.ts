import type { EntityManager } from '@mikro-orm/core';

import type { Appuser } from '@entity/Appuser';
import { isCanonicalExternalUserId, recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';
import logger from '@utils/logger';

export type FirstActivationKind = 'budget' | 'goal';

const EVENT_NAME_BY_KIND: Readonly<Record<FirstActivationKind, string>> = {
  budget: 'first_budget_created',
  goal: 'first_goal_created',
};

/**
 * Records the activation event for the first budget or goal a person creates:
 * `first_budget_created` or `first_goal_created`, keyed by the same distinct id as their
 * `signup` event, so an activation can be reported against the signup's `landing_source`.
 *
 * The event id is the same for every later budget or goal of that person, and the outbox
 * ignores a repeated id, so only the first is ever recorded. It carries no amounts, names or
 * other content of the budget or goal. Analytics never fails the request: a failure is logged.
 */
export async function recordFirstActivation(
  em: Pick<EntityManager, 'upsert'>,
  appuser: Pick<Appuser, 'appuserKey' | 'externalUserId'>,
  kind: FirstActivationKind,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Accounts from before the current sign-in may have no canonical identity to send.
  if (!isCanonicalExternalUserId(appuser.externalUserId)) return;
  const eventName = EVENT_NAME_BY_KIND[kind];

  try {
    await recordAnalyticsOutboxEvent(em, {
      distinctId: appuser.externalUserId,
      eventId: `${eventName}.v1:${appuser.externalUserId}`,
      eventName,
      properties: { appuser_key: appuser.appuserKey.toString() },
    }, env);
  } catch (error) { // no-excuse-ok: catch -- analytics must never fail the budget or goal it follows
    logger.warn({ appuserKey: appuser.appuserKey, error, eventName }, 'First activation analytics event not recorded');
  }
}
