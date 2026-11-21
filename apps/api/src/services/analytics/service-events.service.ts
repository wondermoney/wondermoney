import { createHash, randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/core';
import type { AnalyticsEventNameFor, AnalyticsEventProperties } from '@wondermoney/shared';
import type { Request } from 'express';

import { type Appuser, AppuserAccountType } from '@entity/Appuser';
import {
  isAnalyticsOutboxEnabled,
  isCanonicalExternalUserId,
  recordAnalyticsOutboxEvent,
} from '@service/analytics/analytics-outbox.service';
import logger from '@utils/logger';

/**
 * Service events: the facts the API records for product analytics, for every user of the hosted
 * instance (`packages/shared/lib/analytics/README.md`, epic #628). Each is a catalogue event with
 * `surfaces: ['server']`, keyed by the person's external id, and written to the analytics outbox,
 * which delivers only with `ANALYTICS_OUTBOX_MODE=live`.
 *
 * Recording one never fails the change it follows: a failure is logged and dropped.
 */
export type AnalyticsPlatform = NonNullable<AnalyticsEventProperties<'user_active'>['platform']>;
export type ServiceEventName = AnalyticsEventNameFor<'server'>;

type EventEm = Pick<EntityManager, 'upsert'>;
interface RecordOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * The outbox's idempotency key, sent to PostHog as `$insert_id`, so it never holds a database
   * key. A stable id makes a repeat a no-op; the default is random, for an event recorded once
   * where the change is committed.
   */
  eventId?: string;
}

/** The person the event is about; a missing one (an unloaded relation) records nothing. */
type Subject = null | Pick<Appuser, 'externalUserId'> | undefined;

export async function recordServiceEvent<E extends ServiceEventName>(
  em: EventEm,
  subject: Subject,
  event: E,
  properties: AnalyticsEventProperties<E>,
  options: RecordOptions = {},
): Promise<void> {
  // Accounts from before the current sign-in may have no canonical identity to send.
  const distinctId = subject?.externalUserId;
  if (typeof distinctId !== 'string' || !isCanonicalExternalUserId(distinctId)) return;
  try {
    await recordAnalyticsOutboxEvent(em, {
      distinctId,
      eventId: options.eventId ?? `${event}.v1:${randomUUID()}`,
      eventName: event,
      properties: withoutUndefined(properties),
    }, options.env);
  } catch (error) { // no-excuse-ok: catch -- analytics must never fail the change it follows
    logger.warn({ error, event }, 'Service analytics event not recorded');
  }
}

const SIGN_IN_METHODS = new Set(['apple', 'email', 'google', 'oidc']);

/** better-auth's provider id as the catalogue's `method`: a provider added later is `other`. */
export function analyticsSignInMethod(providerId: string): AnalyticsEventProperties<'login'>['method'] {
  return SIGN_IN_METHODS.has(providerId) ? (providerId as AnalyticsEventProperties<'login'>['method']) : 'other';
}

/** One `login` per session, keyed by a hash of its id, which is a better-auth key. */
export function loginEventId(sessionId: string): string {
  return `login.v2:${createHash('sha256').update(`session:${sessionId}`).digest('hex')}`;
}

/** One `import_committed` per import: its id, hashed so the session's own id is not sent. */
export function importCommittedEventId(importId: string): string {
  return `import_committed.v1:${createHash('sha256').update(`import:${importId}`).digest('hex')}`;
}

/** The id of a person's `first_*` event: the same for every later one, so only the first is kept. */
export async function recordAccountCreated(
  em: EventEm,
  subject: Subject,
  properties: AnalyticsEventProperties<'account_created'>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await recordServiceEvent(em, subject, 'account_created', properties, { env });
  await recordServiceEvent(em, subject, 'first_account_created', properties, {
    env,
    eventId: firstEventId('first_account_created', subject),
  });
}

export async function recordBudgetCreated(
  em: EventEm,
  subject: Subject,
  properties: AnalyticsEventProperties<'budget_created'>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await recordServiceEvent(em, subject, 'budget_created', properties, { env });
  await recordServiceEvent(em, subject, 'first_budget_created', properties, {
    env,
    eventId: firstEventId('first_budget_created', subject),
  });
}

export async function recordGoalCreated(
  em: EventEm,
  subject: Subject,
  properties: AnalyticsEventProperties<'goal_created'>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await recordServiceEvent(em, subject, 'goal_created', properties, { env });
  await recordServiceEvent(em, subject, 'first_goal_created', properties, {
    env,
    eventId: firstEventId('first_goal_created', subject),
  });
}

function firstEventId(event: ServiceEventName, subject: Subject): string {
  return `${event}.v1:${subject?.externalUserId}`;
}

/**
 * Which client sent an authenticated request. No client names itself, so this reads how it
 * authenticated: a personal API token or MCP token is `api`, a better-auth session token in
 * `Authorization: Bearer` is the mobile app, and a session cookie is the web app.
 */
export function requestPlatform(req: Pick<Request, 'apiToken' | 'headers'>): AnalyticsPlatform {
  if (req.apiToken) return 'api';
  // A request built without headers (a job, a test double) reads as web.
  const headers = req.headers as Request['headers'] | undefined;
  return /^bearer\s/iu.test(headers?.authorization ?? '') ? 'mobile' : 'web';
}

/** The people whose `user_active` this process has already recorded today. */
const recordedActiveDays = new Set<string>();
let recordedActiveDay = '';

/**
 * `user_active`, once per person per UTC day, on their first authenticated request from any
 * client. The outbox's event id (person and day) deduplicates across processes; the in-process
 * set saves the write on every later request.
 */
export async function recordUserActive(
  em: EventEm,
  subject: null | (Partial<Pick<Appuser, 'accountType'>> & Pick<Appuser, 'externalUserId'>) | undefined,
  platform: AnalyticsPlatform,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // The demo account is one identity shared by every visitor: not a person.
  if (!isAnalyticsOutboxEnabled(env) || !subject || subject.accountType === AppuserAccountType.DEMO) return;
  const day = now.toISOString().slice(0, 10);
  if (day !== recordedActiveDay) {
    recordedActiveDays.clear();
    recordedActiveDay = day;
  }
  const seen = `${subject.externalUserId}:${day}`;
  if (recordedActiveDays.has(seen)) return;
  recordedActiveDays.add(seen);
  await recordServiceEvent(em, subject, 'user_active', { platform }, {
    env,
    eventId: `user_active.v1:${subject.externalUserId}:${day}`,
  });
}

/** Test seam: forgets the days this process recorded. */
export function resetRecordedActiveDays(): void {
  recordedActiveDays.clear();
  recordedActiveDay = '';
}

function withoutUndefined(properties: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}
