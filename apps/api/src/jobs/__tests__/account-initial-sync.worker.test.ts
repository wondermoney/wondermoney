import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

vi.mock('@service/account/account-initial-sync-account.service', () => ({ default: {} }));
vi.mock('@service/account/account-initial-sync-transaction.service', () => ({ default: {} }));
vi.mock('@service/operations/background-operation.service', () => ({ default: {} }));
const em = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em } }));

import { handleAccountInitialSyncJob } from '@app/jobs/account-initial-sync.worker';

type AccountInitialSyncJob = Parameters<typeof handleAccountInitialSyncJob>[0];
type AccountService = NonNullable<WorkerDeps['accountInitialSyncAccountService']>;
type TransactionService = NonNullable<WorkerDeps['accountInitialSyncTransactionService']>;
type WorkerDeps = NonNullable<Parameters<typeof handleAccountInitialSyncJob>[1]>;

const job = (data: unknown, id: string, retryCount = 0, retryLimit = 3): AccountInitialSyncJob =>
  pgBossJob(data, { id, retryCount, retryLimit }) as unknown as AccountInitialSyncJob;

type AccountsResult = Awaited<ReturnType<AccountService['syncAccountsForRequisition']>>;
const accountsResult = (status: AccountsResult['status']): AccountsResult => ({
  accountsCreated: 0,
  accountsFailed: 0,
  accountsFetched: 0,
  accountsTotal: 0,
  accountsUpdated: 0,
  appuserKey: 1,
  failedAccountIds: [],
  institutionIds: [],
  requisitionId: 'req-1',
  requisitionKey: 12,
  status,
});

/* eslint-disable @typescript-eslint/require-await */

const correlationId = 'account.initial-sync:12';
const incidentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = { connectionId: 'req-12', correlationId, enableBankingConnectionKey: '12', incidentId, provider: 'enable_banking' };

