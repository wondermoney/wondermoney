import { transactionImport } from '@wondermoney/shared';
import { z } from 'zod';

import { statementMappingSchema } from '@service/account/account-statement-mapping.schema';
import { MAX_PAGE_SIZE } from '@service/transaction-import/transaction-import.service';
import { positiveIntId } from '@validators/shared';

const sessionParams = z.object({ importId: z.uuid() });
const options = z
  .object({
    /** How a QIF date whose day and month are both 12 or less reads. */
    dateOrder: z.enum(['day-first', 'month-first']).optional(),
    mapping: statementMappingSchema.optional(),
  })
  .strict();

/** `POST /v1/transaction-import-sessions`: the account, the format, and the file when it is already uploaded for that account. */
export const createTransactionImportSchema = z.object({
  body: z.object({
    accountId: positiveIntId,
    format: z.enum(transactionImport.IMPORT_FORMATS),
    key: z.string().min(1).max(170).optional(),
    options: options.optional(),
  }).strict(),
});

/** `GET /v1/transaction-import-sessions/:importId`: the summary and one page of rows, of one status or all. */
export const getTransactionImportSchema = z.object({
  params: sessionParams,
  query: z.object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    status: z.enum(transactionImport.IMPORT_ROW_STATUSES).optional(),
  }),
});

export const transactionImportRequestSchema = z.object({ params: sessionParams });

export const parseTransactionImportSchema = z.object({
  body: z.object({ options: options.optional() }).strict().optional(),
  params: sessionParams,
});

/** `PATCH /:importId/rows`: include or skip the listed rows, or every row of one status. */
export const decideTransactionImportRowsSchema = z.object({
  body: z.object({
    decision: z.enum(transactionImport.IMPORT_DECISIONS),
    rowIds: z.array(positiveIntId).min(1).max(1000).optional(),
    status: z.enum(transactionImport.IMPORT_ROW_STATUSES).optional(),
  }).strict().refine((body) => (body.rowIds === undefined) !== (body.status === undefined), { error: 'Give either rowIds or status' }),
  params: sessionParams,
});

/** `PATCH /:importId/account-mapping`: the file's account labels to account ids. */
export const mapTransactionImportAccountsSchema = z.object({
  body: z.object({ mapping: z.record(z.string().min(1).max(255), positiveIntId) }).strict(),
  params: sessionParams,
});
