import type { EntityManager } from '@mikro-orm/core';

import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';

const EVENT_ID_MAX_LENGTH = 255;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const EMAIL_VALUE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const FORBIDDEN_PROPERTY_KEYS = new Set([
  'email',
  'emailaddress',
  'externaluserid',
  'fullname',
  'password',
  'promocodeorreferralcode',
  'promocodeorreferralorigin',
  'set',
  'token',
]);

// Canonical lowercase UUID only: a near-miss (wrong case, whitespace, an email) is not an
// identity, and must never reach the analytics provider as one.
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface AnalyticsOutboxEventInput {
  distinctId: string;
  eventId: string;
  eventName: string;
  properties: Record<string, unknown>;
}

export function hasSensitiveAnalyticsProperties(properties: Record<string, unknown>): boolean {
  return containsSensitiveValue(properties, new WeakSet<object>());
}

export function isCanonicalExternalUserId(externalUserId: string): boolean {
  return CANONICAL_UUID.test(externalUserId);
}

export async function recordAnalyticsOutboxEvent(
  em: Pick<EntityManager, 'upsert'>,
  input: AnalyticsOutboxEventInput,
): Promise<void> {
  assertAnalyticsOutboxEvent(input);
  const timestamp = new Date();
  await em.upsert(
    AnalyticsOutbox,
    {
      createdAt: timestamp,
      distinctId: input.distinctId,
      eventId: input.eventId,
      eventName: input.eventName,
      properties: { ...input.properties, $insert_id: input.eventId },
      updatedAt: timestamp,
    },
    { onConflictAction: 'ignore', onConflictFields: ['eventId'] },
  );
}

function assertAnalyticsOutboxEvent(input: AnalyticsOutboxEventInput): void {
  if (!isCanonicalExternalUserId(input.distinctId)) {
    throw new Error('Analytics outbox distinctId must be a canonical lowercase external UUID');
  }
  if (input.eventId.length === 0 || input.eventId.length > EVENT_ID_MAX_LENGTH) {
    throw new Error('Analytics outbox eventId is invalid');
  }
  if (!EVENT_NAME_PATTERN.test(input.eventName)) {
    throw new Error('Analytics outbox eventName is invalid');
  }
  if (hasSensitiveAnalyticsProperties(input.properties)) {
    throw new Error('Analytics outbox properties contain sensitive data');
  }
}

function containsSensitiveValue(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === 'string') return EMAIL_VALUE_PATTERN.test(value);
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry, seen));

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
    return FORBIDDEN_PROPERTY_KEYS.has(normalizedKey) || containsSensitiveValue(entry, seen);
  });
}
