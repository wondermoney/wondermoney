import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

import { Account } from '@entity/Account';
import { authedContext } from '@middleware/authed-context';
import AccountCsvImportEnqueueService from '@service/account/account-csv-import-enqueue.service';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';
import { validateCsvObjectKey } from '@service/account/csv-upload-boundary.service';
import s3Service from '@service/storage/s3';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { getAccountPresignedUrlForUploadRequestSchema, startAccountCsvImportRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';
dotenv.config({ quiet: true });

export async function getS3PresignedUrlForCsvUpload(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { accountId },
  } = await zParse(getAccountPresignedUrlForUploadRequestSchema, req);
  const account = await DI.em.findOne(
    Account,
    { accountKey: accountId, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
    { populate: ['accountFinancialInstitutionKey'] },
  );
  if (!account) {
    next(new NotFoundError('Account not found'));
    return;
  }
  // Every account can import: one at a supported bank reads that bank's statement export, any other
  // (unsupported bank, or a manual account with no institution) reads the generic CSV format.
  const institutionName = account.accountFinancialInstitutionKey?.name;
  const importFormat = resolveAccountCsvImportFormat(institutionName);
  const { key, presignedUrl } = await s3Service.generatePresignedUrlForAccountCsv(accountId, institutionName || 'generic');
  return res.json({ csvImportFormat: importFormat.format, isSupportedBank: importFormat.format === 'bank', key, presignedUrl });
}

export async function startAccountCsvImport(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    body: { correlationId, key },
    params: { accountId },
  } = await zParse(startAccountCsvImportRequestSchema, req);
  const normalizedAccountId = typeof accountId === 'number' ? accountId : Number.parseInt(accountId, 10);
  const account = await DI.em.findOne(
    Account,
    { accountKey: normalizedAccountId, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
    { populate: ['accountFinancialInstitutionKey'] },
  );
  if (!account) {
    next(new NotFoundError('Account not found'));
    return;
  }
  if (!validateCsvObjectKey({ key, maxLength: 170, prefix: `account-${normalizedAccountId}-` })) {
    next(new BadRequestError('Invalid CSV object key'));
    return;
  }
  const importFormat = resolveAccountCsvImportFormat(account.accountFinancialInstitutionKey?.name);
  const supportedBankName = importFormat.format === 'bank' ? importFormat.bankName : undefined;
  const service = new AccountCsvImportEnqueueService();
  const operation = await service.enqueue({ accountKey: normalizedAccountId, bankName: supportedBankName, bucket: s3Service.getAccountCsvBucketName(), correlationId, key }, { enqueue: req.enqueue });
  return res.status(202).json({ correlationId: operation.correlationId, status: (operation as { status?: string }).status ?? 'queued' });
}
