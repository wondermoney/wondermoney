import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';

const mocked = vi.hoisted(() => ({
  count: vi.fn(() => Promise.resolve(0)),
  csvImportEnqueue: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  getAccountCsvBucketName: vi.fn().mockReturnValue('account-transactions-excel-dev'),
  presignedUrl: vi.fn(),
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema, req: unknown) => Promise.resolve(req)),
}));

vi.mock('../../app.js', () => ({
  DI: {
    em: {
      count: mocked.count,
      find: mocked.find,
      findOne: mocked.findOne,
    },
  },
}));

// The facet counts reach the same EntityManager through
// `@app/database/di`, which `app.js` re-exports. Both specifiers resolve to the
// one DI object at runtime, but a module mock is keyed on the specifier.
vi.mock('@app/database/di', () => ({
  DI: {
    em: {
      count: mocked.count,
      find: mocked.find,
      findOne: mocked.findOne,
    },
  },
}));

vi.mock('@service/account/account-csv-import-enqueue.service', () => ({ default: class AccountCsvImportEnqueueService { enqueue = mocked.csvImportEnqueue; } }));

vi.mock('@service/storage/s3', () => ({
  default: {
    generatePresignedUrlForAccountCsv: mocked.presignedUrl,
    getAccountCsvBucketName: mocked.getAccountCsvBucketName,
    getFilesBucketName: vi.fn().mockReturnValue('example-files-bucket'),
    uploadFile: vi.fn().mockResolvedValue('https://example-files-bucket.s3.eu-west-2.amazonaws.com/wmocr/test.png'),
  },
}));

