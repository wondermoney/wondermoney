import { Buffer } from 'buffer';

import { z } from 'zod';

import { CategorizationConfidence } from '@entity/Transaction';
import { boundedLimit, finiteAmount, positiveIntId, validDate } from '@validators/shared';

const MAGIC_BYTES: Record<string, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/jpg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

function magicByteMatches(buffer: unknown, mimetype: string): boolean {
  if (!Buffer.isBuffer(buffer)) return false;
  const signature = MAGIC_BYTES[mimetype];
  if (!signature || buffer.length < signature.length) return false;
  return signature.every((byte, idx) => buffer[idx] === byte);
}

export const updateTransactionRequestSchema = z.object({ body: z.object({ categoryKey: z.string().optional().transform((val) => (val ? positiveIntId.parse(val) : undefined)), updatedAmount: finiteAmount.optional() }), params: z.object({ transactionId: positiveIntId }) });
export const updateTransactionsRequestSchema = z.object({ body: z.object({ categoryId: z.string().optional().transform((val) => (val ? positiveIntId.parse(val) : undefined)), hidden: z.boolean().optional(), reviewed: z.boolean().optional(), transactionIds: z.array(positiveIntId).max(500, 'At most 500 transactions can be updated in one request') }) });
export const getTransactionHistoryRequestSchema = z.object({ params: z.object({ transactionId: positiveIntId }) });

/**
 * RAD-579 — the three filters the transactions table used to apply in the browser.
 *
 * Accepted repeated (`?accountKeys=1&accountKeys=2`) or comma-separated (`?accountKeys=1,2`), since
 * both shapes reach an Express query depending on how the client serialises. Empty strings are
 * dropped so a cleared filter reads as "no filter" rather than as a filter matching nothing.
 */
const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    const parts = (Array.isArray(val) ? val : [val])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts : undefined;
  });

/** The client's sentinel for "transactions with no category at all". Kept identical to the web value. */
export const UNCATEGORIZED_FILTER_VALUE = '__uncategorized__';

const csvIntList = csvList.transform((parts) => (parts ? parts.map((part) => positiveIntId.parse(part)) : undefined));

/** Category keys, plus the `__uncategorized__` sentinel which is not a key and must survive parsing. */
const csvCategoryList = csvList.transform((parts) =>
  parts
    ? {
        includeUncategorized: parts.includes(UNCATEGORIZED_FILTER_VALUE),
        keys: parts.filter((part) => part !== UNCATEGORIZED_FILTER_VALUE).map((part) => positiveIntId.parse(part)),
      }
    : undefined,
);
export const getTransactionsRequestSchema = z.object({ query: z.object({ accountKeys: csvIntList, categoryKeys: csvCategoryList, confidence: z.nativeEnum(CategorizationConfidence).optional(), cursor: z.string().trim().max(64).regex(/^\d+_\d+$/, 'Malformed cursor').optional(), fromDate: validDate.optional(), includeEmptyAccounts: z.union([z.boolean(), z.string()]).optional().transform((val) => (typeof val === 'undefined' ? undefined : typeof val === 'boolean' ? val : val.toLowerCase() === 'true')), includeHidden: z.union([z.boolean(), z.string()]).optional().transform((val) => (typeof val === 'undefined' ? undefined : typeof val === 'boolean' ? val : val.toLowerCase() === 'true')), limit: boundedLimit({ defaultValue: 100, max: 500 }).optional().default(100), toDate: validDate.optional(), transactionTypes: csvList, unreviewedOnly: z.union([z.boolean(), z.string()]).optional().transform((val) => (typeof val === 'undefined' ? undefined : typeof val === 'boolean' ? val : val.toLowerCase() === 'true')) }) });
export const getAccountTransactionsRequestSchema = z.object({ query: z.object({ accountId: positiveIntId.optional(), categoryKeys: csvCategoryList, confidence: z.nativeEnum(CategorizationConfidence).optional(), cursor: z.string().trim().max(64).regex(/^\d+_\d+$/, 'Malformed cursor').optional(), fromDate: validDate.optional(), includeHidden: z.union([z.boolean(), z.string()]).optional().transform((val) => (typeof val === 'undefined' ? undefined : typeof val === 'boolean' ? val : val.toLowerCase() === 'true')), limit: boundedLimit({ defaultValue: 100, max: 500 }).optional().default(100), toDate: validDate.optional(), transactionTypes: csvList, unreviewedOnly: z.union([z.boolean(), z.string()]).optional().transform((val) => (typeof val === 'undefined' ? undefined : typeof val === 'boolean' ? val : val.toLowerCase() === 'true')) }) });
export const getTransactionMerchantsRequestSchema = z.object({ query: z.object({ limit: boundedLimit({ defaultValue: 20, max: 50 }).optional().default(20), search: z.string().trim().max(200).optional().default('') }) });
export const createOfflineAccountRequestSchema = z.object({ body: z.object({ accountTypeId: positiveIntId.optional(), currencyId: positiveIntId, currentBalance: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().finite().max(999999999999)), financialInstitutionId: z.number().optional(), name: z.string().min(1).max(100) }) });
export const createTransactionRequestSchema = z.object({ body: z.object({ categoryId: z.string().nullable().optional().transform((val) => (val ? positiveIntId.parse(val) : undefined)), description: z.string().max(500).optional().transform((val) => (val ? val : undefined)), exchangeRate: z.string().optional().transform((val) => (val ? finiteAmount.parse(val) : undefined)), notes: z.string().max(1000).nullable().optional(), originalAmount: z.string().optional().transform((val) => (val ? finiteAmount.parse(val) : undefined)), originalCurrencyId: z.string().optional().transform((val) => (val ? positiveIntId.parse(val) : undefined)), settlementAmount: finiteAmount, settlementCurrencyId: positiveIntId, transactionDate: validDate, transactionMerchantId: z.number().nullable().optional(), transactionMerchantName: z.string().max(200).nullable().optional().transform((val) => (val ? val : undefined)), transactionTypeId: positiveIntId }), params: z.object({ accountId: positiveIntId }) });
export const createTransactionOCRImportRequestSchema = z.object({ file: z.object({ buffer: z.instanceof(Buffer), encoding: z.string(), fieldname: z.string(), mimetype: z.string(), originalname: z.string(), size: z.number() }).refine((file) => file.size <= 5000000, `Max file size is 5MB.`).refine((file) => ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype), 'Only .jpg, .jpeg, .png, .webp and .pdf formats are supported.').refine((file) => magicByteMatches(file.buffer, file.mimetype), 'Uploaded file content does not match the declared file type.') });

