import { beforeEach, describe, expect, it, vi } from 'vitest';

const em = vi.hoisted(() => ({
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockReturnThis(),
}));

vi.mock('@app/app', () => ({ DI: { em } }));
vi.mock('@app/validators/banking', () => ({ bankConnectionCallbackRequestSchema: {}, bankListByCountryRequestSchema: {}, startBankConnectionRequestSchema: {}, unlinkRequisitionRequestSchema: {} }));
vi.mock('@service/enable-banking/enable-banking-client.service', () => ({ createEnableBankingClient: vi.fn() }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({
  enableBankingCredentialService: { decryptCredentialEntity: vi.fn(), getActiveCredentialEntity: vi.fn(), getDecryptedCredential: vi.fn() },
}));
vi.mock('@utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const zParse = vi.hoisted(() => vi.fn());
vi.mock('@app/validators/parser', () => ({ zParse }));

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { unlinkRequisition } from '../banking';

describe('unlinkRequisition (Enable Banking connection)', () => {
  beforeEach(() => {
    em.findOne.mockReset();
    em.flush.mockReset();
    em.flush.mockResolvedValue(undefined);
    em.persist.mockReset();
    em.persist.mockReturnThis();
    zParse.mockReset();
    zParse.mockResolvedValue({ params: { requisitionId: 'req-123' } });
  });

  const createReq = () => ({ tenant: { tenantKey: 113 }, user: { appuserKey: 42 } });

  it('returns not found when the connection never belonged to this user', async () => {
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const req = createReq();
    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await unlinkRequisition(req as unknown as Parameters<typeof unlinkRequisition>[0], res, next);

    expect(em.findOne).toHaveBeenNthCalledWith(1, expect.anything(), {
      appuserKey: req.user,
      deletedAt: undefined,
      enableBankingConnectionKey: 'req-123',
      tenantKey: req.tenant,
    });
    expect(em.findOne).toHaveBeenNthCalledWith(2, expect.anything(), {
      appuserKey: req.user,
      enableBankingConnectionKey: 'req-123',
      tenantKey: req.tenant,
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('req-123'), name: 'NotFoundError', status: 404 }));
    expect(em.persist).not.toHaveBeenCalled();
    expect(sendStatus).not.toHaveBeenCalled();
  });

  it('is idempotent when the connection was already unlinked (double-delete/race)', async () => {
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ deletedAt: new Date() });
    const req = createReq();
    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await unlinkRequisition(req as unknown as Parameters<typeof unlinkRequisition>[0], res, next);

    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('soft-deletes an existing local connection', async () => {
    const connection = { deletedAt: undefined };
    em.findOne.mockResolvedValueOnce(connection);
    const req = createReq();
    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await unlinkRequisition(req as unknown as Parameters<typeof unlinkRequisition>[0], res, next);

    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      appuserKey: req.user,
      deletedAt: undefined,
      enableBankingConnectionKey: 'req-123',
      tenantKey: req.tenant,
    });
    expect(connection.deletedAt).toBeInstanceOf(Date);
    expect(em.persist).toHaveBeenCalledWith(connection);
    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates persist failures', async () => {
    const connection = { deletedAt: undefined };
    em.findOne.mockResolvedValueOnce(connection);
    em.flush.mockRejectedValueOnce(new Error('persist failed'));
    const req = createReq();
    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await expect(unlinkRequisition(req as unknown as Parameters<typeof unlinkRequisition>[0], res, next)).rejects.toThrow('persist failed');

    expect(sendStatus).not.toHaveBeenCalled();
  });

  it('fails closed when the request is missing a resolved tenant (RAD-244)', async () => {
    const req = { user: { appuserKey: 42 } };
    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await expect(unlinkRequisition(req as unknown as Parameters<typeof unlinkRequisition>[0], res, next)).rejects.toThrow(/tenant is required/i);
    expect(em.findOne).not.toHaveBeenCalled();
  });
});
