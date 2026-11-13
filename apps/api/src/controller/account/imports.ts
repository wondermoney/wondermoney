import { transactionImport } from '@wondermoney/shared';
import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

import { Account } from '@entity/Account';
import { authedContext } from '@middleware/authed-context';
import { canUseAi } from '@middleware/email-verification';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';
import { detectStatement, toStatementPreview } from '@service/account/account-statement-detection.service';
import { getLimitedCsvObjectBuffer, validateCsvObjectKey } from '@service/account/csv-upload-boundary.service';
import { spendAiAllowance } from '@service/ai/ai-allowance.service';
import { isAiAllowedFor } from '@service/ai/ai-availability';
import s3Service from '@service/storage/s3';
import { TransactionImportService } from '@service/transaction-import/transaction-import.service';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { getAccountPresignedUrlForUploadRequestSchema, previewAccountCsvImportRequestSchema, startAccountCsvImportRequestSchema } from '@validators/account';
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

/**
 * The one-step import: a statement read by its bank's parser or with the columns the person
 * confirmed runs as a staged session that commits itself with the default decisions (new rows in,
 * duplicates out), so it resumes like any staged import. The file, not the account, decides the
 * format: an OFX/QFX file is read by the OFX adapter, a CAMT.053 export by the CAMT.053 adapter, a
 * QIF file by the QIF adapter, a YNAB register export by the YNAB adapter, an Actual Budget export
 * by the Actual adapter, and the older WonderMoney CSV template (with `internalTransactionId` and
 * `transactionTypeKey` columns) by its own. Anything else is a statement. A file that names one
 * account imports into this one; one that names several is not committed, and waits for its
 * accounts to be mapped.
 */
export async function startAccountCsvImport(req: Request, res: Response, next: NextFunction) {
  const { appuserKey, tenant, tenantKey, user } = authedContext(req);
  const {
    body: { fileName, key, mapping },
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
  // The client uploads the same way for every format; the file's own content picks the reader.
  let format: transactionImport.ImportFormat = 'statement';
  try {
    const bytes = new Uint8Array(await getLimitedCsvObjectBuffer({ bucket: s3Service.getAccountCsvBucketName(), key }));
    if (transactionImport.isOfxFile(bytes)) format = 'ofx';
    else if (transactionImport.isGenericCsvTemplate(bytes)) format = 'generic-csv';
    else if (transactionImport.isQifFile(bytes)) format = 'qif';
    else if (transactionImport.isCamt053File(bytes)) format = 'camt053';
    else if (transactionImport.isYnabFile(bytes)) format = 'ynab';
    else if (transactionImport.isActualFile(bytes)) format = 'actual';
  } catch {
    // The worker reports an unreadable file; the statement path below keeps its own behaviour.
  }
  const session = await new TransactionImportService(DI.em, { enqueue: req.enqueue }).create({ appuserKey, tenantKey }, { accountId: normalizedAccountId, autoCommit: true, fileName, format, key, options: mapping ? { mapping } : undefined });
  return res.status(202).json({ correlationId: session.correlationId, importId: session.id, status: 'queued' });
}

/**
 * How the uploaded file reads before anything is imported: which columns were found (by the bank's
 * parser, by their names, or by the model), how many transactions, over which dates, and the first
 * few. With a `mapping`, the file read the way the person corrected it. The import then takes the
 * same mapping, so what was previewed is what is stored.
 */
export async function previewAccountCsvImport(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    body: { key, mapping },
    params: { accountId },
  } = await zParse(previewAccountCsvImportRequestSchema, req);
  const account = await DI.em.findOne(
    Account,
    { accountKey: accountId, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
    { populate: ['accountFinancialInstitutionKey', 'currencyKey'] },
  );
  if (!account) {
    next(new NotFoundError('Account not found'));
    return;
  }
  if (!validateCsvObjectKey({ key, maxLength: 170, prefix: `account-${accountId}-` })) {
    next(new BadRequestError('Invalid CSV object key'));
    return;
  }
  const importFormat = resolveAccountCsvImportFormat(account.accountFinancialInstitutionKey?.name);
  let buffer: Buffer;
  try {
    buffer = await getLimitedCsvObjectBuffer({ bucket: s3Service.getAccountCsvBucketName(), key });
  } catch (error) {
    next(new BadRequestError(error instanceof Error ? error.message : 'Could not read the file'));
    return;
  }
  try {
    const detection = await detectStatement({
      bankName: importFormat.format === 'bank' ? importFormat.bankName : undefined,
      buffer,
      mapping,
      model: { allowed: canUseAi(req) && isAiAllowedFor(req.user, 'csvMapping'), spend: () => spendAiAllowance(DI.em, tenant.tenantKey, 'csvMapping') },
    });
    res.json(toStatementPreview(detection, account.currencyKey.code));
  } catch (error) {
    next(new BadRequestError(error instanceof Error ? error.message : 'Could not read the file'));
  }
}