vi.mock('../../services/ai/openai', () => ({
  default: {},
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { getCategorySpending, getS3PresignedUrlForCsvUpload, sanitizeLlmResponse, startAccountCsvImport } from '../account';

function collection<T>(items: T[]) {
  return {
    getItems: () => items,
  };
}

describe('account controller scenarios', () => {
  beforeEach(() => {
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.csvImportEnqueue.mockReset();
    mocked.getAccountCsvBucketName.mockReset().mockReturnValue('account-transactions-excel-dev');
    mocked.presignedUrl.mockReset();
  });

  it('returns category spending using edited amounts and ignores edited positive transactions', async () => {
    mocked.find
      .mockResolvedValueOnce([{ accountKey: 1 }])
      .mockResolvedValueOnce([
        {
          appuserCurrencyKey: { code: 'EUR' },
          appuserSettlementAmount: -40,
          appuserTransactionCategories: collection([
            {
              categoryKey: {
                bgColor: '#111111',
                categoryKey: 1,
                icon: 'fork-knife',
                isSystemCategory: true,
                name: 'Food',
                parentCategory: null,
                textColor: '#ffffff',
              },
            },
          ]),
          editedSettlementAmount: -40,
          transactionKey: 1,
        },
        {
          appuserCurrencyKey: { code: 'EUR' },
          appuserSettlementAmount: 20,
          appuserTransactionCategories: collection([
            {
              categoryKey: {
                bgColor: '#222222',
                categoryKey: 2,
                icon: 'car',
                isSystemCategory: true,
                name: 'Transport',
                parentCategory: null,
                textColor: '#ffffff',
              },
            },
          ]),
          editedSettlementAmount: 20,
          transactionKey: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          feeAmount: 5,
          interestAmount: 15,
          principalAmount: 20,
          transactionKey: { transactionKey: 1 },
        },
      ]);

    const json = vi.fn();
    const next = vi.fn();

    await getCategorySpending(
      Object.assign(mockReq({ query: { limit: 10 } }), { tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ json }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.find).toHaveBeenNthCalledWith(1, Account, {
      $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 1 } }],
      deletedAt: undefined,
      tenantKey: { tenantKey: 7 },
    });
    expect(mocked.find).toHaveBeenNthCalledWith(
      2,
      Transaction,
      expect.objectContaining({
        accountKey: { $in: [{ accountKey: 1 }] },
        deletedAt: undefined,
        tenantKey: { tenantKey: 7 },
      }),
      expect.objectContaining({ populate: expect.arrayContaining(['appuserCurrencyKey']) }),
    );
    expect(json).toHaveBeenCalledWith({
      categorySpending: [
        expect.objectContaining({
          amount: 20,
          categoryKey: 1,
          currency: 'EUR',
          name: 'Food',
          numTransactions: 1,
        }),
      ],
    });
  });

  it('returns empty category spending when the user has no accounts', async () => {
    mocked.find.mockResolvedValueOnce([]);

    const json = vi.fn();
    const next = vi.fn();

    await getCategorySpending(
      Object.assign(mockReq({ query: { limit: 10 } }), { tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ json }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.find).toHaveBeenCalledTimes(1);
    expect(mocked.find).toHaveBeenCalledWith(Account, {
      $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 1 } }],
      deletedAt: undefined,
      tenantKey: { tenantKey: 7 },
    });
    expect(json).toHaveBeenCalledWith({ categorySpending: [] });
  });

  it('fails category spending when tenant context is missing', async () => {
    await expect(
      getCategorySpending(Object.assign(mockReq({ query: { limit: 10 } }), { user: { appuserKey: 1 } }), mockRes({ json: vi.fn() }), vi.fn()),
    ).rejects.toThrow('Tenant is not resolved');

    expect(mocked.find).not.toHaveBeenCalled();
  });

  it('starts a csv import operation using a server-derived supported bank', async () => {
    const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
    mocked.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'bCp' }, accountKey: 1 });
    mocked.csvImportEnqueue.mockResolvedValueOnce({ correlationId: 'csv-corr', status: 'queued' });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { key: 'account-1-bank-file.csv' }, params: { accountId: '1' } }), { enqueue: requestEnqueue, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.csvImportEnqueue).toHaveBeenCalledWith(expect.objectContaining({ accountKey: 1, bankName: 'bCp', bucket: 'account-transactions-excel-dev', key: 'account-1-bank-file.csv' }), { enqueue: requestEnqueue });
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: 'csv-corr', status: 'queued' });
  });

  it('enqueues undefined bank name for unsupported server-derived banks', async () => {
    const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
    mocked.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'Bank XYZ' }, accountKey: 1 });
    mocked.csvImportEnqueue.mockResolvedValueOnce({ correlationId: 'csv-corr', status: 'queued' });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { bankName: 'Custom Bank', key: 'account-1-bank-file.csv' }, params: { accountId: '1' } }), { enqueue: requestEnqueue, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.csvImportEnqueue).toHaveBeenCalledWith(expect.objectContaining({ bankName: undefined }), { enqueue: requestEnqueue });
  });

  it('does not let a client-provided bank name override the server-derived supported bank', async () => {
    const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
    mocked.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'bcp' }, accountKey: 1 });
    mocked.csvImportEnqueue.mockResolvedValueOnce({ correlationId: 'csv-corr', status: 'queued' });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { bankName: 'Custom Bank', key: 'account-1-bank-file.csv' }, params: { accountId: '1' } }), { enqueue: requestEnqueue, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.csvImportEnqueue).toHaveBeenCalledWith(expect.objectContaining({ bankName: 'bcp' }), { enqueue: requestEnqueue });
  });

  it('rejects unsafe csv import object keys before enqueueing', async () => {
    mocked.findOne.mockResolvedValueOnce({ accountKey: 1 });
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { key: `account-1-${'a'.repeat(180)}.csv` }, params: { accountId: '1' } }), { tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status: vi.fn() }),
      next,
    );

    expect(mocked.csvImportEnqueue).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid CSV object key' }));
  });

  it('keeps a valid OCR response with the maximum accepted merchant length', () => {
    const response = JSON.stringify({
      settlementAmount: 1234567890.12,
      settlementCurrency: 'EUR',
      transactionDate: '2026-06-04T12:34:56.000Z',
      transactionMerchantName: 'M'.repeat(200),
    });

    expect(response.length).toBeGreaterThan(255);
    expect(sanitizeLlmResponse(response)).toBe(response);
  });

  it('truncates unexpectedly long OCR responses before persistence', () => {
    const longResponse = 'x'.repeat(1500);

    expect(sanitizeLlmResponse(longResponse)).toHaveLength(1024);
    expect(sanitizeLlmResponse(longResponse)).toBe(longResponse.slice(0, 1024));
    expect(sanitizeLlmResponse('')).toBeUndefined();
  });

  it('returns the generated account csv key with the presigned url', async () => {
    mocked.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'NORD/LB: Demo Bank' } });
    mocked.presignedUrl.mockResolvedValueOnce({ key: 'account-1-NORD_LB__Demo_Bank-upload-id.csv', presignedUrl: 'https://example.com/account.csv' });

    const json = vi.fn();
    const next = vi.fn();

    await getS3PresignedUrlForCsvUpload(Object.assign(mockReq({ params: { accountId: '1' } }), { tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }), mockRes({ json }), next);

    expect(json).toHaveBeenCalledWith({
      csvImportFormat: 'generic',
      isSupportedBank: false,
      key: 'account-1-NORD_LB__Demo_Bank-upload-id.csv',
      presignedUrl: 'https://example.com/account.csv',
    });
  });
});
