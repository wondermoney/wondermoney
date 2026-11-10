import type { FxOverridePair } from '@service/currency/fx-reconvert.service';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/**
 * Re-convert amounts stored without a usable rate, and revalue foreign-currency account balances
 * (`services/currency/fx-reconvert.service.ts`). Enqueued after every successful exchange-rate
 * refresh; there is no schedule of its own, since nothing it does can change until a rate does.
 *
 * With `override`, the run is the narrower pass after a household changed an exchange-rate
 * override: that household's amounts in that one pair, converted again at whatever the resolver now
 * says. Each household pair has its own singleton key, so a change to one never waits behind, or is
 * dropped for, a change to another; two quick changes to the same pair collapse into one waiting
 * run, which reads the overrides as they are when it starts.
 */
export const FX_RECONVERT_QUEUE = 'fx.reconvert';

export interface FxReconvertPayload {
  correlationId: string;
  dryRun?: boolean;
  /** One household pair to re-convert after an override change, instead of the global pass. */
  override?: FxOverridePair;
}

export const ensureFxReconvertQueue = (boss: Pick<PgBossLike, 'createQueue'>) => boss.createQueue(FX_RECONVERT_QUEUE, {
  // A first run after deploy restamps every legacy row, one account at a time.
  expireInSeconds: 3_600,
  // `stately`: one run active and one waiting. A refresh that lands new rates while a run is going
  // queues one more pass instead of being dropped.
  policy: 'stately',
  // Each account commits on its own and a re-run only finds what is left, so a retry is cheap.
  retryBackoff: true,
  retryDelay: 300,
  retryLimit: 2,
});

export function enqueueFxReconvertJob(payload: FxReconvertPayload, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.send(FX_RECONVERT_QUEUE, payload, { singletonKey: singletonKeyOf(payload) });
}

function singletonKeyOf(payload: FxReconvertPayload): string {
  const { override } = payload;
  return override ? `${FX_RECONVERT_QUEUE}:override:${override.tenantKey}:${override.fromCurrency}:${override.toCurrency}` : FX_RECONVERT_QUEUE;
}

QUEUE_REGISTRY.set(FX_RECONVERT_QUEUE, { ensure: ensureFxReconvertQueue, name: FX_RECONVERT_QUEUE });
