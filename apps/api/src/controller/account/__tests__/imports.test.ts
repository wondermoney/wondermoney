import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { NotFoundError } from '@utils/errors';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findOne: vi.fn(),
  generatePresignedUrlForAccountCsv: vi.fn(),
  getAccountCsvBucketName: vi.fn(),
  getLimitedCsvObjectBuffer: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('../../../app.js', () => ({
  DI: {
    em: {
      findOne: mocks.findOne,
    },
  },
}));
vi.mock('@service/transaction-import/transaction-import.service', () => ({
  TransactionImportService: class TransactionImportService {
    create = mocks.createSession;
  },
}));
vi.mock('@service/account/csv-upload-boundary.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service/account/csv-upload-boundary.service')>()),
  getLimitedCsvObjectBuffer: mocks.getLimitedCsvObjectBuffer,
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

const GENERIC_TEMPLATE = 'date,amount,merchant,internalTransactionId,transactionTypeKey,description\n2026-01-15,23.40,Grocery store,example-1,3,Weekly shop';
const BANK_STATEMENT = 'Data mov.;Descrição;Débito;Crédito\n02-09-2026;CONTINENTE;42,50;';
const OFX = 'OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>';
const QIF = '!Type:Bank\nD15/01/2026\nT-42,50\nPCONTINENTE\n^';

describe('account CSV import authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.zParse.mockImplementation((_schema: unknown, req: Request) => Promise.resolve(req));
    mocks.getAccountCsvBucketName.mockReturnValue('account-transactions-excel-dev');
    mocks.getLimitedCsvObjectBuffer.mockResolvedValue(Buffer.from(GENERIC_TEMPLATE, 'utf8'));
    mocks.createSession.mockResolvedValue({ correlationId: 'import:parse:1', id: 'session-1' });
  });

  const startImport = async (body: Record<string, unknown>, accountId = '41') => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();
    await startAccountCsvImport(makeRequest({ body, params: { accountId } }), { status } as unknown as Response, next);
    return { json, next, status };
  };

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

  it('stages a self-committing import only for an active account owned by the current user and tenant', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: null });

    const { json, status } = await startImport({ key: 'account-41-upload.csv' });

    expect(mocks.findOne).toHaveBeenCalledWith(
      Account,
      { accountKey: 41, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['accountFinancialInstitutionKey'] },
    );
    expect(mocks.createSession).toHaveBeenCalledWith(
      { appuserKey: user.appuserKey, tenantKey: tenant.tenantKey },
      expect.objectContaining({ accountId: 41, autoCommit: true, key: 'account-41-upload.csv' }),
    );
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: 'import:parse:1', importId: 'session-1', status: 'queued' });
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

  it('reads the older generic CSV template with its own adapter, whatever the account bank', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: '1822direkt' } });

    const { next, status } = await startImport({ key: 'account-41-generic-id.csv' });

    expect(next).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoCommit: true, format: 'generic-csv', key: 'account-41-generic-id.csv' }));
    expect(status).toHaveBeenCalledWith(202);
  });

  it.each([
    ['no financial institution', null],
    ['an unsupported bank', { name: '1822direkt' }],
  ])('stages a statement import for an account with %s and a bank export', async (_kind, institution) => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: institution });
    mocks.getLimitedCsvObjectBuffer.mockResolvedValueOnce(Buffer.from(BANK_STATEMENT, 'utf8'));

    const { status } = await startImport({ key: 'account-41-statement.csv' });

    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoCommit: true, format: 'statement' }));
    expect(status).toHaveBeenCalledWith(202);
  });

  it('reads an OFX file with the OFX adapter by its content', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: null });
    mocks.getLimitedCsvObjectBuffer.mockResolvedValueOnce(Buffer.from(OFX, 'utf8'));

    const { status } = await startImport({ key: 'account-41-statement.csv' });

    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoCommit: true, format: 'ofx' }));
    expect(status).toHaveBeenCalledWith(202);
  });

  it('reads a QIF file with the QIF adapter by its content', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: null });
    mocks.getLimitedCsvObjectBuffer.mockResolvedValueOnce(Buffer.from(QIF, 'utf8'));

    const { status } = await startImport({ key: 'account-41-statement.csv' });

    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoCommit: true, format: 'qif' }));
    expect(status).toHaveBeenCalledWith(202);
  });

  it('stages an import the worker reports unreadable when the file cannot be read here', async () => {
    mocks.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: null });
    mocks.getLimitedCsvObjectBuffer.mockRejectedValueOnce(new Error('NoSuchKey'));

    await startImport({ key: 'account-41-missing.csv' });

    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'statement' }));
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
  ])('rejects a %s account before staging an import', async (_kind, accountId) => {
    mocks.findOne.mockResolvedValueOnce(null);
    const next = vi.fn();

    await startAccountCsvImport(
      makeRequest({ body: { key: `account-${accountId}-upload.csv` }, params: { accountId: String(accountId) } }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account not found' }));
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundError);
    expect(mocks.createSession).not.toHaveBeenCalled();
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
