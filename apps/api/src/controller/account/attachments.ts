import type { NextFunction, Request, Response } from 'express';

import { authedContext } from '@middleware/authed-context';
import { confirmAttachment, createAttachmentUploadUrl, deleteAttachment, listAttachments } from '@service/transaction/transaction-attachment.service';
import {
  confirmAttachmentRequestSchema,
  createAttachmentUploadUrlRequestSchema,
  deleteAttachmentRequestSchema,
  listAttachmentsRequestSchema,
} from '@validators/attachment';
import { zParse } from '@validators/parser';

/** `POST /v1/account/transaction/:transactionId/attachments/upload-url` */
export async function createTransactionAttachmentUploadUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantKey } = authedContext(req);
    const {
      body: { contentType, fileName, sizeBytes },
      params: { transactionId },
    } = await zParse(createAttachmentUploadUrlRequestSchema, req);
    const upload = await createAttachmentUploadUrl({ contentType, fileName, sizeBytes, tenantKey, transactionKey: transactionId });
    return res.json(upload);
  } catch (error) {
    next(error);
    return;
  }
}

/** `POST /v1/account/transaction/:transactionId/attachments` */
export async function confirmTransactionAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const { appuserKey, tenantKey } = authedContext(req);
    const {
      body: { fileName, key },
      params: { transactionId },
    } = await zParse(confirmAttachmentRequestSchema, req);
    const attachment = await confirmAttachment({ fileName, key, tenantKey, transactionKey: transactionId, uploadedByAppuserKey: appuserKey });
    return res.status(201).json(attachment);
  } catch (error) {
    next(error);
    return;
  }
}

/** `GET /v1/account/transaction/:transactionId/attachments` */
export async function getTransactionAttachments(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantKey } = authedContext(req);
    const {
      params: { transactionId },
    } = await zParse(listAttachmentsRequestSchema, req);
    const attachments = await listAttachments(transactionId, tenantKey);
    return res.json({ attachments });
  } catch (error) {
    next(error);
    return;
  }
}

/** `DELETE /v1/account/transaction/:transactionId/attachments/:attachmentId` */
export async function deleteTransactionAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantKey } = authedContext(req);
    const {
      params: { attachmentId, transactionId },
    } = await zParse(deleteAttachmentRequestSchema, req);
    await deleteAttachment(transactionId, tenantKey, attachmentId);
    return res.sendStatus(204);
  } catch (error) {
    next(error);
    return;
  }
}
