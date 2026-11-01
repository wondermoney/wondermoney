import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { NotFoundError } from '@utils/errors';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  findOne: vi.fn(),
  generatePresignedUrlForAccountCsv: vi.fn(),
  getAccountCsvBucketName: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('../../../app.js', () => ({
  DI: {
    em: {
      findOne: mocks.findOne,
    },
  },
}));
vi.mock('@service/account/account-csv-import-enqueue.service', () => ({
  default: class AccountCsvImportEnqueueService {
    enqueue = mocks.enqueue;
  },
}));
vi.mock('@service/storage/s3', () => ({
  default: {
    generatePresignedUrlForAccountCsv: mocks.generatePresignedUrlForAccountCsv,
    getAccountCsvBucketName: mocks.getAccountCsvBucketName,
  },
}));
vi.mock('@validators/parser', () => ({ zParse: mocks.zParse }));

import { mockReq, mockRes } from '../../../__tests__/__helpers__/mock-request';
import { getS3PresignedUrlForCsvUpload, startAccountCsvImport } from '../imports';

const user = { appuserKey: 71 };
const tenant = { tenantKey: 113 };

const makeRequest = (overrides: Record<string, unknown> = {}) => ({
  params: { accountId: '41' },
  tenant,
  user,
  ...overrides,
}) as unknown as Request;

describe('account CSV import authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.zParse.mockImplementation((_schema: unknown, req: Request) => Promise.resolve(req));
    mocks.getAccountCsvBucketName.mockReturnValue('account-transactions-excel-dev');
  });

  it('presigns only an active account owned by the current user and tenant', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'bcp' } });
    mocks.generatePresignedUrlForAccountCsv.mockResolvedValueOnce({ key: 'account-41-upload.csv', presignedUrl: 'https://example.test/upload' });
    const json = vi.fn();

    await getS3PresignedUrlForCsvUpload(makeRequest(), { json } as unknown as Response, vi.fn());

    expect(mocks.findOne).toHaveBeenCalledWith(
      Account,
      { accountKey: '41', accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['accountFinancialInstitutionKey'] },
    );
    expect(mocks.generatePresignedUrlForAccountCsv).toHaveBeenCalledWith('41', 'bcp');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ key: 'account-41-upload.csv' }));
  });

  it('enqueues only an active account owned by the current user and tenant', async () => {
    const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'bcp' } });
    mocks.enqueue.mockResolvedValueOnce({ correlationId: 'csv-1', status: 'queued' });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await startAccountCsvImport(
      makeRequest({ body: { key: 'account-41-upload.csv' }, enqueue: requestEnqueue }),
      { status } as unknown as Response,
      vi.fn(),
    );

    expect(mocks.findOne).toHaveBeenCalledWith(
      Account,
      { accountKey: 41, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['accountFinancialInstitutionKey'] },
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ accountKey: 41, key: 'account-41-upload.csv' }), { enqueue: requestEnqueue });
    expect(status).toHaveBeenCalledWith(202);
  });

  it('presigns a manual account with no financial institution for the generic CSV format', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: null });
    mocks.generatePresignedUrlForAccountCsv.mockResolvedValueOnce({ key: 'account-41-generic-id.csv', presignedUrl: 'https://example.test/upload' });
    const json = vi.fn();
    const next = vi.fn();

    await getS3PresignedUrlForCsvUpload(makeRequest(), { json } as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ csvImportFormat: 'generic', isSupportedBank: false, key: 'account-41-generic-id.csv', presignedUrl: 'https://example.test/upload' });
  });

  it('presigns a supported bank account for its statement export', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'Millennium BCP' } });
    mocks.generatePresignedUrlForAccountCsv.mockResolvedValueOnce({ key: 'account-41-Millennium BCP-id.csv', presignedUrl: 'https://example.test/upload' });
    const json = vi.fn();

    await getS3PresignedUrlForCsvUpload(makeRequest(), { json } as unknown as Response, vi.fn());

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ csvImportFormat: 'bank', isSupportedBank: true }));
  });

  it.each([
    ['no financial institution', null],
    ['an unsupported bank', { name: '1822direkt' }],
  ])('starts a generic CSV import for an account with %s', async (_kind, institution) => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: institution });
    mocks.enqueue.mockResolvedValueOnce({ correlationId: 'csv-2', status: 'queued' });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    await startAccountCsvImport(makeRequest({ body: { key: 'account-41-generic-id.csv' } }), { status } as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ accountKey: 41, bankName: undefined, key: 'account-41-generic-id.csv' }), expect.anything());
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: 'csv-2', status: 'queued' });
  });

  it.each([
    ['partner/shared', 51],
    ['foreign-tenant', 52],
    ['deleted', 53],
  ])('rejects a %s account before presigning', async (_kind, accountId) => {
    mocks.findOne.mockResolvedValueOnce(null);
    const next = vi.fn();

    await getS3PresignedUrlForCsvUpload(makeRequest({ params: { accountId: String(accountId) } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account not found' }));
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundError);
    expect(mocks.generatePresignedUrlForAccountCsv).not.toHaveBeenCalled();
    expect(mocks.findOne).toHaveBeenCalledWith(
      Account,
      { accountKey: String(accountId), accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['accountFinancialInstitutionKey'] },
    );
  });

  it.each([
    ['partner/shared', 51],
    ['foreign-tenant', 52],
    ['deleted', 53],
  ])('rejects a %s account before enqueueing', async (_kind, accountId) => {
    mocks.findOne.mockResolvedValueOnce(null);
    const next = vi.fn();

    await startAccountCsvImport(
      makeRequest({ body: { key: `account-${accountId}-upload.csv` }, params: { accountId: String(accountId) } }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account not found' }));
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundError);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.findOne).toHaveBeenCalledWith(
      Account,
      { accountKey: accountId, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['accountFinancialInstitutionKey'] },
    );
  });

  it('requires authenticated user and tenant context before account lookup', async () => {
    const next = vi.fn();

    await expect(getS3PresignedUrlForCsvUpload(Object.assign(mockReq({ params: { accountId: '41' } }), { user }), mockRes(), next)).rejects.toThrow('Tenant is not resolved');

    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.generatePresignedUrlForAccountCsv).not.toHaveBeenCalled();
  });
});
