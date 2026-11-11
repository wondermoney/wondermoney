import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

const storage = vi.hoisted(() => {
  const objects = new Map<string, { bytes: Buffer; size: number }>();
  const deleted: string[] = [];
  const state = { enabled: true };
  return {
    deleted,
    objects,
    reset() {
      objects.clear();
      deleted.length = 0;
      state.enabled = true;
    },
    service: {
      deleteObject: vi.fn((_bucket: string, key: string) => {
        deleted.push(key);
        objects.delete(key);
      }),
      generatePresignedUploadUrl: vi.fn((_bucket: string, key: string, options: { contentLength: number }) => `https://storage.test/put/${key}?length=${options.contentLength}`),
      generatePresignedViewUrl: vi.fn((_bucket: string, key: string, _contentType: string, ttl: number) => `https://storage.test/get/${key}?ttl=${ttl}`),
      getFilesBucketName: () => 'test-files',
      getObjectBuffer: vi.fn((_bucket: string, key: string) => objects.get(key)?.bytes ?? Buffer.alloc(0)),
      getObjectSize: vi.fn((_bucket: string, key: string) => objects.get(key)?.size),
      isEnabled: () => state.enabled,
    },
    state,
  };
});

vi.mock('@service/storage/s3', () => ({ default: storage.service }));

import { addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Transaction } from '@entity/Transaction';
import { TransactionAttachment } from '@entity/TransactionAttachment';
import accountRoutes from '@route/account';
import { linkReceiptAttachment, TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES, TRANSACTION_ATTACHMENT_STORAGE_PREFIX } from '@service/transaction/transaction-attachment.service';
import { getRef } from '@utils/em-helpers';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n%âãÏÓ\n');

function attachmentKey(tenantKey: number, name = 'receipt.png'): string {
  return `${TRANSACTION_ATTACHMENT_STORAGE_PREFIX}/${tenantKey}/11111111-1111-4111-8111-111111111111/${name}`;
}

