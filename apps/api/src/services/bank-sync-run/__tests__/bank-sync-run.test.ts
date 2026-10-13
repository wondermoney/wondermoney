import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyBankSyncError,
  runBankSyncPhases,
  safeAccountCount,
  safeInstitutionId,
} from '@service/bank-sync-run/bank-sync-run';

const PERMANENT_INITIAL = ['BadRequestError', 'ConflictError', 'NotFoundError', 'ValidationError'];
const PERMANENT_AUTO = [...PERMANENT_INITIAL, 'EnableBankingCredentialInvalidError'];
const AUTO_AUTH_OVERRIDE = [
  { code: 'authentication', match: (error: unknown) => error instanceof Error && error.name === 'EnableBankingCredentialInvalidError' },
] as const;

describe('safeAccountCount', () => {
  it('passes through non-negative integers', () => {
    expect(safeAccountCount(0)).toBe(0);
    expect(safeAccountCount(3)).toBe(3);
  });

  it('drops non-integers and negatives', () => {
    expect(safeAccountCount(undefined)).toBeUndefined();
    expect(safeAccountCount(1.5)).toBeUndefined();
    expect(safeAccountCount(-1)).toBeUndefined();
  });
});

describe('safeInstitutionId', () => {
  it('keeps a single valid id', () => {
    expect(safeInstitutionId(['inst-1'])).toBe('inst-1');
  });

  it('drops empty, multi-id, or malformed values', () => {
    expect(safeInstitutionId(undefined)).toBeUndefined();
    expect(safeInstitutionId([])).toBeUndefined();
    expect(safeInstitutionId(['a', 'b'])).toBeUndefined();
    expect(safeInstitutionId(['has space'])).toBeUndefined();
  });
});

describe('classifyBankSyncError', () => {
  it('marks initial-sync permanent error names as permanent with invalid_requisition', () => {
    const result = classifyBankSyncError(new Error('bad'), { permanentErrorNames: PERMANENT_INITIAL });
    // BadRequestError isn't in the list above; use one that is.
    const notFound = classifyBankSyncError(Object.assign(new Error('x'), { name: 'NotFoundError' }), { permanentErrorNames: PERMANENT_INITIAL });
    expect(notFound).toEqual({ code: 'invalid_requisition', isPermanent: true });
    expect(result.code).toBe('internal');
  });

  it('treats status 400/404 as permanent even when the name is unknown', () => {
    const result = classifyBankSyncError(Object.assign(new Error('x'), { status: 400 }), { permanentErrorNames: [] });
    expect(result).toEqual({ code: 'invalid_requisition', isPermanent: true });
  });

  it('maps ETIMEDOUT/ECONNREFUSED to timeout/provider_unavailable', () => {
    expect(classifyBankSyncError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), { permanentErrorNames: [] })).toEqual({ code: 'timeout', isPermanent: false });
    expect(classifyBankSyncError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), { permanentErrorNames: [] })).toEqual({ code: 'provider_unavailable', isPermanent: false });
  });

  it('falls back to internal for unknown transient errors', () => {
    expect(classifyBankSyncError(new Error('boom'), { permanentErrorNames: [] })).toEqual({ code: 'internal', isPermanent: false });
  });

  it('applies auto-sync extra codes for credential failures', () => {
    const credError = new Error('cred invalid');
    credError.name = 'EnableBankingCredentialInvalidError';
    const result = classifyBankSyncError(credError, { extraCodes: AUTO_AUTH_OVERRIDE, permanentErrorNames: PERMANENT_AUTO });
    expect(result).toEqual({ code: 'authentication', isPermanent: true });
  });
});

describe('runBankSyncPhases', () => {
  const correlationId = 'corr-1';
  const queueJobId = 'job-1';
  const key = 12;

  function harness() {
    return {
      accountService: { syncAccountsForRequisition: vi.fn() },
      transactionService: { syncTransactionsForRequisition: vi.fn() },
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('returns full_success when both phases succeed', async () => {
    const h = harness();
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
    h.accountService.syncAccountsForRequisition.mockResolvedValueOnce({ accountsTotal: 3, institutionIds: ['inst-1'], status: 'completed' });
    h.transactionService.syncTransactionsForRequisition.mockResolvedValueOnce({ status: 'completed' });
    const result = await runBankSyncPhases({
      accountService: h.accountService,
      correlationId,
      enableBankingConnectionKey: key,
      enqueue,
      fetchWindowDays: 365,
      queueJobId,
      transactionService: h.transactionService,
    });
    expect(result.status).toBe('full_success');
    expect(result.account).toEqual({ accountsTotal: 3, institutionIds: ['inst-1'], status: 'full_success' });
    expect(result.failedAt).toBeUndefined();
    expect(h.transactionService.syncTransactionsForRequisition).toHaveBeenCalledWith(expect.any(Object), { enqueue });
  });

  it('returns failed at the account phase without running transaction', async () => {
    const h = harness();
    h.accountService.syncAccountsForRequisition.mockResolvedValueOnce({ status: 'failed' });
    const result = await runBankSyncPhases({
      accountService: h.accountService,
      correlationId,
      enableBankingConnectionKey: key,
      fetchWindowDays: 365,
      queueJobId,
      transactionService: h.transactionService,
    });
    expect(result.status).toBe('failed');
    expect(result.failedAt).toBe('account');
    expect(h.transactionService.syncTransactionsForRequisition).not.toHaveBeenCalled();
  });

  it('returns failed at the transaction phase when account succeeded', async () => {
    const h = harness();
    h.accountService.syncAccountsForRequisition.mockResolvedValueOnce({ status: 'completed' });
    h.transactionService.syncTransactionsForRequisition.mockResolvedValueOnce({ status: 'failed' });
    const result = await runBankSyncPhases({
      accountService: h.accountService,
      correlationId,
      enableBankingConnectionKey: key,
      fetchWindowDays: 365,
      queueJobId,
      transactionService: h.transactionService,
    });
    expect(result.status).toBe('failed');
    expect(result.failedAt).toBe('transaction');
  });

  it('collapses either-side partial into partial', async () => {
    const h = harness();
    h.accountService.syncAccountsForRequisition.mockResolvedValueOnce({ status: 'completed' });
    h.transactionService.syncTransactionsForRequisition.mockResolvedValueOnce({ status: 'partial' });
    const result = await runBankSyncPhases({
      accountService: h.accountService,
      correlationId,
      enableBankingConnectionKey: key,
      fetchWindowDays: 365,
      queueJobId,
      transactionService: h.transactionService,
    });
    expect(result.status).toBe('partial');
  });

  it('runs prePhase before the account phase', async () => {
    const h = harness();
    const order: string[] = [];
    h.accountService.syncAccountsForRequisition.mockImplementationOnce(async () => { order.push('account'); return { status: 'completed' }; });
    h.transactionService.syncTransactionsForRequisition.mockImplementationOnce(async () => { order.push('transaction'); return { status: 'completed' }; });
    await runBankSyncPhases({
      accountService: h.accountService,
      correlationId,
      enableBankingConnectionKey: key,
      fetchWindowDays: 5,
      prePhase: async () => { order.push('pre'); },
      queueJobId,
      transactionService: h.transactionService,
    });
    expect(order).toEqual(['pre', 'account', 'transaction']);
  });
});
