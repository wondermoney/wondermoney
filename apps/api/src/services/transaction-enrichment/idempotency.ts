import crypto from 'node:crypto';

type NullableKey = null | number | string | undefined;

const NAMESPACE = 'transaction-enrichment-idempotency';
const VERSION = 'v1';

const normalize = (value: NullableKey) => (value === null || value === undefined ? '' : String(value));

export const buildTransactionEnrichmentIdempotencyKey = (
  transactionKey: number,
  tenantKey: NullableKey,
  promptVersion: string,
  modelVersion: string,
) => crypto.createHash('sha256')
  .update([NAMESPACE, VERSION, transactionKey, normalize(tenantKey), promptVersion, modelVersion].join('|'))
  .digest('hex');