describe('transaction attachments', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  beforeEach(() => { storage.reset(); });

  const seedAttachment = async (household: Household, transactionKey: number, key: string, fileName = 'receipt.png') => {
    const em = db.em();
    const attachment = em.create(TransactionAttachment, {
      contentType: 'image/png',
      fileName,
      sizeBytes: PNG_BYTES.length,
      storageKey: key,
      tenantKey: household.tenant,
      transactionKey: getRef(em, Transaction, transactionKey),
      uploadedByAppuserKey: household.appuser,
    }, { partial: true });
    await em.flush();
    return attachment;
  };

  it('lists a transaction\'s attachments with short-lived presigned URLs', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = attachmentKey(household.tenant.tenantKey);
    await seedAttachment(household, transaction.transactionKey, key);

    const response = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);

    expect(response.status).toBe(200);
    expect(response.body.attachments).toHaveLength(1);
    expect(response.body.attachments[0]).toMatchObject({ contentType: 'image/png', fileName: 'receipt.png' });
    expect(response.body.attachments[0].url).toBe(`https://storage.test/get/${key}?ttl=300`);
  });

  it('confirms an upload after checking the bytes, and records the sniffed type', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = attachmentKey(household.tenant.tenantKey, 'scan');
    storage.objects.set(key, { bytes: PNG_BYTES, size: PNG_BYTES.length });

    const response = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments`).send({ fileName: 'scan', key });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ contentType: 'image/png', fileName: 'scan.png' });

    const listed = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);
    expect(listed.body.attachments).toHaveLength(1);
  });

  it('returns a presigned PUT scoped to the household for a declared type and size', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });

    const response = await http.as(household.appuser)
      .post(`/v1/account/transaction/${transaction.transactionKey}/attachments/upload-url`)
      .send({ contentType: 'application/pdf', fileName: 'invoice.pdf', sizeBytes: 2048 });

    expect(response.status).toBe(200);
    expect(response.body.key.startsWith(`${TRANSACTION_ATTACHMENT_STORAGE_PREFIX}/${household.tenant.tenantKey}/`)).toBe(true);
    expect(response.body.presignedUrl).toContain('https://storage.test/put/');
    expect(response.body.uploadMethod).toBe('PUT');
  });

  it('refuses a declared type or size outside the limits', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const path = `/v1/account/transaction/${transaction.transactionKey}/attachments/upload-url`;

    const wrongType = await http.as(household.appuser).post(path).send({ contentType: 'image/gif', fileName: 'x.gif', sizeBytes: 10 });
    const tooBig = await http.as(household.appuser).post(path).send({ contentType: 'image/png', fileName: 'x.png', sizeBytes: TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES + 1 });

    expect(wrongType.status).toBe(400);
    expect(tooBig.status).toBe(400);
  });

  it('refuses an eleventh file', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    for (let index = 0; index < 10; index += 1) {
      await seedAttachment(household, transaction.transactionKey, attachmentKey(household.tenant.tenantKey, `${index}.png`), `${index}.png`);
    }
    const key = attachmentKey(household.tenant.tenantKey, 'eleventh.png');
    storage.objects.set(key, { bytes: PNG_BYTES, size: PNG_BYTES.length });

    const response = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments`).send({ fileName: 'eleventh.png', key });

    expect(response.status).toBe(400);
    const listed = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);
    expect(listed.body.attachments).toHaveLength(10);
  });

  it('refuses an oversize object and removes it from the store', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = attachmentKey(household.tenant.tenantKey, 'huge.pdf');
    storage.objects.set(key, { bytes: PDF_BYTES, size: TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES + 1 });

    const response = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments`).send({ fileName: 'huge.pdf', key });

    expect(response.status).toBe(400);
    expect(storage.deleted).toContain(key);
  });

  it('refuses a file whose bytes are not an allowed type, whatever it is named', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = attachmentKey(household.tenant.tenantKey, 'fake.pdf');
    storage.objects.set(key, { bytes: Buffer.from('GIF89a-not-a-pdf'), size: 15 });

    const response = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments`).send({ fileName: 'fake.pdf', key });

    expect(response.status).toBe(400);
    expect(storage.deleted).toContain(key);
  });

  it('soft deletes the row and removes the stored object', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = attachmentKey(household.tenant.tenantKey);
    const attachment = await seedAttachment(household, transaction.transactionKey, key);
    storage.objects.set(key, { bytes: PNG_BYTES, size: PNG_BYTES.length });

    const response = await http.as(household.appuser).delete(`/v1/account/transaction/${transaction.transactionKey}/attachments/${attachment.transactionAttachmentKey}`);

    expect(response.status).toBe(204);
    expect(storage.deleted).toContain(key);
    const listed = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);
    expect(listed.body.attachments).toHaveLength(0);
  });

  it('hides another household\'s attachment metadata and refuses its key', async () => {
    const owner = await seedHousehold(db.em());
    const other = await seedHousehold(db.em());
    const ownerTransaction = await addTransaction(db.em(), owner, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const otherTransaction = await addTransaction(db.em(), other, { amount: -8, date: new Date('2026-07-21T10:00:00.000Z'), status: 'BOOKED' });
    const ownerKey = attachmentKey(owner.tenant.tenantKey);
    const ownerAttachment = await seedAttachment(owner, ownerTransaction.transactionKey, ownerKey);

    // Listing the owner's transaction is a 404 for the other household, not an empty list.
    const list = await http.as(other.appuser).get(`/v1/account/transaction/${ownerTransaction.transactionKey}/attachments`);
    expect(list.status).toBe(404);

    // Deleting the owner's attachment through the other household's own transaction is a 404.
    const remove = await http.as(other.appuser).delete(`/v1/account/transaction/${otherTransaction.transactionKey}/attachments/${ownerAttachment.transactionAttachmentKey}`);
    expect(remove.status).toBe(404);

    // A key under the owner's tenant cannot be confirmed onto the other household's transaction.
    storage.objects.set(ownerKey, { bytes: PNG_BYTES, size: PNG_BYTES.length });
    const confirm = await http.as(other.appuser).post(`/v1/account/transaction/${otherTransaction.transactionKey}/attachments`).send({ fileName: 'receipt.png', key: ownerKey });
    expect(confirm.status).toBe(400);

    // The owner still sees exactly their one attachment.
    const ownerList = await http.as(owner.appuser).get(`/v1/account/transaction/${ownerTransaction.transactionKey}/attachments`);
    expect(ownerList.body.attachments).toHaveLength(1);
  });

  it('links the OCR receipt copy to the transaction it created', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    const key = `wmocr/transaction_ocr_ext-user-1.123.png`;
    storage.objects.set(key, { bytes: PNG_BYTES, size: PNG_BYTES.length });

    await linkReceiptAttachment({ key, tenantKey: household.tenant.tenantKey, transactionKey: transaction.transactionKey, uploadedByAppuserKey: household.appuser.appuserKey });

    const listed = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);
    expect(listed.body.attachments).toHaveLength(1);
    expect(listed.body.attachments[0]).toMatchObject({ contentType: 'image/png', fileName: 'receipt.png' });
  });

  it('marks the ledger row with its attachment count', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    await seedAttachment(household, transaction.transactionKey, attachmentKey(household.tenant.tenantKey));

    const response = await http.as(household.appuser).get('/v1/account/transaction');

    expect(response.status).toBe(200);
    const row = (response.body.transactions as { attachmentCount?: number; transactionKey: number }[]).find((entry) => entry.transactionKey === transaction.transactionKey);
    expect(row?.attachmentCount).toBe(1);
  });

  it('lets a household partner see the shared transaction\'s attachments', async () => {    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    await seedAttachment(household, transaction.transactionKey, attachmentKey(household.tenant.tenantKey));

    const response = await http.as(partner).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);

    expect(response.status).toBe(200);
    expect(response.body.attachments).toHaveLength(1);
  });

  it('returns 503 for every attachment route when storage is not configured', async () => {
    const household = await seedHousehold(db.em());
    const transaction = await addTransaction(db.em(), household, { amount: -12, date: new Date('2026-07-20T10:00:00.000Z'), status: 'BOOKED' });
    storage.state.enabled = false;

    const list = await http.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/attachments`);
    const upload = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments/upload-url`).send({ contentType: 'image/png', fileName: 'x.png', sizeBytes: 10 });
    const confirm = await http.as(household.appuser).post(`/v1/account/transaction/${transaction.transactionKey}/attachments`).send({ fileName: 'x.png', key: attachmentKey(household.tenant.tenantKey) });
    const remove = await http.as(household.appuser).delete(`/v1/account/transaction/${transaction.transactionKey}/attachments/1`);

    expect([list.status, upload.status, confirm.status, remove.status]).toEqual([503, 503, 503, 503]);
  });
});
