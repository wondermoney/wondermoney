import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aiCapabilities: vi.fn(),
  createTransaction: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  getAppuserTenantByAppuser: vi.fn(),
  getFilesBucketName: vi.fn().mockReturnValue('example-files-bucket'),
  isStorageEnabled: vi.fn(),
  persist: vi.fn(),
  processReceipt: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('../../../app.js', () => ({
  DI: {
    em: {
      findOne: mocks.findOne,
      getRepository: vi.fn(() => ({ getAppuserTenantByAppuser: mocks.getAppuserTenantByAppuser })),
      persist: mocks.persist,
    },
  },
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

vi.mock('@service/storage/s3', () => ({
  default: {
    getFilesBucketName: mocks.getFilesBucketName,
    isEnabled: mocks.isStorageEnabled,
    uploadFile: mocks.uploadFile,
  },
}));

vi.mock('@service/ai/ai-provider', () => ({ aiCapabilities: mocks.aiCapabilities }));

vi.mock('@service/ai/openai', () => ({
  default: { processReceipt: mocks.processReceipt },
}));

vi.mock('@service/transaction/transaction-creation.service', () => ({
  transactionCreationService: { createTransaction: mocks.createTransaction },
}));

import { confirmTransactionOCRImportAndCreateTransaction, createTransactionOCRImport } from '../ocr';

const makeResponse = () => ({ json: vi.fn(), sendStatus: vi.fn() }) as unknown as Response;

describe('createTransactionOCRImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flush.mockResolvedValue(undefined);
    mocks.persist.mockReturnValue({ flush: mocks.flush });
    mocks.findOne.mockResolvedValue({ appuserKey: 1, externalUserId: 'ext-user-1' });
    mocks.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: 42 });
    mocks.aiCapabilities.mockReturnValue({ ocr: true });
    mocks.isStorageEnabled.mockReturnValue(true);
    mocks.uploadFile.mockResolvedValue('https://example-files-bucket.s3.eu-west-2.amazonaws.com/wmocr/transaction_ocr_ext-user-1.123.png');
    // Short-circuit the flow right after upload so the test stays focused on the storage call.
    mocks.processReceipt.mockResolvedValue({ answer: null, tokens: 0 });
  });

  it('uploads the receipt to the S3 files bucket under the OCR prefix', async () => {
    const fileBuffer = Buffer.from('fake-image-bytes');
    const req = {
      file: {
        buffer: fileBuffer,
        mimetype: 'image/png',
      },
      user: { appuserKey: 1 },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    await createTransactionOCRImport(req, res, next);

    expect(mocks.getFilesBucketName).toHaveBeenCalled();
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    const [bucket, key, content, contentType] = mocks.uploadFile.mock.calls[0] as [string, string, Buffer, string];
    expect(bucket).toBe('example-files-bucket');
    expect(key).toMatch(/^wmocr\/transaction_ocr_ext-user-1\.\d+\.png$/);
    expect(content).toBe(fileBuffer);
    expect(contentType).toBe('image/png');

    // The uploaded URL from S3 must be persisted on the OCR import record.
    const persistedEntity = mocks.persist.mock.calls[0]?.[0] as undefined | { fileUrl?: string };
    expect(persistedEntity?.fileUrl).toBe('https://example-files-bucket.s3.eu-west-2.amazonaws.com/wmocr/transaction_ocr_ext-user-1.123.png');
  });

  const receiptRequest = () => ({ file: { buffer: Buffer.from('img'), mimetype: 'image/png' }, user: { appuserKey: 1 } }) as unknown as Request;

  it('reports receipt scanning as disabled, before storing anything, without a vision model', async () => {
    mocks.aiCapabilities.mockReturnValue({ ocr: false });
    const next = vi.fn() as NextFunction;

    await createTransactionOCRImport(receiptRequest(), makeResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'feature_disabled' }));
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('still scans the receipt when file storage is not configured, recording no file', async () => {
    mocks.isStorageEnabled.mockReturnValue(false);

    await createTransactionOCRImport(receiptRequest(), makeResponse(), vi.fn() as NextFunction);

    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.processReceipt).toHaveBeenCalled();
    expect((mocks.persist.mock.calls[0]?.[0] as { fileUrl?: string }).fileUrl).toBe('');
  });
});

describe('confirmTransactionOCRImportAndCreateTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persist.mockReturnValue({ flush: mocks.flush });
    mocks.flush.mockResolvedValue(undefined);
    mocks.createTransaction.mockResolvedValue({ transactionKey: 99 });
  });

  const baseBody = {
    accountId: 3,
    settlementAmount: 10,
    settlementCurrencyId: 1,
    transactionDate: new Date('2026-07-01'),
    transactionTypeId: 2,
  };

  // The validated `categoryIds` field must reach createTransaction, or OCR imports are always uncategorized.
  it('passes the chosen category (categoryIds[0]) through to createTransaction', async () => {
    mocks.findOne
      .mockResolvedValueOnce({ transactionOCRImportKey: 5 }) // TransactionOCRImport lookup
      .mockResolvedValueOnce({ accountKey: 3 }); // Account lookup

    const req = {
      body: { ...baseBody, categoryIds: [27, 28] },
      params: { transactionOCRImportId: 5 },
      user: { appuserKey: 1 },
    } as unknown as Request;
    const sendStatus = vi.fn();
    const res = { json: vi.fn(), sendStatus } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await confirmTransactionOCRImportAndCreateTransaction(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 27 }));
    expect(sendStatus).toHaveBeenCalledWith(201);
  });

  it('passes categoryId undefined when no category is chosen', async () => {
    mocks.findOne
      .mockResolvedValueOnce({ transactionOCRImportKey: 5 })
      .mockResolvedValueOnce({ accountKey: 3 });

    const req = {
      body: { ...baseBody },
      params: { transactionOCRImportId: 5 },
      user: { appuserKey: 1 },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    await confirmTransactionOCRImportAndCreateTransaction(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ categoryId: undefined }));
  });
});