function harness() {
  const order: string[] = [];
  const incident = {
    assertIncident: vi.fn().mockResolvedValue({ distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    completeOrAllocateLegacyIncident: vi.fn().mockResolvedValue({ incidentId }),
    finalizeAttempt: vi.fn(async (): Promise<unknown> => { order.push('finalize'); return undefined; }),
    startAttempt: vi.fn(async (input: { queueAttempt: number }) => { order.push('start'); return { attempt: input.queueAttempt }; }),
  };
  const account = {
    syncAccountsForRequisition: vi.fn(async () => { order.push('provider'); return { status: 'completed' as const }; }),
  } as unknown as AccountService;
  const transactions = {
    syncTransactionsForRequisition: vi.fn().mockResolvedValue({ status: 'completed' }),
  } as unknown as TransactionService;
  const background = { claimJobStart: vi.fn().mockResolvedValue(true), markAttemptFailedForRetry: vi.fn().mockResolvedValue(true) };
  return { account, background, incident, order, transactions };
}

describe('account initial sync producer contract worker', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('verifies, starts attempt 1 before provider work, then finalizes full success', async () => {
    const h = harness();
    await expect(handleAccountInitialSyncJob(job(payload, 'job-1'), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).resolves.toBe(true);
    expect(h.incident.assertIncident).toHaveBeenCalledWith({ correlationId, flow: 'initial-add', incidentId, producer: 'pgboss-initial', requisitionId: 'req-12', userVisible: true });
    expect(h.incident.startAttempt).toHaveBeenCalledWith({ incidentId, queueAttempt: 1, queueJobId: 'job-1' });
    expect(h.order).toEqual(['start', 'provider', 'finalize']);
    expect(h.incident.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, final: true, incidentId, result: 'full_success', treatmentMode: null }));
  });

  it('persists a nonterminal partial before throwing for retry', async () => {
    const h = harness();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(h.account.syncAccountsForRequisition).mockResolvedValueOnce(accountsResult('partial'));
    await expect(handleAccountInitialSyncJob(job(payload, 'job-2', 1), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).rejects.toThrow('partial');
    expect(h.incident.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, final: false, result: 'partial' }));
    expect(h.order.at(-1)).toBe('finalize');
  });

  it('makes an exhausted failure terminal and snapshots live treatment', async () => {
    vi.stubEnv('BANK_RECOVERY_MODE', 'live');
    vi.stubEnv('APP_ENV', 'production');
    const h = harness();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(h.account.syncAccountsForRequisition).mockResolvedValueOnce(accountsResult('failed'));
    await expect(handleAccountInitialSyncJob(job(payload, 'job-4', 3), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).resolves.toBe(false);
    expect(h.incident.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 4, final: true, result: 'failed', treatmentMode: 'live' }));
  });

  it('schedules an eligible terminal delivery only after finalize commits', async () => {
    vi.stubEnv('BANK_RECOVERY_MODE', 'live');
    vi.stubEnv('APP_ENV', 'production');
    const h = harness();
    const eligibleAfter = new Date(65);
    const sendAfter = vi.fn(async () => { h.order.push('enqueue'); return 'recovery-job'; });
    h.incident.finalizeAttempt.mockImplementationOnce(async () => {
      h.order.push('finalize');
      return { scheduleIntent: { deliveryKey: 60, eligibleAfter, incidentId, templateVersion: 'bank-recovery.v1' } };
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(h.account.syncAccountsForRequisition).mockResolvedValueOnce(accountsResult('failed'));
    await expect(handleAccountInitialSyncJob(job(payload, 'job-4', 3), {
      accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions,
      backgroundOperationService: h.background, bankSyncIncidentService: h.incident, sendAfter,
    })).resolves.toBe(false);
    expect(h.order).toEqual(['start', 'finalize', 'enqueue']);
    expect(sendAfter).toHaveBeenCalledWith('bank-recovery.send', { deliveryKey: 60, incidentId, templateVersion: 'bank-recovery.v1' }, expect.objectContaining({ singletonKey: `${incidentId}:bank-recovery.v1` }), eligibleAfter);
  });

  it.each([[null, 0], [new Error('queue unavailable'), 1]] as const)('keeps the bank result when post-commit scheduling returns or throws %s', async (queueResult, warningCount) => {
    const h = harness();
    const logger = { info: vi.fn(), warn: vi.fn() };
    h.incident.finalizeAttempt.mockResolvedValueOnce({ scheduleIntent: { deliveryKey: 60, eligibleAfter: new Date(65), incidentId, templateVersion: 'bank-recovery.v1' } });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(h.account.syncAccountsForRequisition).mockResolvedValueOnce(accountsResult('failed'));
    const sendAfter = queueResult instanceof Error ? vi.fn().mockRejectedValue(queueResult) : vi.fn().mockResolvedValue(queueResult);
    await expect(handleAccountInitialSyncJob(job(payload, 'job-4', 3), {
      accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions,
      backgroundOperationService: h.background, bankSyncIncidentService: h.incident, logger, sendAfter,
    })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(warningCount);
  });

  it('propagates persistence failure without recording a second bank outcome', async () => {
    const h = harness();
    h.incident.finalizeAttempt.mockRejectedValueOnce(new Error('outbox rollback'));
    await expect(handleAccountInitialSyncJob(job(payload, 'job-1'), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).rejects.toThrow('outbox rollback');
    expect(h.incident.finalizeAttempt).toHaveBeenCalledTimes(1);
  });

  it('rejects payloads without the allocated incident before claim/provider work', async () => {
    const h = harness();
    await expect(handleAccountInitialSyncJob(job({ ...payload, incidentId: '' }, 'job'), { accountInitialSyncAccountService: h.account, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).rejects.toThrow(/missing incidentId/);
    expect(h.background.claimJobStart).not.toHaveBeenCalled();
  });
});

// Phase 1d: the Enable Banking variant of the same worker — `provider === 'enable_banking'` is the
// only branch; everything below it (incident/background-operation/recovery machinery) is the exact
// same code the GoCardless tests above exercise.
describe('account initial sync producer contract worker — Enable Banking', () => {
  const ebCorrelationId = 'account.initial-sync:5';
  const ebPayload = { connectionId: 'session-1', correlationId: ebCorrelationId, enableBankingConnectionKey: '5', incidentId, provider: 'enable_banking' as const };

  it('calls the sync services with enableBankingConnectionKey (not nordigenRequisitionKey) and finalizes full success', async () => {
    const h = harness();
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
    await expect(handleAccountInitialSyncJob(job(ebPayload, 'eb-job-1'), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident, enqueue })).resolves.toBe(true);
    expect(h.incident.assertIncident).toHaveBeenCalledWith({ correlationId: ebCorrelationId, flow: 'initial-add', incidentId, producer: 'pgboss-initial', requisitionId: 'session-1', userVisible: true });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(h.account.syncAccountsForRequisition).toHaveBeenCalledWith({ correlationId: ebCorrelationId, enableBankingConnectionKey: 5, queueJobId: 'eb-job-1' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(h.transactions.syncTransactionsForRequisition).toHaveBeenCalledWith({ correlationId: ebCorrelationId, enableBankingConnectionKey: 5, fetchWindowDays: 365, queueJobId: 'eb-job-1' }, { enqueue });
  });

  it('rejects an Enable Banking payload missing incidentId rather than falling into GoCardless legacy reconciliation', async () => {
    const h = harness();
    await expect(handleAccountInitialSyncJob(job({ ...ebPayload, incidentId: '' }, 'eb-job-2'), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).rejects.toThrow(/missing incidentId/);
    expect(h.incident.completeOrAllocateLegacyIncident).not.toHaveBeenCalled();
    expect(h.background.claimJobStart).not.toHaveBeenCalled();
  });

  it('rejects a malformed Enable Banking payload (bad key) without touching the claim', async () => {
    const h = harness();
    await expect(handleAccountInitialSyncJob(job({ ...ebPayload, enableBankingConnectionKey: 'not-a-number' }, 'eb-job-3'), { accountInitialSyncAccountService: h.account, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).resolves.toBe(false);
    expect(h.background.claimJobStart).not.toHaveBeenCalled();
  });

  it('propagates a failed account phase and finalizes as failed, same as the GoCardless path', async () => {
    const h = harness();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(h.account.syncAccountsForRequisition).mockResolvedValueOnce(accountsResult('failed'));
    await expect(handleAccountInitialSyncJob(job(ebPayload, 'eb-job-4', 3), { accountInitialSyncAccountService: h.account, accountInitialSyncTransactionService: h.transactions, backgroundOperationService: h.background, bankSyncIncidentService: h.incident })).resolves.toBe(false);
    expect(h.incident.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 4, errorCode: 'account_phase_failed', final: true, result: 'failed' }));
  });
});

/* eslint-enable @typescript-eslint/require-await */
