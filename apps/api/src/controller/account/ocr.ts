import { jsonSchema } from 'ai';
import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionOCRImport, TransactionOCRImportStatus } from '@entity/TransactionOCRImport';
import { authedContext, authedUser } from '@middleware/authed-context';
import { aiCapabilities } from '@service/ai/ai-provider';
import { completeJson } from '@service/ai/complete-json';
import s3Service from '@service/storage/s3';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { linkReceiptAttachment } from '@service/transaction/transaction-attachment.service';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';
import { STORAGE_OCR_PREFIX } from '@utils/constants';
import { convertPDFToImage } from '@utils/documents';
import { BadRequestError, FeatureDisabledError, InternalServerError, NotFoundError } from '@utils/errors';
import { fromMimetypeToExtension } from '@utils/mimetype';
import {
  acceptTransactionOCRImportRequestSchema,
  createTransactionOCRImportRequestSchema,
  rejectTransactionOcrImportRequestSchema,
  transactionOCRModelOutputSchema,
} from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';
dotenv.config({ quiet: true });

const MAX_LLM_RESPONSE_LENGTH = 1024;

/**
 * What the vision model must return for a receipt. `additionalProperties: false` keeps it inside
 * OpenAI's strict structured-output rules; the controller validates the same shape with
 * `transactionOCRModelOutputSchema`, which is stricter still (currency code, date, length).
 */
const RECEIPT_RESPONSE_SCHEMA = jsonSchema({
  additionalProperties: false,
  properties: {
    settlementAmount: { type: 'number' },
    settlementCurrency: { type: 'string' },
    transactionDate: { type: 'string' },
    transactionMerchantName: { type: 'string' },
  },
  required: ['settlementAmount', 'settlementCurrency', 'transactionDate', 'transactionMerchantName'],
  type: 'object',
});

export async function confirmTransactionOCRImportAndCreateTransaction(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const { tenantKey } = authedContext(req);
  const {
    body: {
      accountId,
      categoryIds,
      description,
      exchangeRate,
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    },
    params: { transactionOCRImportId },
  } = await zParse(acceptTransactionOCRImportRequestSchema, req);

  const transactionOCRImport = await DI.em.findOne(TransactionOCRImport, {
    appuserKey: req.user,
    transactionOCRImportKey: transactionOCRImportId,
  });
  if (!transactionOCRImport) {
    next(new NotFoundError('Transaction OCR import not found'));
    return;
  }

  const account = await DI.em.findOne(Account, {
    accountKey: accountId,
    deletedAt: undefined,
  });
  if (!account) {
    next(new NotFoundError('Account not found'));
    return;
  }

  try {
    const transaction = await transactionCreationService.createTransaction({
      accountId,
      appuserKey: user.appuserKey,
      // Honour the user's chosen category (the transaction model is one-category-per-transaction, so the
      // first id wins).
      categoryId: categoryIds?.[0],
      description,
      // The user reviewed and confirmed the scanned values.
      enteredByHand: true,
      exchangeRate,
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    });

    transactionOCRImport.transactionKey = transaction;
    transactionOCRImport.accountKey = account;
    transactionOCRImport.status = TransactionOCRImportStatus.SUCCESS;
    await DI.em.persist(transactionOCRImport).flush();

    // The scanned receipt becomes the transaction's first attachment, so the image the person
    // uploaded is where they expect it. Best-effort: the transaction is already created.
    if (transactionOCRImport.fileKey) {
      await linkReceiptAttachment({ key: transactionOCRImport.fileKey, tenantKey, transactionKey: transaction.transactionKey, uploadedByAppuserKey: user.appuserKey });
    }

    return res.sendStatus(201);
  } catch (err) {
    next(err);
    return;
  }
}