export const transactionOCRModelOutputSchema = z
  .object({
    settlementAmount: z.number().finite(),
    settlementCurrency: z.string().trim().regex(/^[A-Z]{3}$/),
    transactionDate: z.string().datetime({ offset: true }),
    transactionMerchantName: z.string().trim().max(200),
  })
  .strict();

export const acceptTransactionOCRImportRequestSchema = z.object({ body: z.object({ accountId: positiveIntId, categoryIds: z.array(z.string()).nullable().optional().transform((val) => val?.map((v) => positiveIntId.parse(v))), description: z.string().max(500).optional().transform((val) => (val ? val : undefined)), exchangeRate: z.string().optional().transform((val) => (val ? finiteAmount.parse(val) : undefined)), originalAmount: z.string().optional().transform((val) => (val ? finiteAmount.parse(val) : undefined)), originalCurrencyId: z.string().optional().transform((val) => (val ? positiveIntId.parse(val) : undefined)), settlementAmount: z.string().transform((val) => finiteAmount.parse(val)), settlementCurrencyId: positiveIntId, transactionDate: validDate, transactionMerchantId: z.number().nullable().optional(), transactionMerchantName: z.string().max(200).nullable().optional().transform((val) => (val ? val : undefined)), transactionTypeId: positiveIntId }), params: z.object({ transactionOCRImportId: positiveIntId }) });
export const rejectTransactionOcrImportRequestSchema = z.object({ params: z.object({ transactionOCRImportId: positiveIntId }) });
export const getAccountsMetricsRequestSchema = z.object({ query: z.object({ fromDate: validDate.optional(), toDate: validDate.optional() }) });
export const getAccountMetricsRequestSchema = z.object({ params: z.object({ accountId: positiveIntId }), query: z.object({ fromDate: validDate.optional() }) });
export const updateAccountRequestSchema = z.object({ body: z.object({ accountName: z.string().min(1).max(100).optional(), isPrivate: z.boolean().optional() }), params: z.object({ accountId: positiveIntId }) });
export const deleteAccountRequestSchema = z.object({ params: z.object({ accountId: positiveIntId }) });
export const getRecentTransactionsRequestSchema = z.object({ params: z.object({ accountId: positiveIntId }) });
export const getAccountPresignedUrlForUploadRequestSchema = z.object({ params: z.object({ accountId: positiveIntId }) });
export const startAccountCsvImportRequestSchema = z.object({ body: z.object({ bankName: z.string().optional(), correlationId: z.string().optional(), key: z.string().min(1) }), params: z.object({ accountId: positiveIntId }) });
export const getCategorySpendingRequestSchema = z.object({ query: z.object({ fromDate: validDate.optional(), limit: boundedLimit({ defaultValue: 100, max: 500 }).optional().default(100), toDate: validDate.optional() }) });
export const getAccountRequestSchema = z.object({ params: z.object({ accountId: positiveIntId }) });
export const getAccountsCashflowRequestSchema = z.object({ query: z.object({ fromDate: validDate.optional() }) });
