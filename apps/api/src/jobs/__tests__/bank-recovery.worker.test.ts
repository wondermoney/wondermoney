import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SendBankRecoveryClaimInput, SendBankRecoveryClaimResult } from '@service/bank-sync/bank-recovery.service';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

const findOne = vi.fn();
vi.mock('@app/database/di', () => ({ DI: { em: { findOne } } }));

const { handleBankRecoveryJob } = await import('@app/jobs/bank-recovery.worker');
const { FRONTEND_URL } = await import('@utils/constants');

type BankRecoveryJob = Parameters<typeof handleBankRecoveryJob>[0];
const job = (data: unknown, id: string): BankRecoveryJob => pgBossJob(data, { id }) as unknown as BankRecoveryJob;

const incidentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = { deliveryKey: 60, incidentId, templateVersion: 'bank-recovery.v1' };

function harness(incidentOverrides: Record<string, unknown> = {}) {
  const sendEmail = vi.fn().mockResolvedValue({ messageId: 'message-1' });
  const claim = vi.fn().mockResolvedValue({
    claimToken: 'claim-token',
    delivery: { bankRecoveryDeliveryKey: 60, templateVersion: 'bank-recovery.v1' },
    incident: { incidentId, ...incidentOverrides },
  });
  const sendClaim = vi.fn(
    async (input: SendBankRecoveryClaimInput): Promise<SendBankRecoveryClaimResult> => ({
      authorized: true,
      outcome: await input.send({
        appuser: { appuserKey: 1, emailAddress: 'private@example.com', language: 'PT' },
        signal: new AbortController().signal,
      } as unknown as Parameters<SendBankRecoveryClaimInput['send']>[0]),
      shouldRetry: false,
    }),
  );
  const logger = { info: vi.fn(), warn: vi.fn() };
  const optOutService = { generateCategoryToken: vi.fn(() => 'stub-token') };
  return { claim, logger, optOutService, sendClaim, sendEmail };
}

describe('bank recovery send worker', () => {
  beforeEach(() => {
    findOne.mockReset();
    findOne.mockResolvedValue(null);
  });

  it('resolves the real bank display name from the incident institution id', async () => {
    const h = harness({ institutionId: 'inst-123' });
    findOne.mockResolvedValueOnce({ displayName: 'Banco Exemplo' });
    await handleBankRecoveryJob(job(payload, 'job-60'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim },
      logger: h.logger, optOutService: h.optOutService, sendEmail: h.sendEmail,
    });
    expect(findOne).toHaveBeenCalledWith(expect.anything(), { id: 'inst-123' });
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ bankName: 'Banco Exemplo' }));
  });

  it('sends without a bank name when the incident has no institution id', async () => {
    const h = harness();
    await handleBankRecoveryJob(job(payload, 'job-60'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim },
      logger: h.logger, optOutService: h.optOutService, sendEmail: h.sendEmail,
    });
    expect(findOne).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ bankName: undefined }));
  });

  it('claims for five minutes, verifies identity, and maps accepted email structurally', async () => {
    const h = harness();
    await expect(handleBankRecoveryJob(job(payload, 'job-60'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim },
      env: { FRONTEND_URL: 'https://attacker.example' }, logger: h.logger, optOutService: h.optOutService, sendEmail: h.sendEmail,
    })).resolves.toBe(true);
    expect(h.claim).toHaveBeenCalledWith(60, 'job-60', 300_000);
    expect(h.sendEmail).toHaveBeenCalledWith({
      incidentId, language: 'PT', recipient: 'private@example.com', recoveryUrl: `${FRONTEND_URL}/pt/accounts`,
      signal: expect.any(AbortSignal), templateVersion: 'bank-recovery.v1', unsubscribeUrl: expect.stringContaining('token=stub-token'),
    });
    expect(h.optOutService.generateCategoryToken).toHaveBeenCalledWith(1, 'ACCOUNT_RECOVERY');
    await expect(h.sendClaim.mock.results[0]?.value).resolves.toMatchObject({ outcome: { messageId: 'message-1', type: 'accepted' } });
  });

  it('throws only when the service proves a durable retry is authorized', async () => {
    const h = harness();
    h.sendClaim.mockResolvedValueOnce({ authorized: true, outcome: { code: 'provider_rate_limited', type: 'pre_acceptance_retryable' }, shouldRetry: true });
    await expect(handleBankRecoveryJob(job(payload, 'job-60'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).rejects.toThrow('before acceptance');

    h.sendClaim.mockResolvedValueOnce({ authorized: true, outcome: { code: 'attempt_cap', type: 'pre_acceptance_retryable' }, shouldRetry: false });
    await expect(handleBankRecoveryJob(job(payload, 'job-61'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).resolves.toBe(true);
  });

  it.each<[string, SendBankRecoveryClaimResult]>([
    ['permanent', { authorized: true, outcome: { code: 'invalid_recipient', type: 'pre_acceptance_permanent' }, shouldRetry: false }],
    ['ambiguous', { authorized: true, outcome: { code: 'provider_timeout', type: 'ambiguous' }, shouldRetry: false }],
    ['suppressed', { authorized: false, reason: 'rollout_ineligible', shouldRetry: false }],
  ])('does not queue-retry a %s result', async (_name, result) => {
    const h = harness();
    h.sendClaim.mockResolvedValueOnce(result);
    await expect(handleBankRecoveryJob(job(payload, 'job'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).resolves.toBe(true);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('returns false without provider work for a concurrent/stale null claim', async () => {
    const h = harness();
    h.claim.mockResolvedValueOnce(null);
    await expect(handleBankRecoveryJob(job(payload, 'job'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).resolves.toBe(false);
    expect(h.sendClaim).not.toHaveBeenCalled();
  });

  it('rejects strict payloads and claimed delivery mismatches before provider work', async () => {
    const h = harness();
    await expect(handleBankRecoveryJob(job({ ...payload, extra: true }, 'job'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).resolves.toBe(false);
    expect(h.claim).not.toHaveBeenCalled();

    h.claim.mockResolvedValueOnce({ claimToken: 'token', delivery: { templateVersion: 'bank-recovery.v2' }, incident: { incidentId } });
    await expect(handleBankRecoveryJob(job(payload, 'job'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    })).resolves.toBe(false);
    expect(h.sendClaim).not.toHaveBeenCalled();
  });

  it('never places recipient or raw errors in logs', async () => {
    const h = harness();
    h.sendClaim.mockRejectedValueOnce(new Error('private@example.com secret provider detail'));
    await handleBankRecoveryJob(job(payload, 'job'), {
      bankRecoveryService: { claim: h.claim, sendClaim: h.sendClaim }, logger: h.logger,
    });
    expect(JSON.stringify([...h.logger.info.mock.calls, ...h.logger.warn.mock.calls])).not.toContain('private@example.com');
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('secret provider detail');
  });
});
