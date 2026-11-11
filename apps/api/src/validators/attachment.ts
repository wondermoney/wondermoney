import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

const transactionParams = z.object({ transactionId: positiveIntId });

export const createAttachmentUploadUrlRequestSchema = z.object({
  body: z.object({
    contentType: z.string().trim().min(1).max(100),
    fileName: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive(),
  }),
  params: transactionParams,
});

export const confirmAttachmentRequestSchema = z.object({
  body: z.object({
    fileName: z.string().trim().min(1).max(255),
    key: z.string().trim().min(1).max(512),
  }),
  params: transactionParams,
});

export const listAttachmentsRequestSchema = z.object({ params: transactionParams });

export const deleteAttachmentRequestSchema = z.object({
  params: transactionParams.extend({ attachmentId: positiveIntId }),
});