export async function createTransactionOCRImport(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const { file } = await zParse(createTransactionOCRImportRequestSchema, req);

  const appuser = await DI.em.findOne(Appuser, { appuserKey: user.appuserKey });
  if (!appuser) {
    next(new InternalServerError('User not found'));
    return;
  }
  const appUserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appUserTenant) {
    next(new InternalServerError("User doesn't have AppuserTenant"));
    return;
  }

  // Before storing anything: a server without a vision model cannot scan the receipt at all.
  if (!aiCapabilities().ocr) {
    next(new FeatureDisabledError('Receipt scanning'));
    return;
  }

  // Keeping a copy of the receipt is an audit trail, not a requirement: without file storage the
  // scan still runs and the import records no file.
  let fileUrl = '';
  let fileKey: string | undefined;
  if (s3Service.isEnabled()) {
    try {
      const fileExtension = fromMimetypeToExtension(file.mimetype);
      const fileName = `transaction_ocr_${appuser.externalUserId}.${Date.now()}.${fileExtension}`;
      fileKey = `${STORAGE_OCR_PREFIX}/${fileName}`;
      fileUrl = await s3Service.uploadFile(s3Service.getFilesBucketName(), fileKey, file.buffer, file.mimetype);
    } catch (err) {
      next(new InternalServerError(`Error uploading file into storage. Error: ${err}`));
      return;
    }
  }

  const transactionOCRImport = new TransactionOCRImport();
  transactionOCRImport.tenantKey = appUserTenant.tenantKey;
  transactionOCRImport.appuserKey = appuser;
  transactionOCRImport.fileUrl = fileUrl;
  transactionOCRImport.fileKey = fileKey;

  // Convert PDF to images if necessary
  let images: string[];
  let mimetype = file.mimetype;
  if (file.mimetype === 'application/pdf') {
    try {
      images = await convertPDFToImage(`data:application/pdf;base64,${file.buffer.toString('base64')}`);
      mimetype = 'image/png';
    } catch (err) {
      next(new InternalServerError(`Error transforming PDF file into images. Error: ${err}`));
      return;
    }
  } else {
    images = [file.buffer.toString('base64')];
  }

  try {
    const { object, tokens } = await completeJson({
      feature: 'ocr',
      images: images.map((data) => ({ data, mediaType: mimetype })),
      schema: RECEIPT_RESPONSE_SCHEMA,
      schemaName: 'transaction_information',
      user: 'Extract the transaction information from the receipt image',
    });

    // The model's answer is kept as an audit trail, and the tokens it cost are recorded even when
    // the shape turns out to be wrong.
    transactionOCRImport.llmResponse = sanitizeLlmResponse(JSON.stringify(object));
    transactionOCRImport.tokensSpent = tokens.totalTokens;
    await DI.em.persist(transactionOCRImport).flush();

    const transactionInfo = transactionOCRModelOutputSchema.safeParse(object);
    if (!transactionInfo.success) {
      throw new BadRequestError('Answer returned from the model is invalid');
    }

    const currency = transactionInfo.data.settlementCurrency
      ? await DI.em.findOne(Currency, { code: transactionInfo.data.settlementCurrency })
      : undefined;
    const transactionMerchant = transactionInfo.data.transactionMerchantName
      ? await DI.em.findOne(TransactionMerchant, {
          deletedAt: undefined,
          normalizedName: normalizeMerchantName(transactionInfo.data.transactionMerchantName),
          tenantKey: appUserTenant.tenantKey,
        })
      : undefined;
    const transactionInfoData = {
      settlementAmount: transactionInfo.data.settlementAmount,
      settlementCurrencyId: currency?.currencyKey,
      transactionDate: transactionInfo.data.transactionDate,
      transactionMerchantId: transactionMerchant?.transactionMerchantKey,
      transactionMerchantName: transactionInfo.data.transactionMerchantName,
    };

    return res.json({
      transactionInfo: transactionInfoData,
      transactionOcrImportId: transactionOCRImport.transactionOCRImportKey,
    });
  } catch (err) {
    transactionOCRImport.status = TransactionOCRImportStatus.FAILED;
    transactionOCRImport.tokensSpent = 0;
    await DI.em.persist(transactionOCRImport).flush();
    next(err);
    return;
  }
}

export async function rejectTransactionOCRImport(req: Request, res: Response, next: NextFunction) {
  const {
    params: { transactionOCRImportId },
  } = await zParse(rejectTransactionOcrImportRequestSchema, req);

  const transactionOCRImport = await DI.em.findOne(TransactionOCRImport, {
    appuserKey: req.user,
    transactionOCRImportKey: transactionOCRImportId,
  });
  if (!transactionOCRImport) {
    next(new NotFoundError('Transaction OCR import not found'));
    return;
  }

  transactionOCRImport.status = TransactionOCRImportStatus.FAILED;
  await DI.em.persist(transactionOCRImport).flush();
  return res.sendStatus(200);
}

export function sanitizeLlmResponse(response: null | string | undefined) {
  if (!response) {
    return undefined;
  }

  return response.slice(0, MAX_LLM_RESPONSE_LENGTH);
}
