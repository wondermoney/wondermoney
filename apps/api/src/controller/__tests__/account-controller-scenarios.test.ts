import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  count: vi.fn(() => Promise.resolve(0)),
  createImportSession: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  getAccountCsvBucketName: vi.fn().mockReturnValue('account-transactions-excel-dev'),
  presignedUrl: vi.fn(),
}));

// The mocked EntityManager answers every query with the scenario's rows; the household has made no
// "counts as spending" choices.
vi.mock('@service/transaction/category-spending', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/transaction/category-spending')>();
  return { ...actual, loadCategorySpendingFlags: () => Promise.resolve(new actual.CategorySpendingFlags()) };
});
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

vi.mock('@service/transaction-import/transaction-import.service', () => ({
  TransactionImportService: class TransactionImportService {
    create = mocked.createImportSession;
  },
}));

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

describe('account controller scenarios', () => {
  beforeEach(() => {
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.createImportSession.mockReset().mockResolvedValue({ correlationId: 'import:parse:1', id: 'session-1' });
    mocked.getAccountCsvBucketName.mockReset().mockReturnValue('account-transactions-excel-dev');
    mocked.presignedUrl.mockReset();
  });

  it('fails category spending when tenant context is missing', async () => {
    await expect(
      getCategorySpending(Object.assign(mockReq({ query: { limit: 10 } }), { user: { appuserKey: 1 } }), mockRes({ json: vi.fn() }), vi.fn()),
    ).rejects.toThrow('Tenant is not resolved');

    expect(mocked.find).not.toHaveBeenCalled();
  });

  it('stages an import for an account whose bank has no parser of its own', async () => {
    const requestEnqueue = { send: vi.fn(), sendAfter: vi.fn() };
    mocked.findOne.mockResolvedValueOnce({ accountFinancialInstitutionKey: { name: 'Bank XYZ' }, accountKey: 1 });
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { bankName: 'Custom Bank', key: 'account-1-bank-file.csv' }, params: { accountId: '1' } }), { enqueue: requestEnqueue, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status: vi.fn(() => ({ json: vi.fn() })) }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.createImportSession).toHaveBeenCalledWith({ appuserKey: 1, tenantKey: 7 }, expect.objectContaining({ accountId: 1, autoCommit: true, key: 'account-1-bank-file.csv' }));
  });

  it('rejects unsafe csv import object keys before staging an import', async () => {
    mocked.findOne.mockResolvedValueOnce({ accountKey: 1 });
    const next = vi.fn();

    await startAccountCsvImport(
      Object.assign(mockReq({ body: { key: `account-1-${'a'.repeat(180)}.csv` }, params: { accountId: '1' } }), { tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ status: vi.fn() }),
      next,
    );

    expect(mocked.createImportSession).not.toHaveBeenCalled();
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
