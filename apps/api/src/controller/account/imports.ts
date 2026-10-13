import { csv } from '@wondermoney/shared';
import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

import { Account } from '@entity/Account';
import { authedContext } from '@middleware/authed-context';
import AccountCsvImportEnqueueService from '@service/account/account-csv-import-enqueue.service';
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
  // We are not checking if the bank is supported, because we want to allow all banks to import the CSV
  // so that we can add support for new banks later.
  const bankName = account.accountFinancialInstitutionKey?.name;
  if (!bankName) {
    next(new BadRequestError('Bank not found'));
    return;
  }
  const { key, presignedUrl } = await s3Service.generatePresignedUrlForAccountCsv(accountId, bankName);
  const isSupportedBank = csv.SUPPORTED_BANKS_CSV_IMPORT.includes(bankName.toLowerCase() as csv.SupportedBanks);
  return res.json({ isSupportedBank, key, presignedUrl });
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
  const effectiveBankName = account.accountFinancialInstitutionKey?.name;
  const supportedBankName = effectiveBankName && csv.SUPPORTED_BANKS_CSV_IMPORT.includes(effectiveBankName.toLowerCase() as csv.SupportedBanks) ? effectiveBankName : undefined;
  const service = new AccountCsvImportEnqueueService();
  const operation = await service.enqueue({ accountKey: normalizedAccountId, bankName: supportedBankName, bucket: s3Service.getAccountCsvBucketName(), correlationId, key }, { enqueue: req.enqueue });
  return res.status(202).json({ correlationId: operation.correlationId, status: (operation as { status?: string }).status ?? 'queued' });
}
