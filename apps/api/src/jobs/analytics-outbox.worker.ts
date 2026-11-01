import {
  type EntityManager,
  LockMode,
  QueryOrder,
} from '@mikro-orm/core';
import type { Logger } from 'pino';
import { PostHog } from 'posthog-node';
import type { EventMessage } from 'posthog-node';

import { DI } from '@app/database/di';
import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser } from '@entity/Appuser';
import { hasSensitiveAnalyticsProperties, isCanonicalExternalUserId } from '@service/analytics/analytics-outbox.service';
import logger from '@utils/logger';

const ANALYTICS_OUTBOX_BATCH_SIZE = 100;
const CANONICAL_EXTERNAL_UUID_SQL_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

export interface AnalyticsOutboxDeliverySummary {
  blocked: number;
  delivered: number;
  scanned: number;
}

interface AnalyticsOutboxWorkerDeps {
  em?: Pick<EntityManager, 'transactional'>;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  now?: () => Date;
  posthogClient?: PostHogDeliveryClient;
}

interface PostHogDeliveryClient {
  captureBatch(input: EventMessage[]): Promise<void>;
}

export class AcknowledgedPostHogClient extends PostHog implements PostHogDeliveryClient {
  async captureBatch(input: EventMessage[]): Promise<void> {
    const prepared = await Promise.all(input.map((event) => this.prepareEventMessage(event)));
    for (const event of prepared) {
      this.captureStateless(event.distinctId, event.event, event.properties, event.options);
    }
    await this.flush();
  }
}

export async function deliverAnalyticsOutboxBatch(
  deps: AnalyticsOutboxWorkerDeps = {},
): Promise<AnalyticsOutboxDeliverySummary> {
  const env = deps.env ?? process.env;
  // Product analytics are opt-in: delivery runs only with ANALYTICS_OUTBOX_MODE=live (which then
  // requires POSTHOG_API_KEY). Anything else, including an unset mode, is off.
  if (env['ANALYTICS_OUTBOX_MODE']?.trim() !== 'live') return { blocked: 0, delivered: 0, scanned: 0 };

  const posthogClient = deps.posthogClient ?? createPostHogDeliveryClient(env);
  const em = deps.em ?? DI.em;
  const log = deps.logger ?? logger;
  const now = deps.now ?? (() => new Date());

  return em.transactional(async (tx) => {
    const eligibleIds = await claimEligibleAnalyticsOutboxIds(tx);
    if (eligibleIds.length === 0) return { blocked: 0, delivered: 0, scanned: 0 };

    const rows = await tx.find(
      AnalyticsOutbox,
      {
        analyticsOutboxKey: { $in: eligibleIds },
        deletedAt: null,
        sentAt: null,
      },
      {
        limit: ANALYTICS_OUTBOX_BATCH_SIZE,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        orderBy: { analyticsOutboxKey: QueryOrder.ASC },
      },
    );
    const deliverable: AnalyticsOutbox[] = [];
    let blocked = 0;
    let dirty = false;

    for (const row of rows) {
      if (!isCanonicalExternalUserId(row.distinctId)) {
        blocked += 1;
        row.deletedAt = now();
        dirty = true;
        log.warn({ analyticsOutboxKey: row.analyticsOutboxKey, reason: 'identity_not_eligible' }, 'Analytics outbox row blocked');
        continue;
      }

      const appuser = await tx.findOne(
        Appuser,
        { deletedAt: null, externalUserId: row.distinctId, recordActive: true },
      );
      if (!appuser) {
        blocked += 1;
        log.warn({ analyticsOutboxKey: row.analyticsOutboxKey, reason: 'appuser_not_found' }, 'Analytics outbox row blocked');
        continue;
      }

      if (hasSensitiveAnalyticsProperties(row.properties)) {
        blocked += 1;
        row.deletedAt = now();
        dirty = true;
        log.error({ analyticsOutboxKey: row.analyticsOutboxKey, reason: 'sensitive_properties' }, 'Analytics outbox row blocked');
        continue;
      }

      deliverable.push(row);
    }

    if (deliverable.length > 0) {
      await posthogClient.captureBatch(deliverable.map((row) => ({
        distinctId: row.distinctId,
        event: row.eventName,
        properties: { ...row.properties, $insert_id: row.eventId },
      })));
      const sentAt = now();
      for (const row of deliverable) row.sentAt = sentAt;
      dirty = true;
    }
    if (dirty) await tx.flush();

    return { blocked, delivered: deliverable.length, scanned: rows.length };
  });
}

export async function handleAnalyticsOutboxJob(
  deps: AnalyticsOutboxWorkerDeps = {},
): Promise<AnalyticsOutboxDeliverySummary> {
  return deliverAnalyticsOutboxBatch(deps);
}

async function claimEligibleAnalyticsOutboxIds(em: EntityManager): Promise<number[]> {
  const claimed = await em.getConnection().execute(
    `
      select outbox.analytics_outbox_key as "analyticsOutboxKey"
      from analytics_outbox as outbox
      inner join appuser as appuser
        on appuser.external_user_id = outbox.distinct_id
        and appuser.deleted_at is null
        and appuser.record_active = true
      where outbox.deleted_at is null
        and outbox.sent_at is null
        and outbox.distinct_id ~ '${CANONICAL_EXTERNAL_UUID_SQL_PATTERN}'
      order by outbox.analytics_outbox_key asc
      limit ?
      for update of outbox, appuser skip locked
    `,
    [ANALYTICS_OUTBOX_BATCH_SIZE],
  ) as { analyticsOutboxKey: number | string }[];

  return claimed.map(({ analyticsOutboxKey }) => Number(analyticsOutboxKey));
}

/**
 * Cached per API key.
 *
 * This job runs once a minute; a fresh `PostHog` client per run would mean 1 440 clients
 * a day, each holding its own HTTP agent. One client per key, reused for the process's
 * life; `flush()` is called explicitly at the end of each batch.
 */
let cachedPostHogClient: undefined | { apiKey: string; client: PostHogDeliveryClient };

function createPostHogDeliveryClient(env: NodeJS.ProcessEnv): PostHogDeliveryClient {
  const apiKey = env['POSTHOG_API_KEY']?.trim();
  if (!apiKey) throw new Error('POSTHOG_API_KEY is required when analytics outbox delivery is enabled');
  if (cachedPostHogClient?.apiKey === apiKey) return cachedPostHogClient.client;

  const client = new AcknowledgedPostHogClient(apiKey, {
    flushAt: ANALYTICS_OUTBOX_BATCH_SIZE + 1,
    flushInterval: 0,
    host: env['POSTHOG_HOST']?.trim() || DEFAULT_POSTHOG_HOST,
  });
  cachedPostHogClient = { apiKey, client };
  return client;
}
