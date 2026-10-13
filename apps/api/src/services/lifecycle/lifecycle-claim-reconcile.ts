import { DI } from '@app/database/di';
import { reconcileStaleClaims } from '@service/lifecycle/lifecycle-delivery.service';

/**
 * Resolves lifecycle delivery claims whose lease expired without the sender reporting an
 * outcome — the signature of a worker that died mid-send.
 *
 * It runs from the daily `lifecycle.cron` tick rather than from its own queue: the sweep is
 * cheap and bounded.
 */
export async function reconcileStaleLifecycleClaims(now: Date = new Date()): Promise<number> {
  return reconcileStaleClaims(DI.em, now);
}
