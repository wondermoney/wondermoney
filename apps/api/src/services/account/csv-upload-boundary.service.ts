import { parse } from 'csv-parse/sync';

import { BadRequestError } from '@utils/errors';

export interface CsvUploadLimits {
  maxBytes: number;
  maxColumns: number;
  maxFieldLength: number;
  maxRows: number;
}

export const PORTFOLIO_CSV_MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_CSV_UPLOAD_LIMITS: CsvUploadLimits = {
  maxBytes: PORTFOLIO_CSV_MAX_UPLOAD_SIZE_BYTES,
  maxColumns: 100,
  maxFieldLength: 1_000,
  maxRows: 10_000,
};

interface CsvObjectDeps {
  getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>;
  getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>;
  getObjectText?: (bucket: string, key: string) => Promise<string>;
  limits?: Partial<CsvUploadLimits>;
}

interface CsvObjectInput {
  bucket: string;
  key: string;
}

interface CsvObjectKeyBuildInput {
  maxLength: number;
  name: string;
  prefix: string;
  uniqueId: string;
}

interface CsvObjectKeyValidationInput {
  key: string;
  maxLength: number;
  prefix: string;
}

const UNSAFE_CSV_OBJECT_KEY_PATTERN_SOURCE = '[\\x00-\\x1F\\x7F:/\\\\]';
const UNSAFE_CSV_OBJECT_KEY_PATTERN_GLOBAL = new RegExp(UNSAFE_CSV_OBJECT_KEY_PATTERN_SOURCE, 'g');
const UNSAFE_CSV_OBJECT_KEY_PATTERN = new RegExp(UNSAFE_CSV_OBJECT_KEY_PATTERN_SOURCE);

export function assertCsvTextLimits(csvText: string, limits: Partial<CsvUploadLimits> = {}) {
  const resolvedLimits = { ...DEFAULT_CSV_UPLOAD_LIMITS, ...limits };
  let rows = 0;
  let columns = 1;
  let headerColumns: number | undefined;
  let fieldLength = 0;
  let inQuotes = false;
  let rowHasContent = false;

  const finishRow = () => {
    rows++;
    if (rows === 1) headerColumns = columns;
    if (rows > resolvedLimits.maxRows) throw new Error(`CSV exceeds max row count of ${resolvedLimits.maxRows}`);
    if (columns > resolvedLimits.maxColumns) throw new Error(`CSV exceeds max column count of ${resolvedLimits.maxColumns}`);
    columns = 1;
    fieldLength = 0;
  };

  for (let index = 0; index < csvText.length; index++) {
    const char = csvText[index];
    const next = csvText[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { index++; fieldLength++; continue; }
      inQuotes = !inQuotes;
      rowHasContent = true;
      continue;
    }
    if (!inQuotes && char === ',') { columns++; rowHasContent = true; continue; }
    if (!inQuotes && char === '\n') { finishRow(); rowHasContent = false; continue; }
    rowHasContent = true;
    fieldLength++;
    if (fieldLength > resolvedLimits.maxFieldLength) throw new Error(`CSV field exceeds max length of ${resolvedLimits.maxFieldLength}`);
  }

  if (rowHasContent || inQuotes) finishRow();
  if (headerColumns !== undefined && headerColumns > resolvedLimits.maxColumns) throw new Error(`CSV exceeds max column count of ${resolvedLimits.maxColumns}`);
}

export function assertValidCsvObjectKey(input: CsvObjectKeyValidationInput, message = 'Invalid CSV object key') {
  if (!validateCsvObjectKey(input)) throw new BadRequestError(message);
}

export function buildCsvObjectKey({ maxLength, name, prefix, uniqueId }: CsvObjectKeyBuildInput) {
  const suffix = `-${uniqueId}.csv`;
  const availableNameLength = maxLength - prefix.length - suffix.length;
  if (availableNameLength < 1) throw new Error('CSV object key max length is too short');

  const safeName = name.replace(UNSAFE_CSV_OBJECT_KEY_PATTERN_GLOBAL, '_') || 'csv';
  const key = `${prefix}${safeName.slice(0, availableNameLength)}${suffix}`;
  assertValidCsvObjectKey({ key, maxLength, prefix });
  return key;
}

export async function getLimitedCsvObjectBuffer({ bucket, key }: CsvObjectInput, deps: CsvObjectDeps = {}) {
  const limits = { ...DEFAULT_CSV_UPLOAD_LIMITS, ...deps.limits };
  const getObjectSize = deps.getObjectSize ?? ((objectBucket, objectKey) => import('@service/storage/s3').then(({ default: s3 }) => s3.getObjectSize(objectBucket, objectKey)));
  const getObjectBuffer = deps.getObjectBuffer ?? ((objectBucket, objectKey) => import('@service/storage/s3').then(({ default: s3 }) => s3.getObjectBuffer(objectBucket, objectKey)));

  const size = await getObjectSize(bucket, key);
  if (size !== undefined && size > limits.maxBytes) throw new Error(`CSV object exceeds max size of ${limits.maxBytes} bytes`);

  const csvBuffer = await getObjectBuffer(bucket, key);
  if (csvBuffer.byteLength > limits.maxBytes) throw new Error(`CSV object exceeds max size of ${limits.maxBytes} bytes`);
  return csvBuffer;
}

export async function getLimitedCsvObjectText({ bucket, key }: CsvObjectInput, deps: CsvObjectDeps = {}) {
  const limits = { ...DEFAULT_CSV_UPLOAD_LIMITS, ...deps.limits };
  const getObjectSize = deps.getObjectSize ?? ((objectBucket, objectKey) => import('@service/storage/s3').then(({ default: s3 }) => s3.getObjectSize(objectBucket, objectKey)));
  const getObjectText = deps.getObjectText ?? ((objectBucket, objectKey) => import('@service/storage/s3').then(({ default: s3 }) => s3.getObjectText(objectBucket, objectKey)));

  const size = await getObjectSize(bucket, key);
  if (size !== undefined && size > limits.maxBytes) throw new Error(`CSV object exceeds max size of ${limits.maxBytes} bytes`);

  const csvText = await getObjectText(bucket, key);
  if (Buffer.byteLength(csvText, 'utf8') > limits.maxBytes) throw new Error(`CSV object exceeds max size of ${limits.maxBytes} bytes`);
  assertCsvTextLimits(csvText, limits);
  return csvText;
}

export function parseCsvRows<T>(csvText: string, limits: Partial<CsvUploadLimits> = {}): T[] {
  const resolvedLimits = { ...DEFAULT_CSV_UPLOAD_LIMITS, ...limits };
  assertCsvTextLimits(csvText, resolvedLimits);
  return parse(csvText, {
    columns: true,
    max_record_size: resolvedLimits.maxFieldLength,
    skip_empty_lines: true,
    trim: true,
  });
}

export function validateCsvObjectKey({ key, maxLength, prefix }: CsvObjectKeyValidationInput) {
  return key.length > 0
    && key.length <= maxLength
    && key.startsWith(prefix)
    && key.endsWith('.csv')
    && !UNSAFE_CSV_OBJECT_KEY_PATTERN.test(key);
}
