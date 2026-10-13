import { describe, expect, it, vi } from 'vitest';

import { dispatchDueBankRecovery } from '../bank-recovery-dispatch.worker';

const incidentId = '1f8fab82-1cc1-427b-9f51-5b9fe416bd88';
const due = (key: number, milliseconds = 60) => ({
  bankRecoveryDeliveryKey: key,
  eligibleAfter: new Date(milliseconds),
  incidentKey: { incidentId },
  templateVersion: 'bank-recovery.v1',
});

function harness(rows = [due(1)]) {
  const service = {
    listDuePending: vi.fn().mockResolvedValue(rows),
    markStaleClaimsNeedsReconciliation: vi.fn().mockResolvedValue(2),
  };
  const enqueue = vi.fn().mockResolvedValue('job-1');
  return { enqueue, service };
}

describe('bank recovery dispatcher', () => {
  it('marks stale claims and still scans + enqueues even with the retired rollout flag off (gate removed)', async () => {
    const h = harness();
    await expect(dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'off' } })).resolves.toEqual({
      enqueued: 1, failed: 0, failures: [], reconciliation: 2, scanned: 1, skipped: 0,
    });
    expect(h.service.markStaleClaimsNeedsReconciliation).toHaveBeenCalledOnce();
    expect(h.service.listDuePending).toHaveBeenCalledWith(100);
  });

  it('lists at most 100 due rows and preserves 60/65ms eligible dates', async () => {
    const h = harness([due(1, 60), due(2, 65)]);
    await expect(dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'live' } })).resolves.toMatchObject({ enqueued: 2, scanned: 2 });
    expect(h.service.listDuePending).toHaveBeenCalledWith(100);
    expect(h.enqueue.mock.calls.map((call) => (call[1] as Date).getTime())).toEqual([60, 65]);
  });

  it('counts duplicate null as skipped rather than failed', async () => {
    const h = harness();
    h.enqueue.mockResolvedValue(null);
    await expect(dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'live' } })).resolves.toMatchObject({ failed: 0, skipped: 1 });
  });

  it('records sendAfter throws and leaves dispatching other pending rows', async () => {
    const h = harness([due(1), due(2)]);
    h.enqueue.mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValueOnce('job-2');
    await expect(dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'live' } })).resolves.toMatchObject({
      enqueued: 1, failed: 1, failures: [{ deliveryKey: 1, message: 'queue unavailable' }], scanned: 2,
    });
  });

  it('recreates a lost delayed job because pending delivery rows remain authoritative', async () => {
    const h = harness();
    await dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'live' } });
    await dispatchDueBankRecovery({ bankRecoveryService: h.service, enqueue: h.enqueue, env: { BANK_RECOVERY_MODE: 'live' } });
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.service).not.toHaveProperty('findJobs');
  });
});
