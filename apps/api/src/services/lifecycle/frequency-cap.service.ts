import type { EntityManager, FilterQuery } from '@mikro-orm/core';

import { LifecycleDelivery } from '@entity/LifecycleDelivery';
import { LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';

/**
 * Global frequency cap + suppression gate every lifecycle/marketing send passes
 * through. Transactional/critical emails are exempt and never routed here.
 */

export interface SendWindow {
  criticalThreadActive: boolean;
  last7dCount: number;
  last24hCount: number;
}

const LIFECYCLE_CAP = { per7d: 3, per24h: 1 } as const;

export type SendBlockReason = 'cap_7d' | 'cap_24h' | 'critical_thread';

/**
 * Pure decision: is a lifecycle send allowed given the user's recent window?
 * Order matters — a live critical thread (broken bank, active dunning) beats
 * the numeric caps so we never pile marketing on top of an urgent problem.
 */
export function isSendAllowed(w: SendWindow): { allowed: boolean; reason?: SendBlockReason } {
  if (w.criticalThreadActive) return { allowed: false, reason: 'critical_thread' };
  if (w.last24hCount >= LIFECYCLE_CAP.per24h) return { allowed: false, reason: 'cap_24h' };
  if (w.last7dCount >= LIFECYCLE_CAP.per7d) return { allowed: false, reason: 'cap_7d' };
  return { allowed: true };
}

/**
 * Loads a user's recent lifecycle-send window from the delivery table. The
 * critical-thread signal (active broken-bank / dunning) is injected because its
 * source tables live outside this module; the concrete adapter supplies a real
 * checker, defaulting to "none" so the caps still apply on their own.
 */
export async function loadSendWindow(
  em: EntityManager,
  appuserKey: number,
  now: Date,
  isCriticalThreadActive: (appuserKey: number) => Promise<boolean> = async () => false,
): Promise<SendWindow> {
  const since24h = new Date(now.getTime() - 24 * 3_600_000);
  const since7d = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const last24hCount = await em.count(LifecycleDelivery, { appuserKey, sentAt: { $gte: since24h }, status: LifecycleDeliveryStatus.SENT } as FilterQuery<LifecycleDelivery>);
  const last7dCount = await em.count(LifecycleDelivery, { appuserKey, sentAt: { $gte: since7d }, status: LifecycleDeliveryStatus.SENT } as FilterQuery<LifecycleDelivery>);
  return { criticalThreadActive: await isCriticalThreadActive(appuserKey), last7dCount, last24hCount };
}
