import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bossMock } = vi.hoisted(() => ({ bossMock: { createQueue: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('job-1'), start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) } }));

import AccountCsvImportEnqueueService from '@service/account/account-csv-import-enqueue.service';

type EnqueueDeps = Parameters<AccountCsvImportEnqueueService['enqueue']>[1];

describe('account csv import enqueue service', () => {
  beforeEach(() => {
    bossMock.createQueue.mockClear();
    bossMock.send.mockReset().mockResolvedValue('job-1');
    bossMock.start.mockClear();
    bossMock.stop.mockClear();
  });

  it('starts and stops boss and assigns account context', async () => {
    const bg = { attachQueueJob: vi.fn().mockResolvedValue(true), createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'c', retryable: true }), markNeedsAction: vi.fn() };
    const boss = bossMock;
    const em = { findOne: vi.fn().mockResolvedValue({ accountOwnerAppuserKey: { appuserKey: 7 }, tenantKey: { tenantKey: 8 } }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() };
    const svc = new AccountCsvImportEnqueueService();
    await expect(svc.enqueue({ accountKey: 1, bankName: 'Millennium BCP', bucket: 'b', key: 'k' }, { backgroundOperationService: bg, em, enqueue: { send: bossMock.send } } as unknown as EnqueueDeps)).resolves.toEqual(expect.objectContaining({ correlationId: 'c', retryable: true }));
    expect(bg.createQueuedOperation).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'account-csv-import:1:Millennium%20BCP:b:k' }));
    expect(boss.send).toHaveBeenCalledWith('account.csv-import', expect.objectContaining({ bankName: 'Millennium BCP' }), expect.any(Object));
    expect(boss.start).not.toHaveBeenCalled();
    expect(boss.stop).not.toHaveBeenCalled();
    expect(em.persist).toHaveBeenCalled();
  });

  it('throws when account missing', async () => {
    const svc = new AccountCsvImportEnqueueService();
    await expect(svc.enqueue({ accountKey: 1, bucket: 'b', key: 'k' }, { backgroundOperationService: { attachQueueJob: vi.fn(), createQueuedOperation: vi.fn(), markNeedsAction: vi.fn() }, em: { findOne: vi.fn().mockResolvedValue(null), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() }, enqueue: { send: vi.fn() } } as unknown as EnqueueDeps)).rejects.toThrow('Account not found');
  });

  it('marks needs action without owning boss when send returns null', async () => {
    bossMock.send.mockResolvedValueOnce(null);
    const bg = { attachQueueJob: vi.fn(), createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'csv-corr', retryable: true }), markNeedsAction: vi.fn().mockResolvedValue(true) };
    const em = { findOne: vi.fn().mockResolvedValue({ accountOwnerAppuserKey: { appuserKey: 7 }, tenantKey: { tenantKey: 8 } }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() };
    const svc = new AccountCsvImportEnqueueService();

    await expect(svc.enqueue({ accountKey: 1, bucket: 'b', key: 'k' }, { backgroundOperationService: bg, em, enqueue: { send: bossMock.send } } as unknown as EnqueueDeps)).rejects.toMatchObject({ queueAccepted: false });

    expect(bg.markNeedsAction).toHaveBeenCalledWith('account.csv-import:1:k', 'account.csv-import:enqueue-null', 'account.csv-import:queueing');
    expect(bossMock.stop).not.toHaveBeenCalled();
  });

  it('marks needs action without owning boss when accepted job cannot attach', async () => {
    const bg = { attachQueueJob: vi.fn().mockResolvedValue(false), createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'csv-corr', retryable: true }), markNeedsAction: vi.fn().mockResolvedValue(true) };
    const em = { findOne: vi.fn().mockResolvedValue({ accountOwnerAppuserKey: { appuserKey: 7 }, tenantKey: { tenantKey: 8 } }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() };
    const svc = new AccountCsvImportEnqueueService();

    await expect(svc.enqueue({ accountKey: 1, bucket: 'b', key: 'k' }, { backgroundOperationService: bg, em, enqueue: { send: bossMock.send } } as unknown as EnqueueDeps)).rejects.toMatchObject({ queueAccepted: true });

    expect(bg.markNeedsAction).toHaveBeenCalledWith('account.csv-import:1:k', 'account.csv-import:attach-false', 'account.csv-import:queueing');
    expect(bossMock.stop).not.toHaveBeenCalled();
  });

  it('marks needs action when enqueue fails after operation creation', async () => {
    const bg = { attachQueueJob: vi.fn(), createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'csv-corr', retryable: true }), markNeedsAction: vi.fn().mockResolvedValue(true) };
    const em = { findOne: vi.fn().mockResolvedValue({ accountOwnerAppuserKey: { appuserKey: 7 }, tenantKey: { tenantKey: 8 } }), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() };
    const svc = new AccountCsvImportEnqueueService();
    bossMock.send.mockRejectedValueOnce(new Error('send boom'));

    await expect(svc.enqueue({ accountKey: 1, bucket: 'b', key: 'k' }, { backgroundOperationService: bg, em, enqueue: { send: bossMock.send } } as unknown as EnqueueDeps)).rejects.toMatchObject({ queueAccepted: false });
    expect(bg.markNeedsAction).toHaveBeenCalledWith('account.csv-import:1:k', 'account.csv-import:enqueue-failed', 'account.csv-import:queueing');
  });
});
