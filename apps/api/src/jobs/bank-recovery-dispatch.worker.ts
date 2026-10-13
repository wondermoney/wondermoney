import { DI } from '@app/database/di';
import type { BankRecoveryDelivery } from '@entity/BankRecoveryDelivery';
import { BankRecoveryService } from '@service/bank-sync/bank-recovery.service';
import { createWorkerEnqueueAdapter } from '@service/queue/enqueue';
import type { PgBossSendAfterLike } from '@service/queue/pgboss-client';

import { type BankRecoveryPayload, enqueueBankRecoveryAfter } from './bank-recovery.queue';

const DISPATCH_LIMIT = 100;

export interface BankRecoveryDispatchFailure {
  deliveryKey: number;
  message: string;
}

export interface BankRecoveryDispatchResult {
  enqueued: number;
  failed: number;
  failures: BankRecoveryDispatchFailure[];
  reconciliation: number;
  scanned: number;
  skipped: number;
}

interface BankRecoveryDispatchDependencies {
  bankRecoveryService?: BankRecoveryDispatchService;
  boss?: PgBossSendAfterLike;
  enqueue?: EnqueueBankRecovery;
  env?: NodeJS.ProcessEnv;
}

interface BankRecoveryDispatchService {
  listDuePending(limit: number): Promise<DueBankRecoveryDelivery[]>;
  markStaleClaimsNeedsReconciliation(): Promise<number>;
}

interface DueBankRecoveryDelivery {
  bankRecoveryDeliveryKey: number;
  eligibleAfter: Date;
  incidentKey: number | { incidentId?: string };
  templateVersion: string;
}

type EnqueueBankRecovery = (payload: BankRecoveryPayload, eligibleAfter: Date) => Promise<null | string>;

export async function dispatchDueBankRecovery(
  dependencies: BankRecoveryDispatchDependencies = {},
): Promise<BankRecoveryDispatchResult> {
  const service = dependencies.bankRecoveryService ?? new BankRecoveryService({ em: DI.em });
  const reconciliation = await service.markStaleClaimsNeedsReconciliation();
  const result: BankRecoveryDispatchResult = {
    enqueued: 0,
    failed: 0,
    failures: [],
    reconciliation,
    scanned: 0,
    skipped: 0,
  };
  // Bank recovery is live with no gating (RAD-178 rollout gate removed): the
  // dispatcher always drains due deliveries. Any that should be suppressed are
  // filtered downstream at claim/authorization time in BankRecoveryService.
  const deliveries = await service.listDuePending(DISPATCH_LIMIT);
  if (!dependencies.bankRecoveryService && deliveries.length > 0) {
    await DI.em.populate(deliveries as unknown as BankRecoveryDelivery[], ['incidentKey']);
  }
  result.scanned = deliveries.length;
  const enqueue = dependencies.enqueue ?? ((payload, eligibleAfter) => {
    if (!dependencies.boss) throw new Error('Bank recovery dispatcher requires pg-boss');
    return enqueueBankRecoveryAfter(payload, { enqueue: createWorkerEnqueueAdapter(dependencies.boss) }, eligibleAfter);
  });

  for (const delivery of deliveries) {
    try {
      const incidentId = typeof delivery.incidentKey === 'object' ? delivery.incidentKey.incidentId : undefined;
      const jobId = await enqueue({
        deliveryKey: delivery.bankRecoveryDeliveryKey,
        incidentId: incidentId ?? '',
        templateVersion: delivery.templateVersion,
      }, delivery.eligibleAfter);
      if (jobId === null) result.skipped += 1;
      else result.enqueued += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        deliveryKey: delivery.bankRecoveryDeliveryKey,
        message: error instanceof Error ? error.message : 'Unknown queue transport failure',
      });
    }
  }
  return result;
}

export const handleBankRecoveryDispatchJob = (
  boss: PgBossSendAfterLike,
  dependencies: Omit<BankRecoveryDispatchDependencies, 'boss'> = {},
) => dispatchDueBankRecovery({ ...dependencies, boss });
